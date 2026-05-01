import { createClient } from '@/lib/supabase/server'
import { Nav } from '@/components/nav'
import { listQuestionBanks, type MedvinBank } from '@/lib/medvin'
import { RunForm } from './run-form'
import { RunRowActions } from './run-row-actions'
import {
  RUN_STATE_LABELS,
  RUN_STATE_STYLES,
  type RunState,
} from '@/lib/types'

type Run = {
  id: string
  started_at: string
  finished_at: string | null
  question_bank_id: number
  question_bank_title: string | null
  total_scanned: number
  total_flagged: number
  total_errors: number
  triggered_by: string | null
  notes: string | null
  state: RunState
  cursor: { page?: number } | null
  total_pages: number | null
  error_message: string | null
}

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function formatDuration(startIso: string, endIso: string | null) {
  if (!endIso) return '— in progress'
  const ms = new Date(endIso).getTime() - new Date(startIso).getTime()
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  const rs = s % 60
  if (m < 60) return `${m}m ${rs}s`
  const h = Math.floor(m / 60)
  return `${h}h ${m % 60}m`
}

async function fetchBanksSafely(): Promise<
  { ok: true; banks: MedvinBank[] } | { ok: false; error: string }
> {
  try {
    const banks = await listQuestionBanks()
    return { ok: true, banks }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

type RunBreakdown = {
  pending_rewrite: number
  pending_review: number
  approved_pending_push: number
  rejected: number
  pushed: number
  push_error: number
}

const EMPTY_BREAKDOWN: RunBreakdown = {
  pending_rewrite: 0,
  pending_review: 0,
  approved_pending_push: 0,
  rejected: 0,
  pushed: 0,
  push_error: 0,
}

export default async function RunsPage() {
  const supabase = await createClient()
  const [runsResult, banksResult, itemsForBreakdown] = await Promise.all([
    supabase
      .from('runs')
      .select(
        'id, started_at, finished_at, question_bank_id, question_bank_title, total_scanned, total_flagged, total_errors, triggered_by, notes, state, cursor, total_pages, error_message'
      )
      .order('started_at', { ascending: false })
      .limit(100)
      .returns<Run[]>(),
    fetchBanksSafely(),
    // Pull just (run_id, status) for everything; we aggregate in memory.
    // Light columns — even 5000 rows is < 200KB.
    supabase
      .from('review_items')
      .select('run_id, status')
      .not('run_id', 'is', null)
      .returns<{ run_id: string; status: keyof RunBreakdown }[]>(),
  ])
  const { data: runs, error } = runsResult

  const breakdownByRun = new Map<string, RunBreakdown>()
  for (const row of itemsForBreakdown.data ?? []) {
    if (!row.run_id) continue
    let b = breakdownByRun.get(row.run_id)
    if (!b) {
      b = { ...EMPTY_BREAKDOWN }
      breakdownByRun.set(row.run_id, b)
    }
    if (row.status in b) b[row.status]++
  }

  return (
    <>
      <Nav active="runs" />
      <main className="mx-auto max-w-7xl px-6 py-8">
        <header className="mb-6">
          <h1 className="text-2xl font-semibold text-neutral-900">Runs</h1>
          <p className="mt-1 text-sm text-neutral-500">
            Trigger a new detection batch, or browse the history below.
          </p>
        </header>

        <div className="mb-8 space-y-3">
          {banksResult.ok ? (
            <RunForm banks={banksResult.banks} />
          ) : (
            <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              Couldn&apos;t reach Medvin to list banks: {banksResult.error}
              <div className="mt-1 text-xs text-amber-800">
                Check that <code>MEDVIN_ADMIN_EMAIL</code> /{' '}
                <code>MEDVIN_ADMIN_PASSWORD</code> are set on the server.
              </div>
            </div>
          )}
        </div>

        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-neutral-500">
          History
        </h2>

        {error ? (
          <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-800">
            Failed to load runs: {error.message}
          </div>
        ) : !runs || runs.length === 0 ? (
          <div className="rounded-md border border-neutral-200 bg-white p-8 text-center text-sm text-neutral-500">
            No runs yet. Trigger one above and the detection cron will pick it
            up within a minute.
          </div>
        ) : (
          <div className="overflow-hidden rounded-lg border border-neutral-200 bg-white">
            <table className="w-full text-sm">
              <thead className="bg-neutral-50 text-left text-xs uppercase tracking-wide text-neutral-500">
                <tr>
                  <th className="px-4 py-3 font-medium">Started</th>
                  <th className="px-4 py-3 font-medium">Bank</th>
                  <th className="px-4 py-3 font-medium">State</th>
                  <th className="px-4 py-3 font-medium">Progress</th>
                  <th className="px-4 py-3 font-medium">Triggered by</th>
                  <th className="px-4 py-3 font-medium text-right">Scanned</th>
                  <th className="px-4 py-3 font-medium text-right">Flagged</th>
                  <th className="px-4 py-3 font-medium text-right">Errors</th>
                  <th className="px-4 py-3 font-medium">Duration</th>
                  <th className="px-4 py-3 font-medium"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {runs.map((run) => {
                  const stateStyle =
                    RUN_STATE_STYLES[run.state] ?? 'bg-neutral-100 text-neutral-700'
                  const stateLabel = RUN_STATE_LABELS[run.state] ?? run.state
                  const page = run.cursor?.page
                  const showDetectionProgress =
                    run.state === 'detecting' && page != null
                  const breakdown = breakdownByRun.get(run.id) ?? EMPTY_BREAKDOWN
                  const rewrittenSoFar =
                    breakdown.pending_review +
                    breakdown.approved_pending_push +
                    breakdown.rejected +
                    breakdown.pushed +
                    breakdown.push_error
                  const rewriteTotal = run.total_flagged
                  const showRewriteProgress =
                    (run.state === 'rewriting' || run.state === 'finished') &&
                    rewriteTotal > 0
                  return (
                    <tr key={run.id} className="hover:bg-neutral-50">
                      <td className="px-4 py-3 text-neutral-700 whitespace-nowrap">
                        {formatDateTime(run.started_at)}
                      </td>
                      <td className="px-4 py-3 text-neutral-700">
                        <div>{run.question_bank_title ?? '—'}</div>
                        <div className="text-xs text-neutral-500">
                          Bank {run.question_bank_id}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${stateStyle}`}
                        >
                          {stateLabel}
                        </span>
                        {run.state === 'error' && run.error_message && (
                          <div className="mt-1 max-w-xs truncate text-xs text-red-700">
                            {run.error_message}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs text-neutral-600">
                        {showDetectionProgress && (
                          <div>
                            page {page}
                            {run.total_pages != null && ` / ${run.total_pages}`}
                          </div>
                        )}
                        {showRewriteProgress && (
                          <div>
                            rewritten {rewrittenSoFar} / {rewriteTotal}
                            {breakdown.pending_rewrite > 0 && (
                              <span className="text-neutral-400">
                                {' '}
                                ({breakdown.pending_rewrite} queued)
                              </span>
                            )}
                          </div>
                        )}
                        {!showDetectionProgress && !showRewriteProgress && '—'}
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-neutral-600">
                        {run.triggered_by ?? '—'}
                      </td>
                      <td className="px-4 py-3 text-right text-neutral-700">
                        {run.total_scanned}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <span className="font-medium text-amber-700">
                          {run.total_flagged}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <span
                          className={
                            run.total_errors > 0
                              ? 'text-red-700'
                              : 'text-neutral-400'
                          }
                        >
                          {run.total_errors}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-neutral-600 whitespace-nowrap">
                        {formatDuration(run.started_at, run.finished_at)}
                      </td>
                      <td className="px-4 py-3">
                        <RunRowActions runId={run.id} state={run.state} />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </>
  )
}
