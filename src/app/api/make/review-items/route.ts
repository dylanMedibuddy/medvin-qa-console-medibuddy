import { NextResponse, type NextRequest } from 'next/server'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { badRequest, isObject, withMakeAuth } from '@/lib/api/make-auth'

export const POST = withMakeAuth(async (request: NextRequest) => {
  const body = (await request.json().catch(() => null)) as unknown
  if (!isObject(body)) return badRequest(['<body>'])

  const fields: string[] = []
  const requireString = (k: string) => {
    if (typeof body[k] !== 'string') fields.push(k)
  }
  const requireNumber = (k: string) => {
    if (typeof body[k] !== 'number') fields.push(k)
  }
  const nullableNumber = (k: string) => {
    if (body[k] !== null && body[k] !== undefined && typeof body[k] !== 'number') fields.push(k)
  }
  const requireArray = (k: string) => {
    if (!Array.isArray(body[k])) fields.push(k)
  }
  const requireObject = (k: string) => {
    if (!isObject(body[k])) fields.push(k)
  }

  requireString('run_id')
  requireNumber('medvin_question_id')
  requireNumber('medvin_question_bank_id')
  nullableNumber('medvin_topic_id')
  nullableNumber('medvin_unit_id')
  requireString('question_type')
  requireString('detection_reason')
  nullableNumber('length_ratio')
  requireString('original_question_text')
  requireArray('original_options')
  requireObject('original_payload')
  requireString('proposed_question_text')
  requireArray('proposed_options')
  requireObject('proposed_patch_payload')
  requireNumber('rewrite_confidence')
  requireString('ai_model_used')
  requireString('ai_prompt_version')

  if (fields.length) return badRequest(fields)

  const sb = await createServiceRoleClient()
  const { data, error } = await sb
    .from('review_items')
    .insert({
      run_id: body.run_id,
      medvin_question_id: body.medvin_question_id,
      medvin_question_bank_id: body.medvin_question_bank_id,
      medvin_topic_id: body.medvin_topic_id ?? null,
      medvin_unit_id: body.medvin_unit_id ?? null,
      question_type: body.question_type,
      detection_reason: body.detection_reason,
      length_ratio: body.length_ratio ?? null,
      original_question_text: body.original_question_text,
      original_options: body.original_options,
      original_payload: body.original_payload,
      proposed_question_text: body.proposed_question_text,
      proposed_options: body.proposed_options,
      proposed_patch_payload: body.proposed_patch_payload,
      rewrite_confidence: body.rewrite_confidence,
      ai_model_used: body.ai_model_used,
      ai_prompt_version: body.ai_prompt_version,
      status: 'pending_review',
    })
    .select('id, status')
    .single()

  if (error) {
    if (error.code === '23505') {
      return NextResponse.json(
        { error: 'already_in_queue', medvin_question_id: body.medvin_question_id },
        { status: 409 }
      )
    }
    if (error.code === '23503') {
      return NextResponse.json(
        { error: 'invalid_foreign_key', detail: error.message },
        { status: 400 }
      )
    }
    return NextResponse.json({ error: 'db_error', detail: error.message }, { status: 500 })
  }
  if (!data) {
    return NextResponse.json({ error: 'db_error', detail: 'insert returned no row' }, { status: 500 })
  }

  const { error: auditErr } = await sb.from('audit_log').insert({
    review_item_id: data.id,
    actor_user_id: null,
    actor_type: 'system',
    action: 'created',
    from_status: null,
    to_status: 'pending_review',
  })
  if (auditErr) {
    console.error('[make] audit_log insert failed', auditErr)
  }

  return NextResponse.json({ review_item_id: data.id, status: data.status }, { status: 201 })
})
