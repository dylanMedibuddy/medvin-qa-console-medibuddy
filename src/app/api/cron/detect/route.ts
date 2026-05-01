import { NextResponse } from 'next/server'
import { withCronAuth } from '@/lib/api/cron-auth'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { getEnrollmentQuestionsPage, type MedvinQuestion } from '@/lib/medvin'
import { chatCompleteJson } from '@/lib/llm'
import { logError, logInfo, logWarn } from '@/lib/logging'
import {
  DETECT_MODEL,
  DETECT_PROMPT_VERSION,
  DETECT_SYSTEM_PROMPT,
  buildDetectUserPrompt,
  type DetectionResult,
} from '@/lib/prompts/detect'

type Run = {
  id: string
  question_bank_id: number
  enrollment_slug: string | null
  cursor: { page?: number } | null
  total_pages: number | null
  total_scanned: number
  total_flagged: number
  total_errors: number
}

const PAGE_SIZE = 50
const DETECT_CONCURRENCY = 10

/**
 * Minimum detector confidence required to flag an item. Default 0.75 — chosen
 * after the first Dundee Y1 run produced ~14% flag rate (probably too high).
 * Tune via env var without redeploying. Range 0..1; lower = more flags.
 */
const MIN_FLAG_CONFIDENCE = (() => {
  const raw = process.env.DETECT_MIN_CONFIDENCE
  const parsed = raw == null ? NaN : parseFloat(raw)
  return Number.isFinite(parsed) ? Math.max(0, Math.min(1, parsed)) : 0.75
})()

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let next = 0
  async function worker() {
    while (true) {
      const i = next++
      if (i >= items.length) return
      results[i] = await fn(items[i], i)
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => worker())
  )
  return results
}

function questionTypeSlug(q: MedvinQuestion): string {
  const t = q.question_type
  if (typeof t === 'string') return t
  if (t && typeof t === 'object' && typeof t.slug === 'string') return t.slug
  return 'single-choice'
}

async function detect(question: MedvinQuestion): Promise<DetectionResult> {
  return chatCompleteJson<DetectionResult>({
    model: DETECT_MODEL,
    systemPrompt: DETECT_SYSTEM_PROMPT,
    userPrompt: buildDetectUserPrompt({
      questionText: question.question_text,
      options: question.options,
    }),
    maxTokens: 2048,
    temperature: 1,
  })
}

/**
 * Process one page of detection in the background. Idempotent — if this
 * fails partway, the cursor isn't advanced and the next cron tick retries
 * the same page (duplicate inserts blocked by the partial unique index).
 */
async function processOnePage(run: Run): Promise<void> {
  const sb = await createServiceRoleClient()
  const page = run.cursor?.page ?? 1

  let pageResult
  try {
    pageResult = await getEnrollmentQuestionsPage(run.enrollment_slug!, page, PAGE_SIZE)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    await sb
      .from('runs')
      .update({ state: 'error', error_message: `Medvin fetch failed: ${msg}` })
      .eq('id', run.id)
    await logError('cron.detect', `Medvin fetch failed for page ${page}`, {
      run_id: run.id,
      page,
      error: msg,
    })
    return
  }

  if (page === 1 && run.total_pages == null && pageResult.lastPage != null) {
    await sb.from('runs').update({ total_pages: pageResult.lastPage }).eq('id', run.id)
  }

  type DetOutcome =
    | { ok: true; question: MedvinQuestion; det: DetectionResult }
    | { ok: false; error: string }

  const outcomes = await mapWithConcurrency<MedvinQuestion, DetOutcome>(
    pageResult.questions,
    DETECT_CONCURRENCY,
    async (q): Promise<DetOutcome> => {
      try {
        const det = await detect(q)
        return { ok: true, question: q, det }
      } catch (e) {
        const error = e instanceof Error ? `${e.name}: ${e.message}` : String(e)
        await logError('cron.detect', 'detector LLM call failed', {
          run_id: run.id,
          question_id: q.id,
          error,
        })
        return { ok: false, error }
      }
    }
  )

  const flagged: { question: MedvinQuestion; det: DetectionResult }[] = []
  let errors = 0
  let lowConfidenceSkipped = 0
  for (const o of outcomes) {
    if (!o.ok) {
      errors++
      continue
    }
    if (!o.det.is_obvious) continue
    // Hard confidence floor — even if the model says is_obvious=true, we
    // don't flag unless it's at least somewhat sure. Cuts noisy false positives.
    if (
      typeof o.det.confidence !== 'number' ||
      o.det.confidence < MIN_FLAG_CONFIDENCE
    ) {
      lowConfidenceSkipped++
      continue
    }
    flagged.push({ question: o.question, det: o.det })
  }

  const inserted: string[] = []
  for (const { question, det } of flagged) {
    const insertRow = {
      run_id: run.id,
      medvin_question_id: question.id,
      medvin_question_bank_id:
        typeof question.question_bank_id === 'number'
          ? question.question_bank_id
          : run.question_bank_id,
      medvin_topic_id: typeof question.topic_id === 'number' ? question.topic_id : null,
      medvin_unit_id: typeof question.unit_id === 'number' ? question.unit_id : null,
      question_type: questionTypeSlug(question),
      detection_reason: det.reason,
      detection_confidence: det.confidence,
      length_ratio: det.length_ratio,
      original_question_text: question.question_text,
      original_options: question.options,
      original_payload: question,
      ai_model_used: DETECT_MODEL,
      ai_prompt_version: DETECT_PROMPT_VERSION,
      status: 'pending_rewrite',
    }
    const { data, error } = await sb
      .from('review_items')
      .insert(insertRow)
      .select('id')
      .maybeSingle()
    if (error) {
      if ((error as { code?: string }).code !== '23505') {
        console.error('[cron/detect:bg] insert failed', {
          question_id: question.id,
          err: error,
        })
      }
      continue
    }
    if (data?.id) inserted.push(data.id)
  }

  const nextPage = page + 1
  const isLast = pageResult.lastPage != null && page >= pageResult.lastPage
  const updates: Record<string, unknown> = {
    cursor: { page: nextPage },
    total_scanned: run.total_scanned + pageResult.questions.length,
    total_flagged: run.total_flagged + inserted.length,
    total_errors: run.total_errors + errors,
  }
  if (isLast) {
    updates.state = 'rewriting'
  }
  await sb.from('runs').update(updates).eq('id', run.id)

  await logInfo(
    'cron.detect',
    `Page ${page} done — ${inserted.length} flagged of ${pageResult.questions.length} scanned (skipped ${lowConfidenceSkipped} low-confidence, ${errors} errors)`,
    {
      run_id: run.id,
      page,
      last_page: pageResult.lastPage,
      questions_scanned: pageResult.questions.length,
      flagged: inserted.length,
      low_confidence_skipped: lowConfidenceSkipped,
      errors,
      min_confidence: MIN_FLAG_CONFIDENCE,
      is_last_page: isLast,
    }
  )
}

// Module-level guard so concurrent cron pings don't double-process the same
// run. Cron-job.org could fire two ticks in quick succession; this throws away
// the second one cheaply at the HTTP layer.
let inflight: Promise<void> | null = null

/**
 * POST /api/cron/detect
 *
 * Returns 202 immediately and processes the page in the background. The
 * actual work is shaped to be idempotent (partial unique index on the
 * pending status set) so a process restart mid-page just causes a retry.
 *
 * Designed to play nicely with cron-job.org's 30s request timeout.
 */
export const POST = withCronAuth(async () => {
  if (inflight) {
    return NextResponse.json({
      ok: true,
      accepted: false,
      note: 'previous tick still running',
    })
  }

  const sb = await createServiceRoleClient()
  const { data: run, error: runErr } = await sb
    .from('runs')
    .select(
      'id, question_bank_id, enrollment_slug, cursor, total_pages, total_scanned, total_flagged, total_errors'
    )
    .eq('state', 'detecting')
    .order('started_at')
    .limit(1)
    .maybeSingle<Run>()

  if (runErr) {
    return NextResponse.json({ error: 'db_error', detail: runErr.message }, { status: 500 })
  }
  if (!run) {
    return NextResponse.json({ ok: true, accepted: false, note: 'no detecting runs' })
  }
  if (!run.enrollment_slug) {
    await sb
      .from('runs')
      .update({ state: 'error', error_message: 'enrollment_slug not set on run' })
      .eq('id', run.id)
    return NextResponse.json({ error: 'invalid_run', run_id: run.id }, { status: 500 })
  }

  // Fire-and-forget: kick off the heavy work, return immediately.
  inflight = processOnePage(run)
    .catch((e) => {
      console.error('[cron/detect] background task threw', e)
    })
    .finally(() => {
      inflight = null
    })

  return NextResponse.json({
    ok: true,
    accepted: true,
    run_id: run.id,
    page: run.cursor?.page ?? 1,
    note: 'processing in background',
  })
})
