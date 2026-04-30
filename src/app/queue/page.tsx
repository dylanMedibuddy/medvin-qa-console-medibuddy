import { createClient } from '@/lib/supabase/server'
import { Nav } from '@/components/nav'
import { Filters } from './filters'
import { QueueTable } from './queue-table'
import type { ReviewStatus } from '@/lib/types'

const ALL_STATUSES: ReviewStatus[] = [
  'pending_review',
  'approved_pending_push',
  'rejected',
  'pushed',
  'push_error',
]

type SearchParams = { status?: string; bank?: string }

function parseStatuses(raw: string | undefined): ReviewStatus[] {
  if (!raw) return ['pending_review']
  const parts = raw.split(',').filter(Boolean) as ReviewStatus[]
  const valid = parts.filter((s) => (ALL_STATUSES as string[]).includes(s))
  return valid.length ? valid : ['pending_review']
}

export default async function QueuePage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>
}) {
  const params = await searchParams
  const statuses = parseStatuses(params.status)
  const bankId =
    params.bank && !Number.isNaN(Number(params.bank)) ? Number(params.bank) : null

  const supabase = await createClient()

  // Build the main query
  let query = supabase
    .from('review_items')
    .select(
      'id, medvin_question_id, medvin_question_bank_id, question_type, detection_reason, rewrite_confidence, status, detected_at'
    )
  if (statuses.length) query = query.in('status', statuses)
  if (bankId !== null) query = query.eq('medvin_question_bank_id', bankId)
  query = query.order('detected_at', { ascending: false }).limit(100)

  // Counts (always against full status set, not the current filter, so the
  // header summary is meaningful regardless of what's filtered)
  const countQueries = ALL_STATUSES.map((s) => {
    let q = supabase
      .from('review_items')
      .select('*', { count: 'exact', head: true })
      .eq('status', s)
    if (bankId !== null) q = q.eq('medvin_question_bank_id', bankId)
    return q
  })

  // Distinct banks
  const banksQuery = supabase
    .from('review_items')
    .select('medvin_question_bank_id')

  const [{ data: items, error }, banksRes, ...countResults] = await Promise.all([
    query,
    banksQuery,
    ...countQueries,
  ])

  const counts = ALL_STATUSES.reduce<Record<ReviewStatus, number>>((acc, s, i) => {
    acc[s] = countResults[i]?.count ?? 0
    return acc
  }, {} as Record<ReviewStatus, number>)

  const bankCounts = new Map<number, number>()
  for (const row of (banksRes.data ?? []) as { medvin_question_bank_id: number }[]) {
    bankCounts.set(
      row.medvin_question_bank_id,
      (bankCounts.get(row.medvin_question_bank_id) ?? 0) + 1
    )
  }
  const banks = [...bankCounts.entries()]
    .map(([id, count]) => ({ id, count }))
    .sort((a, b) => a.id - b.id)

  return (
    <>
      <Nav active="queue" />
      <main className="mx-auto max-w-7xl px-6 py-8">
        <header className="mb-6">
          <h1 className="text-2xl font-semibold text-neutral-900">Review queue</h1>
          <p className="mt-1 text-sm text-neutral-500">
            <span className="font-medium text-amber-700">
              {counts.pending_review} pending review
            </span>{' '}
            ·{' '}
            <span className="font-medium text-emerald-700">
              {counts.approved_pending_push} approved (ready to push)
            </span>{' '}
            · <span>{counts.rejected} rejected</span>
            {counts.pushed > 0 && <> · {counts.pushed} pushed</>}
            {counts.push_error > 0 && (
              <> · <span className="text-red-700">{counts.push_error} push errors</span></>
            )}
          </p>
        </header>

        <Filters statuses={statuses} bankId={bankId} banks={banks} />

        {error ? (
          <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-800">
            Failed to load queue: {error.message}
          </div>
        ) : (
          <QueueTable items={(items ?? []) as Parameters<typeof QueueTable>[0]['items']} />
        )}
      </main>
    </>
  )
}
