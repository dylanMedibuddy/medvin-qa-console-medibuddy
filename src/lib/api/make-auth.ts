import { NextResponse, type NextRequest } from 'next/server'

type Handler<TCtx> = (request: NextRequest, ctx: TCtx) => Promise<NextResponse>

function log(method: string, path: string, status: number, startedAt: number) {
  const ms = Date.now() - startedAt
  console.log(`[make] ${method} ${path} → ${status} (${ms}ms)`)
}

function checkApiKey(request: NextRequest): NextResponse | null {
  const expected = process.env.MAKE_API_KEY
  if (!expected) {
    return NextResponse.json(
      { error: 'server_misconfigured', detail: 'MAKE_API_KEY not set' },
      { status: 500 }
    )
  }
  const key = request.headers.get('x-api-key')
  if (!key || key !== expected) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  return null
}

export function withMakeAuth<TCtx = unknown>(handler: Handler<TCtx>): Handler<TCtx> {
  return async (request, ctx) => {
    const started = Date.now()
    const path = new URL(request.url).pathname
    const authError = checkApiKey(request)
    if (authError) {
      log(request.method, path, authError.status, started)
      return authError
    }
    try {
      const response = await handler(request, ctx)
      log(request.method, path, response.status, started)
      return response
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e)
      console.error(`[make] ${request.method} ${path} → 500`, e)
      log(request.method, path, 500, started)
      return NextResponse.json({ error: 'internal', detail }, { status: 500 })
    }
  }
}

export function badRequest(fields: string[], error = 'invalid_body') {
  return NextResponse.json({ error, fields }, { status: 400 })
}

export function isObject(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x)
}
