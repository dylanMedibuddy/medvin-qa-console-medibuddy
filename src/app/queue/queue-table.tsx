'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import type { ReviewStatus } from '@/lib/types'
import { STATUS_STYLES, STATUS_LABELS, REJECT_REASONS } from '@/lib/types'
import type { RejectReason } from '@/lib/types'

type Item = {
  id: string
  medvin_question_id: number
  medvin_question_bank_id: number
  question_type: string
  detection_reason: string
  rewrite_confidence: number | null
  status: ReviewStatus
  detected_at: string
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function QueueTable({ items }: { items: Item[] }) {
  const router = useRouter()
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [rejectModalOpen, setRejectModalOpen] = useState(false)
  const [rejectReason, setRejectReason] = useState<RejectReason>('rewrite_wrong')
  const [rejectNotes, setRejectNotes] = useState('')

  const selectableIds = useMemo(
    () => items.filter((i) => i.status === 'pending_review').map((i) => i.id),
    [items]
  )

  function toggle(id: string) {
    const next = new Set(selected)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setSelected(next)
  }
  function toggleAll() {
    if (selected.size === selectableIds.length && selectableIds.length > 0) {
      setSelected(new Set())
    } else {
      setSelected(new Set(selectableIds))
    }
  }

  async function bulkApprove() {
    setError(null)
    startTransition(async () => {
      const res = await fetch('/api/ui/review-items/bulk-action', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          review_item_ids: [...selected],
          action: 'approve',
        }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(`Bulk approve failed: ${json.error ?? res.statusText}`)
        return
      }
      if (json.skipped?.length) {
        console.warn('[queue] bulk approve skipped', json.skipped)
      }
      setSelected(new Set())
      router.refresh()
    })
  }

  async function bulkReject() {
    setError(null)
    if (rejectReason === 'other' && !rejectNotes.trim()) {
      setError('Notes required when reason is "other"')
      return
    }
    startTransition(async () => {
      const res = await fetch('/api/ui/review-items/bulk-action', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          review_item_ids: [...selected],
          action: 'reject',
          reject_reason: rejectReason,
          reviewer_notes: rejectNotes.trim() || null,
        }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(`Bulk reject failed: ${json.error ?? res.statusText}`)
        return
      }
      if (json.skipped?.length) {
        console.warn('[queue] bulk reject skipped', json.skipped)
      }
      setSelected(new Set())
      setRejectModalOpen(false)
      setRejectNotes('')
      router.refresh()
    })
  }

  if (items.length === 0) {
    return (
      <div className="rounded-md border border-neutral-200 bg-white p-8 text-center text-sm text-neutral-500">
        No items match the current filters.
      </div>
    )
  }

  const allChecked =
    selectableIds.length > 0 && selected.size === selectableIds.length

  return (
    <div className="space-y-3">
      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </div>
      )}

      {selected.size > 0 && (
        <div className="flex items-center justify-between rounded-md border border-neutral-300 bg-neutral-50 px-3 py-2">
          <span className="text-sm text-neutral-700">
            {selected.size} selected
          </span>
          <div className="flex gap-2">
            <button
              onClick={bulkApprove}
              disabled={pending}
              className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
            >
              {pending ? 'Approving…' : `Approve ${selected.size}`}
            </button>
            <button
              onClick={() => setRejectModalOpen(true)}
              disabled={pending}
              className="rounded-md border border-red-200 bg-white px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
            >
              Reject {selected.size}
            </button>
            <button
              onClick={() => setSelected(new Set())}
              disabled={pending}
              className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm text-neutral-700 hover:bg-neutral-100 disabled:opacity-50"
            >
              Clear
            </button>
          </div>
        </div>
      )}

      <div className="overflow-hidden rounded-lg border border-neutral-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-neutral-50 text-left text-xs uppercase tracking-wide text-neutral-500">
            <tr>
              <th className="w-10 px-3 py-3">
                <input
                  type="checkbox"
                  checked={allChecked}
                  onChange={toggleAll}
                  disabled={selectableIds.length === 0}
                  aria-label="Select all pending items"
                />
              </th>
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
            {items.map((item) => {
              const selectable = item.status === 'pending_review'
              return (
                <tr key={item.id} className="hover:bg-neutral-50">
                  <td className="px-3 py-3">
                    <input
                      type="checkbox"
                      checked={selected.has(item.id)}
                      onChange={() => toggle(item.id)}
                      disabled={!selectable}
                      aria-label={`Select question ${item.medvin_question_id}`}
                    />
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-neutral-700">
                    <Link href={`/review/${item.id}`} className="hover:underline">
                      #{item.medvin_question_id}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-neutral-600">
                    {item.medvin_question_bank_id}
                  </td>
                  <td className="px-4 py-3 text-neutral-600">{item.question_type}</td>
                  <td className="px-4 py-3 max-w-md truncate text-neutral-700">
                    {item.detection_reason}
                  </td>
                  <td className="px-4 py-3 text-neutral-600">
                    {item.rewrite_confidence != null
                      ? item.rewrite_confidence.toFixed(2)
                      : '—'}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${
                        STATUS_STYLES[item.status] ?? 'bg-neutral-100 text-neutral-700'
                      }`}
                    >
                      {STATUS_LABELS[item.status] ?? item.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-neutral-500">
                    {formatDate(item.detected_at)}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {rejectModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6">
          <div className="w-full max-w-md space-y-4 rounded-xl bg-white p-6 shadow-xl">
            <h2 className="text-lg font-semibold text-neutral-900">
              Reject {selected.size} item{selected.size === 1 ? '' : 's'}
            </h2>
            <div className="space-y-2">
              <label className="block text-sm font-medium text-neutral-700">Reason</label>
              <select
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value as RejectReason)}
                className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
              >
                {REJECT_REASONS.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <label className="block text-sm font-medium text-neutral-700">
                Notes{' '}
                <span className="text-neutral-500">
                  ({rejectReason === 'other' ? 'required' : 'optional'})
                </span>
              </label>
              <textarea
                value={rejectNotes}
                onChange={(e) => setRejectNotes(e.target.value)}
                rows={3}
                className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => {
                  setRejectModalOpen(false)
                  setRejectNotes('')
                  setError(null)
                }}
                disabled={pending}
                className="rounded-md border border-neutral-300 px-4 py-2 text-sm hover:bg-neutral-100"
              >
                Cancel
              </button>
              <button
                onClick={bulkReject}
                disabled={pending}
                className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
              >
                {pending ? 'Rejecting…' : `Confirm reject ${selected.size}`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
