import { NextResponse, type NextRequest } from 'next/server'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { badRequest, isObject, withMakeAuth } from '@/lib/api/make-auth'

type Ctx = { params: Promise<{ id: string }> }

const ALLOWED = ['pushed', 'push_error'] as const
type PushStatus = (typeof ALLOWED)[number]

/**
 * Make Scenario B reports the result of a Medvin PATCH back to us.
 *
 * Body:
 *   status         "pushed" | "push_error"
 *   patch_response jsonb (Medvin's response body or null)
 *
 * Allowed transitions:
 *   approved_pending_push → pushed | push_error
 *   push_error            → pushed | push_error  (retries from a failed push)
 */
export const PATCH = withMakeAuth<Ctx>(async (request: NextRequest, ctx: Ctx) => {
  const { id } = await ctx.params
  const body = (await request.json().catch(() => null)) as unknown
  if (!isObject(body)) return badRequest(['<body>'])

  const fields: string[] = []
  if (
    typeof body.status !== 'string' ||
    !ALLOWED.includes(body.status as PushStatus)
  ) {
    fields.push('status')
  }
  if (
    body.patch_response !== null &&
    body.patch_response !== undefined &&
    typeof body.patch_response !== 'object'
  ) {
    fields.push('patch_response')
  }
  if (fields.length) return badRequest(fields)

  const newStatus = body.status as PushStatus
  const sb = await createServiceRoleClient()

  const { data: existing, error: fetchErr } = await sb
    .from('review_items')
    .select('id, status')
    .eq('id', id)
    .maybeSingle()

  if (fetchErr) {
    return NextResponse.json(
      { error: 'db_error', detail: fetchErr.message },
      { status: 500 }
    )
  }
  if (!existing) {
    return NextResponse.json({ error: 'review_item_not_found', id }, { status: 404 })
  }
  if (existing.status !== 'approved_pending_push' && existing.status !== 'push_error') {
    return NextResponse.json(
      { error: 'invalid_transition', current_status: existing.status },
      { status: 400 }
    )
  }

  const update: Record<string, unknown> = {
    status: newStatus,
    patch_response: body.patch_response ?? null,
  }
  if (newStatus === 'pushed') {
    update.patched_at = new Date().toISOString()
  }

  const { error: updateErr } = await sb
    .from('review_items')
    .update(update)
    .eq('id', id)

  if (updateErr) {
    return NextResponse.json({ error: 'db_error', detail: updateErr.message }, { status: 500 })
  }

  const { error: auditErr } = await sb.from('audit_log').insert({
    review_item_id: id,
    actor_user_id: null,
    actor_type: 'system',
    action: newStatus,
    from_status: existing.status,
    to_status: newStatus,
  })
  if (auditErr) {
    console.error('[make] audit_log insert failed', auditErr)
  }

  return NextResponse.json({ ok: true })
})
