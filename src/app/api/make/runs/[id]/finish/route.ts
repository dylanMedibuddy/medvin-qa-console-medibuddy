import { NextResponse, type NextRequest } from 'next/server'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { badRequest, isObject, withMakeAuth } from '@/lib/api/make-auth'

type Ctx = { params: Promise<{ id: string }> }

export const PATCH = withMakeAuth<Ctx>(async (request: NextRequest, ctx: Ctx) => {
  const { id } = await ctx.params
  const body = (await request.json().catch(() => null)) as unknown
  if (!isObject(body)) return badRequest(['<body>'])

  const fields: string[] = []
  if (typeof body.total_scanned !== 'number') fields.push('total_scanned')
  if (typeof body.total_flagged !== 'number') fields.push('total_flagged')
  if (typeof body.total_errors !== 'number') fields.push('total_errors')
  if (
    body.notes !== null &&
    body.notes !== undefined &&
    typeof body.notes !== 'string'
  ) {
    fields.push('notes')
  }
  if (fields.length) return badRequest(fields)

  const sb = await createServiceRoleClient()
  const { data, error } = await sb
    .from('runs')
    .update({
      total_scanned: body.total_scanned,
      total_flagged: body.total_flagged,
      total_errors: body.total_errors,
      notes: body.notes ?? null,
      finished_at: new Date().toISOString(),
    })
    .eq('id', id)
    .select('id')
    .maybeSingle()

  if (error) {
    return NextResponse.json({ error: 'db_error', detail: error.message }, { status: 500 })
  }
  if (!data) {
    return NextResponse.json({ error: 'run_not_found', run_id: id }, { status: 404 })
  }
  return NextResponse.json({ ok: true })
})
