'use client'

import { useState, useTransition } from 'react'
import { approveAndReturn, rejectAndReturn } from './actions'

type Props = { id: string; disabled: boolean }

export function ReviewControls({ id, disabled }: Props) {
  const [pending, startTransition] = useTransition()
  const [showReject, setShowReject] = useState(false)
  const [notes, setNotes] = useState('')
  const [error, setError] = useState<string | null>(null)

  function approve() {
    setError(null)
    startTransition(async () => {
      const result = await approveAndReturn(id)
      if (result && !result.ok) setError(result.error)
    })
  }

  function reject() {
    setError(null)
    startTransition(async () => {
      const result = await rejectAndReturn(id, notes)
      if (result && !result.ok) setError(result.error)
    })
  }

  if (disabled) {
    return (
      <div className="text-sm text-neutral-500">
        This item has already been reviewed.
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
      {showReject ? (
        <div className="space-y-2">
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Why are you rejecting this rewrite? (optional but encouraged)"
            rows={3}
            className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
          />
          <div className="flex gap-2">
            <button
              onClick={reject}
              disabled={pending}
              className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
            >
              {pending ? 'Rejecting…' : 'Confirm reject'}
            </button>
            <button
              onClick={() => {
                setShowReject(false)
                setNotes('')
              }}
              disabled={pending}
              className="rounded-md border border-neutral-300 px-4 py-2 text-sm hover:bg-neutral-100"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="flex gap-2">
          <button
            onClick={approve}
            disabled={pending}
            className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            {pending ? 'Approving…' : 'Approve'}
          </button>
          <button
            onClick={() => setShowReject(true)}
            disabled={pending}
            className="rounded-md border border-red-200 bg-white px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
          >
            Reject
          </button>
        </div>
      )}
    </div>
  )
}
