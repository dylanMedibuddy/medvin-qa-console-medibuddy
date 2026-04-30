import { createClient } from '@/lib/supabase/server'
import { Nav } from '@/components/nav'
import { BANKS } from '@/lib/banks'
import { RunForm } from './run-form'

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

export default async function RunsPage() {
  const supabase = await createClient()
  const { data: runs, error } = await supabase
    .from('runs')
    .select(
      'id, started_at, finished_at, question_bank_id, question_bank_title, total_scanned, total_flagged, total_errors, triggered_by, notes'
    )
    .order('started_at', { ascending: false })
    .limit(100)
    .returns<Run[]>()

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

        <div className="mb-8">
          <RunForm banks={BANKS} />
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
            No runs yet. They&apos;ll appear here once Make.com starts triggering them.
          </div>
        ) : (
          <div className="overflow-hidden rounded-lg border border-neutral-200 bg-white">
            <table className="w-full text-sm">
              <thead className="bg-neutral-50 text-left text-xs uppercase tracking-wide text-neutral-500">
                <tr>
                  <th className="px-4 py-3 font-medium">Started</th>
                  <th className="px-4 py-3 font-medium">Bank</th>
                  <th className="px-4 py-3 font-medium">Triggered by</th>
                  <th className="px-4 py-3 font-medium text-right">Scanned</th>
                  <th className="px-4 py-3 font-medium text-right">Flagged</th>
                  <th className="px-4 py-3 font-medium text-right">Errors</th>
                  <th className="px-4 py-3 font-medium">Duration</th>
                  <th className="px-4 py-3 font-medium">Notes</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {runs.map((run) => (
                  <tr key={run.id} className="hover:bg-neutral-50">
                    <td className="px-4 py-3 text-neutral-700">
                      {formatDateTime(run.started_at)}
                    </td>
                    <td className="px-4 py-3 text-neutral-700">
                      <div>{run.question_bank_title ?? '—'}</div>
                      <div className="text-xs text-neutral-500">
                        Bank {run.question_bank_id}
                      </div>
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
                          run.total_errors > 0 ? 'text-red-700' : 'text-neutral-400'
                        }
                      >
                        {run.total_errors}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-neutral-600">
                      {formatDuration(run.started_at, run.finished_at)}
                    </td>
                    <td className="px-4 py-3 max-w-xs truncate text-neutral-600">
                      {run.notes ?? '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </>
  )
}
