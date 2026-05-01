import { NextResponse, type NextRequest } from 'next/server'

type Handler = (request: NextRequest) => Promise<NextResponse>

function log(method: string, path: string, status: number, startedAt: number) {
  const ms = Date.now() - startedAt
  console.log(`[cron] ${method} ${path} → ${status} (${ms}ms)`)
}

/**
 * Wraps a cron route handler with: x-cron-secret header check, request
 * logging, and a 500 catch-all. Cron jobs are idempotent and safe to retry —
 * if one invocation fails, the next scheduled tick picks up where it left off.
 */
export function withCronAuth(handler: Handler): Handler {
  return async (request) => {
    const started = Date.now()
    const path = new URL(request.url).pathname
    const expected = process.env.CRON_SECRET
    if (!expected) {
      log(request.method, path, 500, started)
      return NextResponse.json(
        { error: 'server_misconfigured', detail: 'CRON_SECRET not set' },
        { status: 500 }
      )
    }
    const provided = request.headers.get('x-cron-secret')
    if (!provided || provided !== expected) {
      log(request.method, path, 401, started)
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
    }
    try {
      const response = await handler(request)
      log(request.method, path, response.status, started)
      return response
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e)
      console.error(`[cron] ${request.method} ${path} → 500`, e)
      log(request.method, path, 500, started)
      return NextResponse.json({ error: 'internal', detail }, { status: 500 })
    }
  }
}
