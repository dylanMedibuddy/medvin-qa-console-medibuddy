import { createClient } from '@/lib/supabase/server'
import type { ReviewItemRow } from '@/lib/types'
import Link from 'next/link'
import { signOut } from '@/app/actions/sign-out'

const STATUS_STYLES: Record<string, string> = {
  pending_review: 'bg-amber-100 text-amber-800',
  approved: 'bg-emerald-100 text-emerald-800',
  rejected: 'bg-neutral-200 text-neutral-700',
  patching: 'bg-blue-100 text-blue-800',
  patched: 'bg-emerald-100 text-emerald-800',
  patch_error: 'bg-red-100 text-red-800',
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export default async function QueuePage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const { data: items, error } = await supabase
    .from('review_items')
    .select(
      'id, medvin_question_id, medvin_question_bank_id, question_type, detection_reason, rewrite_confidence, status, detected_at'
    )
    .eq('status', 'pending_review')
    .order('detected_at', { ascending: false })
    .limit(100)
    .returns<Pick<ReviewItemRow, 'id' | 'medvin_question_id' | 'medvin_question_bank_id' | 'question_type' | 'detection_reason' | 'rewrite_confidence' | 'status' | 'detected_at'>[]>()

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <header className="mb-8 flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-neutral-900">Review queue</h1>
          <p className="text-sm text-neutral-500">
            Pending items, newest first. Click a row to review.
          </p>
        </div>
        <div className="flex items-center gap-4 text-sm text-neutral-600">
          <span>{user?.email}</span>
          <form action={signOut}>
            <button className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-100">
              Sign out
            </button>
          </form>
        </div>
      </header>

      {error ? (
        <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          Failed to load queue: {error.message}
        </div>
      ) : !items || items.length === 0 ? (
        <div className="rounded-md border border-neutral-200 bg-white p-8 text-center text-sm text-neutral-500">
          No pending items. New flagged questions will appear here as Make pushes them in.
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-neutral-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-neutral-50 text-left text-xs uppercase tracking-wide text-neutral-500">
              <tr>
                <th className="px-4 py-3 font-medium">Question</th>
                <th className="px-4 py-3 font-medium">Bank</th>
                <th className="px-4 py-3 font-medium">Type</th>
                <th className="px-4 py-3 font-medium">Detection reason</th>
                <th className="px-4 py-3 font-medium">Conf.</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Detected</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {items.map((item) => (
                <tr key={item.id} className="hover:bg-neutral-50">
                  <td className="px-4 py-3 font-mono text-xs text-neutral-700">
                    <Link href={`/review/${item.id}`} className="hover:underline">
                      #{item.medvin_question_id}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-neutral-600">{item.medvin_question_bank_id}</td>
                  <td className="px-4 py-3 text-neutral-600">{item.question_type}</td>
                  <td className="px-4 py-3 max-w-md truncate text-neutral-700">
                    {item.detection_reason}
                  </td>
                  <td className="px-4 py-3 text-neutral-600">
                    {item.rewrite_confidence != null ? item.rewrite_confidence.toFixed(2) : '—'}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${
                        STATUS_STYLES[item.status] ?? 'bg-neutral-100 text-neutral-700'
                      }`}
                    >
                      {item.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-neutral-500">{formatDate(item.detected_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  )
}
