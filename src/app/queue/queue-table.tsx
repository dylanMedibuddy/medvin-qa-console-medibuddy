'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import type { ReviewStatus, RejectReason } from '@/lib/types'
import { STATUS_STYLES, STATUS_LABELS, REJECT_REASONS } from '@/lib/types'

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

type Props = {
  items: Item[]
  /** Map of medvin bank id → friendly title (from Medvin live fetch). */
  bankTitleById: Record<number, string>
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

type BankGroup = {
  bankId: number
  title: string
  items: Item[]
}

function groupByBank(items: Item[], titles: Record<number, string>): BankGroup[] {
  const map = new Map<number, BankGroup>()
  for (const item of items) {
    const bankId = item.medvin_question_bank_id
    let group = map.get(bankId)
    if (!group) {
      group = {
        bankId,
        title: titles[bankId] ?? `Bank #${bankId}`,
        items: [],
      }
      map.set(bankId, group)
    }
    group.items.push(item)
  }
  return [...map.values()].sort((a, b) => a.title.localeCompare(b.title))
}

export function QueueTable({ items, bankTitleById }: Props) {
  const router = useRouter()
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set())
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [rejectModalOpen, setRejectModalOpen] = useState(false)
  const [deleteModalOpen, setDeleteModalOpen] = useState(false)
  const [rejectReason, setRejectReason] = useState<RejectReason>('rewrite_wrong')
  const [rejectNotes, setRejectNotes] = useState('')

  const groups = useMemo(
    () => groupByBank(items, bankTitleById),
    [items, bankTitleById]
  )

  function toggle(id: string) {
    const next = new Set(selected)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setSelected(next)
  }

  function toggleBankCollapse(bankId: number) {
    const next = new Set(collapsed)
    if (next.has(bankId)) next.delete(bankId)
    else next.add(bankId)
    setCollapsed(next)
  }

  function toggleSelectAllInBank(group: BankGroup) {
    const allBankIds = group.items.map((i) => i.id)
    const allSelected = allBankIds.every((id) => selected.has(id))
    const next = new Set(selected)
    if (allSelected) {
      for (const id of allBankIds) next.delete(id)
    } else {
      for (const id of allBankIds) next.add(id)
    }
    setSelected(next)
  }

  function expandAll() {
    setCollapsed(new Set())
  }
  function collapseAll() {
    setCollapsed(new Set(groups.map((g) => g.bankId)))
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

  async function bulkDelete() {
    setError(null)
    startTransition(async () => {
      const res = await fetch('/api/ui/review-items/bulk-action', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          review_item_ids: [...selected],
          action: 'delete',
        }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(`Bulk delete failed: ${json.error ?? res.statusText}`)
        return
      }
      if (json.skipped?.length) {
        console.warn('[queue] bulk delete skipped', json.skipped)
      }
      setSelected(new Set())
      setDeleteModalOpen(false)
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

  return (
    <div className="space-y-3">
      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </div>
      )}

      <div className="flex items-center justify-between text-xs text-neutral-500">
        <span>
          {groups.length} bank{groups.length === 1 ? '' : 's'} · {items.length} item
          {items.length === 1 ? '' : 's'}
        </span>
        <div className="flex gap-2">
          <button
            onClick={expandAll}
            className="rounded px-2 py-0.5 hover:bg-neutral-100"
          >
            Expand all
          </button>
          <button
            onClick={collapseAll}
            className="rounded px-2 py-0.5 hover:bg-neutral-100"
          >
            Collapse all
          </button>
        </div>
      </div>

      {selected.size > 0 && (
        <div className="sticky top-0 z-10 flex items-center justify-between rounded-md border border-neutral-300 bg-neutral-50 px-3 py-2 shadow-sm">
          <span className="text-sm text-neutral-700">{selected.size} selected</span>
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
              onClick={() => setDeleteModalOpen(true)}
              disabled={pending}
              className="rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm font-medium text-neutral-700 hover:bg-neutral-100 disabled:opacity-50"
            >
              Delete {selected.size}
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

      <div className="space-y-3">
        {groups.map((group) => {
          const isCollapsed = collapsed.has(group.bankId)
          const allSelected =
            group.items.length > 0 &&
            group.items.every((i) => selected.has(i.id))
          const someSelected = group.items.some((i) => selected.has(i.id))

          return (
            <section
              key={group.bankId}
              className="overflow-hidden rounded-lg border border-neutral-200 bg-white"
            >
              <header className="flex items-center justify-between border-b border-neutral-200 bg-neutral-50 px-4 py-3">
                <div className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    ref={(el) => {
                      if (el) el.indeterminate = !allSelected && someSelected
                    }}
                    onChange={() => toggleSelectAllInBank(group)}
                    aria-label={`Select all items in ${group.title}`}
                  />
                  <button
                    onClick={() => toggleBankCollapse(group.bankId)}
                    className="flex items-center gap-2 text-left text-sm font-semibold text-neutral-900 hover:text-neutral-600"
                  >
                    <span className="inline-block w-3 text-neutral-400">
                      {isCollapsed ? '▸' : '▾'}
                    </span>
                    <span>{group.title}</span>
                    <span className="text-xs font-normal text-neutral-500">
                      bank #{group.bankId}
                    </span>
                  </button>
                </div>
                <span className="rounded-full bg-neutral-200 px-2 py-0.5 text-xs font-medium text-neutral-700">
                  {group.items.length} flagged
                </span>
              </header>

              {!isCollapsed && (
                <table className="w-full text-sm">
                  <thead className="text-left text-xs uppercase tracking-wide text-neutral-500">
                    <tr className="border-b border-neutral-100">
                      <th className="w-10 px-3 py-2"></th>
                      <th className="px-4 py-2 font-medium">Question</th>
                      <th className="px-4 py-2 font-medium">Type</th>
                      <th className="px-4 py-2 font-medium">Detection reason</th>
                      <th className="px-4 py-2 font-medium">Conf.</th>
                      <th className="px-4 py-2 font-medium">Status</th>
                      <th className="px-4 py-2 font-medium">Detected</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-100">
                    {group.items.map((item) => (
                      <tr key={item.id} className="hover:bg-neutral-50">
                        <td className="px-3 py-2">
                          <input
                            type="checkbox"
                            checked={selected.has(item.id)}
                            onChange={() => toggle(item.id)}
                            aria-label={`Select question ${item.medvin_question_id}`}
                          />
                        </td>
                        <td className="px-4 py-2 font-mono text-xs text-neutral-700">
                          <Link
                            href={`/review/${item.id}`}
                            className="hover:underline"
                          >
                            #{item.medvin_question_id}
                          </Link>
                        </td>
                        <td className="px-4 py-2 text-neutral-600">
                          {item.question_type}
                        </td>
                        <td className="px-4 py-2 max-w-md truncate text-neutral-700">
                          {item.detection_reason}
                        </td>
                        <td className="px-4 py-2 text-neutral-600">
                          {item.rewrite_confidence != null
                            ? item.rewrite_confidence.toFixed(2)
                            : '—'}
                        </td>
                        <td className="px-4 py-2">
                          <span
                            className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${
                              STATUS_STYLES[item.status] ??
                              'bg-neutral-100 text-neutral-700'
                            }`}
                          >
                            {STATUS_LABELS[item.status] ?? item.status}
                          </span>
                        </td>
                        <td className="px-4 py-2 text-neutral-500">
                          {formatDate(item.detected_at)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>
          )
        })}
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

      {deleteModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6">
          <div className="w-full max-w-md space-y-4 rounded-xl bg-white p-6 shadow-xl">
            <h2 className="text-lg font-semibold text-neutral-900">
              Permanently delete {selected.size} item{selected.size === 1 ? '' : 's'}?
            </h2>
            <p className="text-sm text-neutral-600">
              This removes the items from the queue completely. Their audit-log
              history goes with them. This cannot be undone.
            </p>
            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => {
                  setDeleteModalOpen(false)
                  setError(null)
                }}
                disabled={pending}
                className="rounded-md border border-neutral-300 px-4 py-2 text-sm hover:bg-neutral-100"
              >
                Cancel
              </button>
              <button
                onClick={bulkDelete}
                disabled={pending}
                className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
              >
                {pending ? 'Deleting…' : `Delete ${selected.size} permanently`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
