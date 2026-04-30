import { NextResponse, type NextRequest } from 'next/server'
import { withUiAuth } from '@/lib/api/ui-auth'
import { isObject } from '@/lib/api/make-auth'
import type { RejectReason } from '@/lib/types'

const VALID_REASONS: readonly RejectReason[] = [
  'false_flag',
  'rewrite_wrong',
  'flag_correct_rewrite_failed',
  'other',
]

export const POST = withUiAuth(async (request: NextRequest, _ctx: unknown, auth) => {
  const body = (await request.json().catch(() => null)) as unknown
  if (!isObject(body)) {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 })
  }

  const ids = body.review_item_ids
  const action = body.action
  const reason = body.reject_reason
  const notes =
    typeof body.reviewer_notes === 'string' ? body.reviewer_notes.trim() || null : null

  if (
    !Array.isArray(ids) ||
    ids.length === 0 ||
    ids.some((id) => typeof id !== 'string')
  ) {
    return NextResponse.json(
      { error: 'invalid_body', fields: ['review_item_ids'] },
      { status: 400 }
    )
  }
  if (action !== 'approve' && action !== 'reject') {
    return NextResponse.json({ error: 'invalid_body', fields: ['action'] }, { status: 400 })
  }
  if (action === 'reject') {
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
  }

  const stringIds = ids as string[]
  const { data: existing, error: fetchErr } = await auth.serviceRole
    .from('review_items')
    .select('id, status')
    .in('id', stringIds)

  if (fetchErr) {
    return NextResponse.json({ error: 'db_error', detail: fetchErr.message }, { status: 500 })
  }

  const found = new Map((existing ?? []).map((i) => [i.id, i.status as string]))
  const skipped: { id: string; reason: string }[] = []
  const actionable: string[] = []

  for (const id of stringIds) {
    const status = found.get(id)
    if (!status) skipped.push({ id, reason: 'not_found' })
    else if (status !== 'pending_review')
      skipped.push({ id, reason: `not_pending_review (was ${status})` })
    else actionable.push(id)
  }

  const succeeded: string[] = []

  if (actionable.length) {
    const newStatus = action === 'approve' ? 'approved_pending_push' : 'rejected'
    const updatePayload: Record<string, unknown> = {
      status: newStatus,
      reviewed_by: auth.user.id,
      reviewed_at: new Date().toISOString(),
    }
    if (notes) updatePayload.reviewer_notes = notes

    const { data: updated, error: updateErr } = await auth.serviceRole
      .from('review_items')
      .update(updatePayload)
      .in('id', actionable)
      .eq('status', 'pending_review')
      .select('id')

    if (updateErr) {
      return NextResponse.json({ error: 'db_error', detail: updateErr.message }, { status: 500 })
    }

    const updatedSet = new Set((updated ?? []).map((u) => u.id))
    for (const id of actionable) {
      if (updatedSet.has(id)) succeeded.push(id)
      else skipped.push({ id, reason: 'race_condition_lost' })
    }

    if (succeeded.length) {
      const auditAction = action === 'approve' ? 'approved' : 'rejected'
      const diff = action === 'reject' ? { reject_reason: reason } : null
      const auditRows = succeeded.map((reviewItemId) => ({
        review_item_id: reviewItemId,
        actor_user_id: auth.user.id,
        actor_type: 'user',
        action: auditAction,
        from_status: 'pending_review',
        to_status: newStatus,
        diff,
      }))
      const { error: auditErr } = await auth.serviceRole.from('audit_log').insert(auditRows)
      if (auditErr) {
        console.error('[ui] audit_log bulk insert failed', auditErr)
      }
    }
  }

  return NextResponse.json({ succeeded, skipped })
})
