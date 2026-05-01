import { NextResponse } from 'next/server'
import { withCronAuth } from '@/lib/api/cron-auth'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { getEnrollmentQuestionsPage, type MedvinQuestion } from '@/lib/medvin'
import { chatCompleteJson } from '@/lib/llm'
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

// Tuned so each cron tick stays well under the 100s Cloudflare proxy timeout
// even on a slow LLM. PAGE_SIZE × LATENCY / CONCURRENCY = expected wall time.
// 50 questions × 3s / 10 parallel = ~15s per tick.
const PAGE_SIZE = 50
const DETECT_CONCURRENCY = 10

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
 * POST /api/cron/detect
 *
 * Picks the oldest run in `state='detecting'`, fetches its next page from
 * Medvin, runs the AI detector on each question, and inserts flagged ones as
 * `pending_rewrite` review_items. Advances the cursor by one page.
 *
 * When the page is past the bank's last_page, flips the run to `state='rewriting'`.
 *
 * Idempotent — duplicate inserts blocked by the partial unique index.
 */
export const POST = withCronAuth(async () => {
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
    return NextResponse.json({ ok: true, processed: 0, note: 'no detecting runs' })
  }
  if (!run.enrollment_slug) {
    await sb
      .from('runs')
      .update({ state: 'error', error_message: 'enrollment_slug not set on run' })
      .eq('id', run.id)
    return NextResponse.json({ error: 'invalid_run', run_id: run.id }, { status: 500 })
  }

  const page = run.cursor?.page ?? 1

  let pageResult
  try {
    pageResult = await getEnrollmentQuestionsPage(run.enrollment_slug, page, PAGE_SIZE)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    await sb
      .from('runs')
      .update({ state: 'error', error_message: `Medvin fetch failed: ${msg}` })
      .eq('id', run.id)
    return NextResponse.json({ error: 'medvin_fetch_failed', detail: msg }, { status: 500 })
  }

  // Capture total_pages on first page so the UI can show progress.
  if (page === 1 && run.total_pages == null && pageResult.lastPage != null) {
    await sb.from('runs').update({ total_pages: pageResult.lastPage }).eq('id', run.id)
  }

  // Run detector on every question on this page in parallel (concurrency-capped).
  // Sequential was too slow — 50 calls × 3s = 150s exceeded the 100s edge timeout.
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
        console.error('[cron/detect] detector failed', { question_id: q.id, error })
        return { ok: false, error }
      }
    }
  )

  const flagged: { question: MedvinQuestion; det: DetectionResult }[] = []
  let errors = 0
  let firstError: string | null = null
  for (const o of outcomes) {
    if (!o.ok) {
      errors++
      if (!firstError) firstError = o.error
      continue
    }
    if (o.det.is_obvious) flagged.push({ question: o.question, det: o.det })
  }

  // Insert flagged items. Uses upsert-style: ignore conflicts so reruns don't fail.
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
      // 23505 = duplicate; means the question was already flagged in a prior
      // run and isn't yet pushed — skip silently.
      if ((error as { code?: string }).code !== '23505') {
        console.error('[cron/detect] insert failed', { question_id: question.id, err: error })
      }
      continue
    }
    if (data?.id) inserted.push(data.id)
  }

  // Advance cursor.
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

  return NextResponse.json({
    ok: true,
    run_id: run.id,
    page,
    last_page: pageResult.lastPage,
    questions_on_page: pageResult.questions.length,
    flagged: inserted.length,
    detector_errors: errors,
    first_detector_error: firstError,
    state: isLast ? 'rewriting' : 'detecting',
  })
})
