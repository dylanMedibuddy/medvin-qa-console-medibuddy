'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import type { RunState } from '@/lib/types'

export function RunRowActions({
  runId,
  state,
}: {
  runId: string
  state: RunState
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  if (state !== 'detecting' && state !== 'rewriting') return null

  function cancel() {
    if (
      !window.confirm(
        'Cancel this run? Already-detected items keep flowing through rewrite + review; only further detection pages stop.'
      )
    ) {
      return
    }
    setError(null)
    startTransition(async () => {
      const res = await fetch(`/api/ui/runs/${runId}/cancel`, { method: 'POST' })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(json.detail ?? json.error ?? `HTTP ${res.status}`)
        return
      }
      router.refresh()
    })
  }

  return (
    <div className="space-y-1">
      <button
        onClick={cancel}
        disabled={pending}
        className="rounded border border-neutral-300 px-2 py-0.5 text-xs text-neutral-700 hover:bg-neutral-100 disabled:opacity-50"
      >
        {pending ? 'Cancelling…' : 'Cancel'}
      </button>
      {error && <div className="text-xs text-red-700">{error}</div>}
    </div>
  )
}
