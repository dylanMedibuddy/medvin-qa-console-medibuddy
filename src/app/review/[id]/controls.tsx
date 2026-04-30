'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { REJECT_REASONS, type RejectReason } from '@/lib/types'

type Props = { id: string; disabled: boolean; lockedReason?: string }

export function ReviewControls({ id, disabled, lockedReason }: Props) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [rejectModalOpen, setRejectModalOpen] = useState(false)
  const [rejectReason, setRejectReason] = useState<RejectReason>('rewrite_wrong')
  const [rejectNotes, setRejectNotes] = useState('')

  function approve() {
    setError(null)
    startTransition(async () => {
      const res = await fetch(`/api/ui/review-items/${id}/approve`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(formatError(json))
        return
      }
      router.push('/queue')
      router.refresh()
    })
  }

  function reject() {
    setError(null)
    if (rejectReason === 'other' && !rejectNotes.trim()) {
      setError('Notes required when reason is "other"')
      return
    }
    startTransition(async () => {
      const res = await fetch(`/api/ui/review-items/${id}/reject`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          reject_reason: rejectReason,
          reviewer_notes: rejectNotes.trim() || null,
        }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(formatError(json))
        return
      }
      router.push('/queue')
      router.refresh()
    })
  }

  if (disabled) {
    return (
      <div className="text-sm text-neutral-500">
        {lockedReason ?? 'This item has already been reviewed.'}
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
      <div className="flex gap-2">
        <button
          onClick={approve}
          disabled={pending}
          className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
        >
          {pending ? 'Approving…' : 'Approve'}
        </button>
        <button
          onClick={() => setRejectModalOpen(true)}
          disabled={pending}
          className="rounded-md border border-red-200 bg-white px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
        >
          Reject
        </button>
      </div>

      {rejectModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6">
          <div className="w-full max-w-md space-y-4 rounded-xl bg-white p-6 shadow-xl">
            <h2 className="text-lg font-semibold text-neutral-900">Reject this item</h2>
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
                onClick={reject}
                disabled={pending}
                className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
              >
                {pending ? 'Rejecting…' : 'Confirm reject'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function formatError(json: { error?: string; details?: string[]; detail?: string }): string {
  if (Array.isArray(json.details)) return `Validation failed: ${json.details.join('; ')}`
  if (json.detail) return `${json.error ?? 'Error'}: ${json.detail}`
  return json.error ?? 'Action failed'
}
