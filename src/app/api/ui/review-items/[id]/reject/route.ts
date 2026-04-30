import { NextResponse, type NextRequest } from 'next/server'
import { withUiAuth } from '@/lib/api/ui-auth'
import { isObject } from '@/lib/api/make-auth'
import type { RejectReason } from '@/lib/types'

type Ctx = { params: Promise<{ id: string }> }

const VALID_REASONS: readonly RejectReason[] = [
  'false_flag',
  'rewrite_wrong',
  'flag_correct_rewrite_failed',
  'other',
]

export const POST = withUiAuth<Ctx>(async (request: NextRequest, ctx: Ctx, auth) => {
  const { id } = await ctx.params
  const body = (await request.json().catch(() => null)) as unknown
  if (!isObject(body)) {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 })
  }

  const reason = body.reject_reason
  const notes =
    typeof body.reviewer_notes === 'string' ? body.reviewer_notes.trim() || null : null

  if (typeof reason !== 'string' || !VALID_REASONS.includes(reason as RejectReason)) {
    return NextResponse.json(
      { error: 'invalid_body', fields: ['reject_reason'] },
      { status: 400 }
    )
  }
  if (reason === 'other' && !notes) {
    return NextResponse.json(
      {
        error: 'invalid_body',
        fields: ['reviewer_notes'],
        detail: 'reviewer_notes required when reject_reason is "other"',
      },
      { status: 400 }
    )
  }

  const { data: item, error: fetchErr } = await auth.serviceRole
    .from('review_items')
    .select('id, status')
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

  const { data: updated, error: updateErr } = await auth.serviceRole
    .from('review_items')
    .update({
      status: 'rejected',
      reviewed_by: auth.user.id,
      reviewed_at: new Date().toISOString(),
      reviewer_notes: notes,
    })
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

  const { error: auditErr } = await auth.serviceRole.from('audit_log').insert({
    review_item_id: id,
    actor_user_id: auth.user.id,
    actor_type: 'user',
    action: 'rejected',
    from_status: 'pending_review',
    to_status: 'rejected',
    diff: { reject_reason: reason },
  })
  if (auditErr) {
    console.error('[ui] audit_log insert failed', auditErr)
  }

  return NextResponse.json(updated)
})
