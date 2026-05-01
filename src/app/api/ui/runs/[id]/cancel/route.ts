import { NextResponse, type NextRequest } from 'next/server'
import { withUiAuth } from '@/lib/api/ui-auth'

type Ctx = { params: Promise<{ id: string }> }

/**
 * POST /api/ui/runs/:id/cancel
 *
 * Flips an in-flight run (state='detecting' or 'rewriting') to 'cancelled'.
 * Already-detected items keep their `pending_rewrite` status, so the rewrite
 * cron will continue to process them — cancelling only stops further detection
 * pages from being fetched.
 */
export const POST = withUiAuth<Ctx>(async (_request: NextRequest, ctx: Ctx, auth) => {
  const { id } = await ctx.params

  const { data: run, error: fetchErr } = await auth.serviceRole
    .from('runs')
    .select('id, state')
    .eq('id', id)
    .maybeSingle()

  if (fetchErr) {
    return NextResponse.json({ error: 'db_error', detail: fetchErr.message }, { status: 500 })
  }
  if (!run) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }
  if (run.state !== 'detecting' && run.state !== 'rewriting') {
    return NextResponse.json(
      { error: 'not_in_flight', current_state: run.state },
      { status: 400 }
    )
  }

  const { error: updateErr } = await auth.serviceRole
    .from('runs')
    .update({
      state: 'cancelled',
      error_message: `Cancelled by ${auth.user.email}`,
      finished_at: new Date().toISOString(),
    })
    .eq('id', id)
    // Atomic guard so two reviewers cancelling at once doesn't race.
    .in('state', ['detecting', 'rewriting'])

  if (updateErr) {
    return NextResponse.json({ error: 'db_error', detail: updateErr.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
})
