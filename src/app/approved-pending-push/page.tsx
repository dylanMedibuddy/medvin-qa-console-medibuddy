import { createClient } from '@/lib/supabase/server'
import { Nav } from '@/components/nav'
import Link from 'next/link'

function formatDate(iso: string) {
  return new Date(iso).toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export default async function ApprovedPendingPushPage() {
  const supabase = await createClient()
  const { data: items, error } = await supabase
    .from('review_items')
    .select(
      'id, medvin_question_id, medvin_question_bank_id, question_type, detection_reason, rewrite_confidence, reviewed_at, reviewed_by'
    )
    .eq('status', 'approved_pending_push')
    .order('reviewed_at', { ascending: false })
    .limit(200)

  return (
    <>
      <Nav active="approved" />
      <main className="mx-auto max-w-7xl px-6 py-8">
        <header className="mb-6">
          <h1 className="text-2xl font-semibold text-neutral-900">
            Approved · ready to push
          </h1>
          <p className="mt-1 text-sm text-neutral-500">
            Reviewer-approved rewrites waiting to be pushed back to Medvin.
          </p>
        </header>

        <div className="mb-6 rounded-md border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900">
          Push functionality coming soon. For now this page is read-only — items
          will sit here until the Push scenario is built.
        </div>

        {error ? (
          <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-800">
            Failed to load: {error.message}
          </div>
        ) : !items || items.length === 0 ? (
          <div className="rounded-md border border-neutral-200 bg-white p-8 text-center text-sm text-neutral-500">
            No approved items waiting. Approve something on the queue and it will
            appear here.
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
                  <th className="px-4 py-3 font-medium">Approved</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {items.map((item) => (
                  <tr key={item.id} className="hover:bg-neutral-50">
                    <td className="px-4 py-3 font-mono text-xs text-neutral-700">
                      <Link
                        href={`/review/${item.id}`}
                        className="hover:underline"
                      >
                        #{item.medvin_question_id}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-neutral-600">
                      {item.medvin_question_bank_id}
                    </td>
                    <td className="px-4 py-3 text-neutral-600">
                      {item.question_type}
                    </td>
                    <td className="px-4 py-3 max-w-md truncate text-neutral-700">
                      {item.detection_reason}
                    </td>
                    <td className="px-4 py-3 text-neutral-600">
                      {item.rewrite_confidence != null
                        ? Number(item.rewrite_confidence).toFixed(2)
                        : '—'}
                    </td>
                    <td className="px-4 py-3 text-neutral-500">
                      {item.reviewed_at ? formatDate(item.reviewed_at) : '—'}
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
