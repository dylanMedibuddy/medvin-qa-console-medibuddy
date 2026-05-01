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

/**
 * POST /api/cron/rewrite
 *
 * Picks up to BATCH_SIZE items in `status='pending_rewrite'`, runs the AI
 * rewriter on each, validates the rewrite against the original, and either:
 *   - flips status to `pending_review` with proposed_* populated (success)
 *   - flips status to `rejected` with reviewer_notes explaining the failure
 *     (rewriter said it couldn't do it, or output failed validation)
 *
 * After the batch, checks if any `state='rewriting'` runs have no remaining
 * pending_rewrite items — if so, flips the run to `state='finished'`.
 */
export const POST = withCronAuth(async () => {
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

  let succeeded = 0
  let rewriterFailed = 0
  let validationFailed = 0
  let llmErrors = 0

  for (const item of items ?? []) {
    let result: RewriteResult
    try {
      result = await rewriteOne(item)
    } catch (e) {
      llmErrors++
      console.error('[cron/rewrite] LLM failed', { item_id: item.id, err: e })
      continue
    }

    if (isRewriteFailed(result)) {
      rewriterFailed++
      await sb
        .from('review_items')
        .update({
          status: 'rejected',
          reviewer_notes: `[auto-rejected: rewriter] ${result.reason}`,
        })
        .eq('id', item.id)
      continue
    }

    const success = result as RewriteSuccess
    const errors = validateRewrite(
      item.original_options as unknown[],
      success.options as unknown[],
      success.question_text
    )
    if (errors.length) {
      validationFailed++
      console.warn('[cron/rewrite] validation failed', {
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
      continue
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
    succeeded++
  }

  // After the batch, finish any rewriting runs that have no pending items left.
  await finishCompletedRuns(sb)

  return NextResponse.json({
    ok: true,
    processed: items?.length ?? 0,
    succeeded,
    rewriter_failed: rewriterFailed,
    validation_failed: validationFailed,
    llm_errors: llmErrors,
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
