import { NextResponse, type NextRequest } from 'next/server'
import { withUiAuth } from '@/lib/api/ui-auth'
import { isObject } from '@/lib/api/make-auth'
import { executeCommand, parseCommand } from '@/lib/console-commands'

/**
 * POST /api/ui/console
 * Body: { command: string }
 *
 * Parses + runs read-only debug commands. See src/lib/console-commands.ts
 * for the command grammar and available commands.
 */
export const POST = withUiAuth(async (request: NextRequest, _ctx, auth) => {
  const body = (await request.json().catch(() => null)) as unknown
  if (!isObject(body)) {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 })
  }
  if (typeof body.command !== 'string') {
    return NextResponse.json(
      { error: 'invalid_body', fields: ['command'] },
      { status: 400 }
    )
  }
  const parsed = parseCommand(body.command)
  if (!parsed) {
    return NextResponse.json({
      ok: true,
      output: { type: 'text', text: '' },
    })
  }
  const output = await executeCommand(auth.serviceRole, parsed)
  return NextResponse.json({ ok: true, command: parsed, output })
})
