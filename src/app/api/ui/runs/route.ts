import { NextResponse, type NextRequest } from 'next/server'
import { withUiAuth } from '@/lib/api/ui-auth'
import { isObject } from '@/lib/api/make-auth'

/**
 * "Run now" — kicks off an in-app detection run.
 *
 * Body: { question_bank_id: number, question_bank_title: string, enrollment_slug: string }
 *
 * Inserts a row into `runs` with state='detecting' and cursor={page:1}. The
 * /api/cron/detect job picks it up on its next tick and starts walking pages.
 *
 * Replaces the old Make Scenario A webhook trigger.
 */
export const POST = withUiAuth(async (request: NextRequest, _ctx, auth) => {
  const body = (await request.json().catch(() => null)) as unknown
  if (!isObject(body)) {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 })
  }

  const fields: string[] = []
  if (typeof body.question_bank_id !== 'number') fields.push('question_bank_id')
  if (typeof body.question_bank_title !== 'string') fields.push('question_bank_title')
  if (typeof body.enrollment_slug !== 'string') fields.push('enrollment_slug')
  if (fields.length) {
    return NextResponse.json({ error: 'invalid_body', fields }, { status: 400 })
  }

  const { data, error } = await auth.serviceRole
    .from('runs')
    .insert({
      question_bank_id: body.question_bank_id,
      question_bank_title: body.question_bank_title,
      enrollment_slug: body.enrollment_slug,
      triggered_by: `ui:${auth.user.email}`,
      state: 'detecting',
      cursor: { page: 1 },
    })
    .select('id')
    .single()

  if (error || !data) {
    return NextResponse.json(
      { error: 'db_error', detail: error?.message ?? 'insert failed' },
      { status: 500 }
    )
  }

  return NextResponse.json({
    ok: true,
    run_id: data.id,
    bank: { id: body.question_bank_id, title: body.question_bank_title },
    triggered_at: new Date().toISOString(),
  })
})
