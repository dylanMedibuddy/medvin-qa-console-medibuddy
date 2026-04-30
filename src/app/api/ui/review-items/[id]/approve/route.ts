import { NextResponse, type NextRequest } from 'next/server'
import { withUiAuth } from '@/lib/api/ui-auth'
import { isObject } from '@/lib/api/make-auth'
import { validateRewrite } from '@/lib/api/review-validation'

type Ctx = { params: Promise<{ id: string }> }

export const POST = withUiAuth<Ctx>(async (request: NextRequest, ctx: Ctx, auth) => {
  const { id } = await ctx.params
  const raw = (await request.json().catch(() => ({}))) as unknown
  if (raw !== null && raw !== undefined && !isObject(raw)) {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 })
  }
  const body = (raw ?? {}) as Record<string, unknown>
  const editedProposal = isObject(body.edited_proposal) ? body.edited_proposal : null
  const reviewerNotes =
    typeof body.reviewer_notes === 'string' ? body.reviewer_notes.trim() || null : null

  // Fetch the existing item using the service-role client so we can reuse it
  // for the conditional update without a second auth round-trip.
  const { data: item, error: fetchErr } = await auth.serviceRole
    .from('review_items')
    .select(
      'id, status, original_options, proposed_question_text, proposed_options, proposed_patch_payload'
    )
    .eq('id', id)
    .maybeSingle()

  if (fetchErr) {
    return NextResponse.json({ error: 'db_error', detail: fetchErr.message }, { status: 500 })
  }
  if (!item) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }
  if (item.status !== 'pending_review') {
    return NextResponse.json(
      { error: 'not_pending_review', current_status: item.status },
      { status: 400 }
    )
  }

  let nextProposedQuestionText = item.proposed_question_text as string
  let nextProposedOptions = item.proposed_options as unknown
  let nextProposedPatchPayload = item.proposed_patch_payload as unknown
  const fieldsChanged: string[] = []

  if (editedProposal) {
    if (typeof editedProposal.proposed_question_text === 'string') {
      nextProposedQuestionText = editedProposal.proposed_question_text
    }
    if (Array.isArray(editedProposal.proposed_options)) {
      nextProposedOptions = editedProposal.proposed_options
    }
    if (isObject(editedProposal.proposed_patch_payload)) {
      nextProposedPatchPayload = editedProposal.proposed_patch_payload
    }

    const errors = validateRewrite(
      item.original_options as unknown[],
      nextProposedOptions as unknown[],
      nextProposedQuestionText
    )
    if (errors.length) {
      return NextResponse.json(
        { error: 'validation_failed', details: errors },
        { status: 400 }
      )
    }

    if (
      JSON.stringify(item.proposed_question_text) !==
      JSON.stringify(nextProposedQuestionText)
    ) {
      fieldsChanged.push('proposed_question_text')
    }
    if (JSON.stringify(item.proposed_options) !== JSON.stringify(nextProposedOptions)) {
      fieldsChanged.push('proposed_options')
    }
    if (
      JSON.stringify(item.proposed_patch_payload) !==
      JSON.stringify(nextProposedPatchPayload)
    ) {
      fieldsChanged.push('proposed_patch_payload')
    }
  }

  const updatePayload: Record<string, unknown> = {
    status: 'approved_pending_push',
    reviewed_by: auth.user.id,
    reviewed_at: new Date().toISOString(),
  }
  if (reviewerNotes !== null) updatePayload.reviewer_notes = reviewerNotes
  if (fieldsChanged.length) {
    updatePayload.proposed_question_text = nextProposedQuestionText
    updatePayload.proposed_options = nextProposedOptions
    updatePayload.proposed_patch_payload = nextProposedPatchPayload
  }

  // Atomic guard: only flip if still pending_review.
  const { data: updated, error: updateErr } = await auth.serviceRole
    .from('review_items')
    .update(updatePayload)
    .eq('id', id)
    .eq('status', 'pending_review')
    .select('*')
    .maybeSingle()

  if (updateErr) {
    return NextResponse.json({ error: 'db_error', detail: updateErr.message }, { status: 500 })
  }
  if (!updated) {
    return NextResponse.json(
      { error: 'not_pending_review', detail: 'race_condition_lost' },
      { status: 400 }
    )
  }

  const diff = fieldsChanged.length ? { edited: true, fields_changed: fieldsChanged } : null
  const { error: auditErr } = await auth.serviceRole.from('audit_log').insert({
    review_item_id: id,
    actor_user_id: auth.user.id,
    actor_type: 'user',
    action: 'approved',
    from_status: 'pending_review',
    to_status: 'approved_pending_push',
    diff,
  })
  if (auditErr) {
    console.error('[ui] audit_log insert failed', auditErr)
  }

  return NextResponse.json(updated)
})
