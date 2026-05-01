import { NextResponse } from 'next/server'
import { withCronAuth } from '@/lib/api/cron-auth'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { chatCompleteJson } from '@/lib/llm'
import {
  REWRITE_MODEL,
  REWRITE_PROMPT_VERSION,
  REWRITE_SYSTEM_PROMPT,
  buildRewriteUserPrompt,
  isRewriteFailed,
  type RewriteResult,
  type RewriteSuccess,
} from '@/lib/prompts/rewrite'
import { validateRewrite } from '@/lib/api/review-validation'

const BATCH_SIZE = 10
const REWRITE_CONCURRENCY = 5

type Item = {
  id: string
  run_id: string | null
  detection_reason: string
  length_ratio: number | null
  original_question_text: string
  original_options: unknown
}

async function rewriteOne(item: Item): Promise<RewriteResult> {
  return chatCompleteJson<RewriteResult>({
    model: REWRITE_MODEL,
    systemPrompt: REWRITE_SYSTEM_PROMPT,
    userPrompt: buildRewriteUserPrompt({
      originalQuestionText: item.original_question_text,
      originalOptions: item.original_options,
      detectionReason: item.detection_reason,
      lengthRatio: item.length_ratio,
    }),
    maxTokens: 2048,
    temperature: 1,
  })
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let next = 0
  async function worker() {
    while (true) {
      const i = next++
      if (i >= items.length) return
      results[i] = await fn(items[i])
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => worker())
  )
  return results
}

async function processBatch(items: Item[]): Promise<void> {
  const sb = await createServiceRoleClient()

  await mapWithConcurrency(items, REWRITE_CONCURRENCY, async (item) => {
    let result: RewriteResult
    try {
      result = await rewriteOne(item)
    } catch (e) {
      console.error('[cron/rewrite:bg] LLM failed', { item_id: item.id, err: e })
      return
    }

    if (isRewriteFailed(result)) {
      await sb
        .from('review_items')
        .update({
          status: 'rejected',
          reviewer_notes: `[auto-rejected: rewriter] ${result.reason}`,
        })
        .eq('id', item.id)
      return
    }

    const success = result as RewriteSuccess
    const errors = validateRewrite(
      item.original_options as unknown[],
      success.options as unknown[],
      success.question_text
    )
    if (errors.length) {
      console.warn('[cron/rewrite:bg] validation failed', {
        item_id: item.id,
        errors,
      })
      await sb
        .from('review_items')
        .update({
          status: 'rejected',
          reviewer_notes: `[auto-rejected: validation] ${errors.join('; ')}`,
        })
        .eq('id', item.id)
      return
    }

    await sb
      .from('review_items')
      .update({
        proposed_question_text: success.question_text,
        proposed_options: success.options,
        proposed_patch_payload: {
          question_text: success.question_text,
          options: success.options,
        },
        rewrite_confidence: success.confidence,
        ai_model_used: REWRITE_MODEL,
        ai_prompt_version: REWRITE_PROMPT_VERSION,
        status: 'pending_review',
      })
      .eq('id', item.id)
  })

  await finishCompletedRuns(sb)
}

let inflight: Promise<void> | null = null

/**
 * POST /api/cron/rewrite
 *
 * Returns 202 immediately and processes a batch in the background. Designed
 * to play nicely with cron-job.org's 30s request timeout. Idempotent — if
 * the process dies mid-batch, the unprocessed items remain `pending_rewrite`
 * and the next cron tick picks them up.
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

  const { data: items, error: fetchErr } = await sb
    .from('review_items')
    .select(
      'id, run_id, detection_reason, length_ratio, original_question_text, original_options'
    )
    .eq('status', 'pending_rewrite')
    .order('created_at')
    .limit(BATCH_SIZE)
    .returns<Item[]>()

  if (fetchErr) {
    return NextResponse.json({ error: 'db_error', detail: fetchErr.message }, { status: 500 })
  }

  if (!items?.length) {
    // No items pending; opportunistically finish any rewriting runs that are done
    await finishCompletedRuns(sb)
    return NextResponse.json({
      ok: true,
      accepted: false,
      note: 'no pending_rewrite items',
    })
  }

  inflight = processBatch(items)
    .catch((e) => {
      console.error('[cron/rewrite] background task threw', e)
    })
    .finally(() => {
      inflight = null
    })

  return NextResponse.json({
    ok: true,
    accepted: true,
    batch_size: items.length,
    note: 'processing in background',
  })
})

async function finishCompletedRuns(
  sb: Awaited<ReturnType<typeof createServiceRoleClient>>
) {
  const { data: rewritingRuns } = await sb
    .from('runs')
    .select('id')
    .eq('state', 'rewriting')

  if (!rewritingRuns?.length) return

  for (const run of rewritingRuns) {
    const { count } = await sb
      .from('review_items')
      .select('*', { count: 'exact', head: true })
      .eq('run_id', run.id)
      .eq('status', 'pending_rewrite')

    if ((count ?? 0) === 0) {
      await sb
        .from('runs')
        .update({ state: 'finished', finished_at: new Date().toISOString() })
        .eq('id', run.id)
    }
  }
}
