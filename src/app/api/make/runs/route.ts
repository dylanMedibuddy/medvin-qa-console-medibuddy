import { NextResponse, type NextRequest } from 'next/server'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { badRequest, isObject, withMakeAuth } from '@/lib/api/make-auth'

export const POST = withMakeAuth(async (request: NextRequest) => {
  const body = (await request.json().catch(() => null)) as unknown
  if (!isObject(body)) return badRequest(['<body>'])

  const fields: string[] = []
  if (typeof body.question_bank_id !== 'number') fields.push('question_bank_id')
  if (
    body.question_bank_title !== null &&
    body.question_bank_title !== undefined &&
    typeof body.question_bank_title !== 'string'
  ) {
    fields.push('question_bank_title')
  }
  if (typeof body.triggered_by !== 'string') fields.push('triggered_by')
  if (fields.length) return badRequest(fields)

  const sb = await createServiceRoleClient()
  const { data, error } = await sb
    .from('runs')
    .insert({
      question_bank_id: body.question_bank_id,
      question_bank_title: body.question_bank_title ?? null,
      triggered_by: body.triggered_by,
    })
    .select('id')
    .single()

  if (error || !data) {
    return NextResponse.json(
      { error: 'db_error', detail: error?.message ?? 'insert failed' },
      { status: 500 }
    )
  }
  return NextResponse.json({ run_id: data.id }, { status: 201 })
})
