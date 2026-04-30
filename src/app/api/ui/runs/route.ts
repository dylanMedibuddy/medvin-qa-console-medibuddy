import { NextResponse, type NextRequest } from 'next/server'
import { withUiAuth } from '@/lib/api/ui-auth'
import { isObject } from '@/lib/api/make-auth'
import { BANKS } from '@/lib/banks'

/**
 * "Run now" — kicks off a Make Scenario A detection batch.
 *
 * Body: { question_bank_id: number }
 *
 * Posts the bank metadata to the Make webhook configured in
 * MAKE_SCENARIO_A_WEBHOOK_URL. Make is responsible for creating its own
 * runs row via POST /api/make/runs and finishing it via PATCH /finish.
 */
export const POST = withUiAuth(async (request: NextRequest, _ctx, auth) => {
  const body = (await request.json().catch(() => null)) as unknown
  if (!isObject(body)) {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 })
  }

  const bankId = body.question_bank_id
  if (typeof bankId !== 'number') {
    return NextResponse.json(
      { error: 'invalid_body', fields: ['question_bank_id'] },
      { status: 400 }
    )
  }

  const bank = BANKS.find((b) => b.id === bankId)
  if (!bank) {
    return NextResponse.json(
      { error: 'unknown_bank', question_bank_id: bankId },
      { status: 400 }
    )
  }

  const webhookUrl = process.env.MAKE_SCENARIO_A_WEBHOOK_URL
  if (!webhookUrl) {
    return NextResponse.json(
      {
        error: 'webhook_not_configured',
        detail: 'MAKE_SCENARIO_A_WEBHOOK_URL is not set on the server',
      },
      { status: 500 }
    )
  }

  const triggeredBy = `ui:${auth.user.email}`
  const payload = {
    question_bank_id: bank.id,
    question_bank_title: bank.title,
    triggered_by: triggeredBy,
  }

  let upstream: Response
  try {
    upstream = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    })
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e)
    return NextResponse.json(
      { error: 'webhook_unreachable', detail },
      { status: 502 }
    )
  }

  if (!upstream.ok) {
    const text = await upstream.text().catch(() => '')
    return NextResponse.json(
      {
        error: 'webhook_failed',
        upstream_status: upstream.status,
        detail: text.slice(0, 500),
      },
      { status: 502 }
    )
  }

  return NextResponse.json({
    ok: true,
    bank: { id: bank.id, title: bank.title },
    triggered_by: triggeredBy,
    triggered_at: new Date().toISOString(),
  })
})
