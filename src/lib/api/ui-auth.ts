import { NextResponse, type NextRequest } from 'next/server'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import type { SupabaseClient } from '@supabase/supabase-js'

export type UiAuth = {
  user: { id: string; email: string }
  role: 'reviewer' | 'admin'
  /** Service-role client. Use for writes that bypass RLS (audit_log inserts). */
  serviceRole: SupabaseClient
}

type Handler<TCtx> = (
  request: NextRequest,
  ctx: TCtx,
  auth: UiAuth
) => Promise<NextResponse>

function log(method: string, path: string, status: number, startedAt: number) {
  const ms = Date.now() - startedAt
  console.log(`[ui] ${method} ${path} → ${status} (${ms}ms)`)
}

/**
 * Wraps a route handler with: session auth check, profile lookup, role gate
 * (reviewer or admin only), service-role client injection, request logging,
 * and a 500 catch-all.
 */
export function withUiAuth<TCtx = unknown>(
  handler: Handler<TCtx>
): (request: NextRequest, ctx: TCtx) => Promise<NextResponse> {
  return async (request, ctx) => {
    const started = Date.now()
    const path = new URL(request.url).pathname

    try {
      const sb = await createClient()
      const {
        data: { user },
      } = await sb.auth.getUser()

      if (!user) {
        const res = NextResponse.json({ error: 'unauthorized' }, { status: 401 })
        log(request.method, path, 401, started)
        return res
      }

      const { data: profile } = await sb
        .from('profiles')
        .select('role')
        .eq('id', user.id)
        .single<{ role: 'reviewer' | 'admin' }>()

      if (!profile || (profile.role !== 'reviewer' && profile.role !== 'admin')) {
        const res = NextResponse.json({ error: 'forbidden' }, { status: 403 })
        log(request.method, path, 403, started)
        return res
      }

      const auth: UiAuth = {
        user: { id: user.id, email: user.email ?? '' },
        role: profile.role,
        serviceRole: await createServiceRoleClient(),
      }

      const response = await handler(request, ctx, auth)
      log(request.method, path, response.status, started)
      return response
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e)
      console.error(`[ui] ${request.method} ${path} → 500`, e)
      log(request.method, path, 500, started)
      return NextResponse.json({ error: 'internal', detail }, { status: 500 })
    }
  }
}
