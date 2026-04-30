'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { useTransition } from 'react'
import type { ReviewStatus } from '@/lib/types'
import { STATUS_LABELS } from '@/lib/types'

const ALL_STATUSES: ReviewStatus[] = [
  'pending_review',
  'approved_pending_push',
  'rejected',
  'pushed',
  'push_error',
]

type Props = {
  statuses: ReviewStatus[]
  bankId: number | null
  banks: { id: number; count: number }[]
}

export function Filters({ statuses, bankId, banks }: Props) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [pending, startTransition] = useTransition()

  function update(next: Partial<{ status: ReviewStatus[]; bank: number | null }>) {
    const params = new URLSearchParams(searchParams.toString())
    if (next.status !== undefined) {
      if (next.status.length === 0) params.delete('status')
      else params.set('status', next.status.join(','))
    }
    if (next.bank !== undefined) {
      if (next.bank === null) params.delete('bank')
      else params.set('bank', String(next.bank))
    }
    startTransition(() => {
      router.replace(`/queue?${params.toString()}`)
    })
  }

  function toggleStatus(s: ReviewStatus) {
    const next = statuses.includes(s)
      ? statuses.filter((x) => x !== s)
      : [...statuses, s]
    update({ status: next })
  }

  return (
    <div className="mb-4 flex flex-wrap items-center gap-3">
      <span className="text-xs uppercase tracking-wide text-neutral-500">Status</span>
      <div className="flex flex-wrap gap-1">
        {ALL_STATUSES.map((s) => {
          const on = statuses.includes(s)
          return (
            <button
              key={s}
              onClick={() => toggleStatus(s)}
              disabled={pending}
              className={`rounded-md border px-2.5 py-1 text-xs ${
                on
                  ? 'border-neutral-900 bg-neutral-900 text-white'
                  : 'border-neutral-300 bg-white text-neutral-700 hover:bg-neutral-100'
              }`}
            >
              {STATUS_LABELS[s]}
            </button>
          )
        })}
      </div>

      <span className="ml-4 text-xs uppercase tracking-wide text-neutral-500">Bank</span>
      <select
        value={bankId ?? ''}
        onChange={(e) => update({ bank: e.target.value === '' ? null : Number(e.target.value) })}
        disabled={pending}
        className="rounded-md border border-neutral-300 bg-white px-2.5 py-1 text-xs"
      >
        <option value="">All banks</option>
        {banks.map((b) => (
          <option key={b.id} value={b.id}>
            Bank {b.id} ({b.count})
          </option>
        ))}
      </select>
    </div>
  )
}
