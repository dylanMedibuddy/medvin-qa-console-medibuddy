import { createClient } from '@/lib/supabase/server'
import { Nav } from '@/components/nav'
import Link from 'next/link'
import { STATUS_LABELS, STATUS_STYLES, type ReviewStatus } from '@/lib/types'

type AuditRow = {
  id: string
  created_at: string
  review_item_id: string
  actor_user_id: string | null
  actor_type: 'user' | 'system'
  action: string
  from_status: string | null
  to_status: string | null
  diff: Record<string, unknown> | null
  actor: { full_name: string | null } | null
  review_item: {
    medvin_question_id: number
    medvin_question_bank_id: number
  } | null
}

const ACTION_STYLES: Record<string, string> = {
  created: 'bg-blue-100 text-blue-800',
  approved: 'bg-emerald-100 text-emerald-800',
  rejected: 'bg-neutral-200 text-neutral-700',
  pushed: 'bg-emerald-100 text-emerald-800',
  push_error: 'bg-red-100 text-red-800',
}

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

function StatusBadge({ status }: { status: string | null }) {
  if (!status) return <span className="text-neutral-400">—</span>
  const style =
    STATUS_STYLES[status as ReviewStatus] ?? 'bg-neutral-100 text-neutral-700'
  const label = STATUS_LABELS[status as ReviewStatus] ?? status
  return (
    <span className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-medium ${style}`}>
      {label}
    </span>
  )
}

function ActorCell({ row }: { row: AuditRow }) {
  if (row.actor_type === 'system') {
    return <span className="font-mono text-xs text-neutral-500">system</span>
  }
  return (
    <span className="text-neutral-700">
      {row.actor?.full_name ?? <span className="font-mono text-xs">{row.actor_user_id?.slice(0, 8)}</span>}
    </span>
  )
}

export default async function AuditPage() {
  const supabase = await createClient()
  const { data: rows, error } = await supabase
    .from('audit_log')
    .select(
      `
      id, created_at, review_item_id, actor_user_id, actor_type, action, from_status, to_status, diff,
      actor:profiles!actor_user_id(full_name),
      review_item:review_items!review_item_id(medvin_question_id, medvin_question_bank_id)
    `
    )
    .order('created_at', { ascending: false })
    .limit(200)
    .returns<AuditRow[]>()

  return (
    <>
      <Nav active="audit" />
      <main className="mx-auto max-w-7xl px-6 py-8">
        <header className="mb-6">
          <h1 className="text-2xl font-semibold text-neutral-900">Audit log</h1>
          <p className="mt-1 text-sm text-neutral-500">
            Append-only record of every review_item state transition. Most recent first (last 200).
          </p>
        </header>

        {error ? (
          <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-800">
            Failed to load audit log: {error.message}
          </div>
        ) : !rows || rows.length === 0 ? (
          <div className="rounded-md border border-neutral-200 bg-white p-8 text-center text-sm text-neutral-500">
            No audit entries yet.
          </div>
        ) : (
          <div className="overflow-hidden rounded-lg border border-neutral-200 bg-white">
            <table className="w-full text-sm">
              <thead className="bg-neutral-50 text-left text-xs uppercase tracking-wide text-neutral-500">
                <tr>
                  <th className="px-4 py-3 font-medium">When</th>
                  <th className="px-4 py-3 font-medium">Who</th>
                  <th className="px-4 py-3 font-medium">Action</th>
                  <th className="px-4 py-3 font-medium">Item</th>
                  <th className="px-4 py-3 font-medium">From → To</th>
                  <th className="px-4 py-3 font-medium">Diff</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {rows.map((row) => (
                  <tr key={row.id} className="hover:bg-neutral-50">
                    <td className="px-4 py-3 text-neutral-600 whitespace-nowrap">
                      {formatDateTime(row.created_at)}
                    </td>
                    <td className="px-4 py-3">
                      <ActorCell row={row} />
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${
                          ACTION_STYLES[row.action] ?? 'bg-neutral-100 text-neutral-700'
                        }`}
                      >
                        {row.action}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {row.review_item ? (
                        <Link
                          href={`/review/${row.review_item_id}`}
                          className="font-mono text-xs text-neutral-700 hover:underline"
                        >
                          #{row.review_item.medvin_question_id}
                          <span className="ml-1 text-neutral-400">
                            (bank {row.review_item.medvin_question_bank_id})
                          </span>
                        </Link>
                      ) : (
                        <span className="font-mono text-xs text-neutral-400">
                          {row.review_item_id.slice(0, 8)}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <StatusBadge status={row.from_status} />
                      <span className="mx-1 text-neutral-400">→</span>
                      <StatusBadge status={row.to_status} />
                    </td>
                    <td className="px-4 py-3 max-w-md">
                      {row.diff ? (
                        <code className="font-mono text-[11px] text-neutral-600">
                          {JSON.stringify(row.diff)}
                        </code>
                      ) : (
                        <span className="text-neutral-400">—</span>
                      )}
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
