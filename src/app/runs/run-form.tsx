'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import type { MedvinBank } from '@/lib/medvin'

type LastResult =
  | { ok: true; bank: { id: number; title: string }; triggered_at: string }
  | { ok: false; error: string }

export function RunForm({ banks }: { banks: MedvinBank[] }) {
  const router = useRouter()
  const [bankId, setBankId] = useState<number | ''>(banks[0]?.id ?? '')
  const [pending, startTransition] = useTransition()
  const [result, setResult] = useState<LastResult | null>(null)

  function trigger() {
    if (typeof bankId !== 'number') return
    const bank = banks.find((b) => b.id === bankId)
    if (!bank) return
    setResult(null)
    startTransition(async () => {
      const res = await fetch('/api/ui/runs', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          question_bank_id: bank.id,
          question_bank_title: bank.title,
          enrollment_slug: bank.enrollment_slug,
        }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setResult({
          ok: false,
          error: json.detail
            ? `${json.error}: ${json.detail}`
            : (json.error ?? `HTTP ${res.status}`),
        })
        return
      }
      setResult({
        ok: true,
        bank: json.bank,
        triggered_at: json.triggered_at,
      })
      // Refresh the page so the new run appears in the table once Make creates it
      setTimeout(() => router.refresh(), 1500)
    })
  }

  if (banks.length === 0) {
    return (
      <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
        Medvin returned zero banks. Check the admin account&apos;s permissions.
      </div>
    )
  }

  return (
    <div className="space-y-3 rounded-lg border border-neutral-200 bg-white p-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <label className="text-xs uppercase tracking-wide text-neutral-500">
            Question bank
          </label>
          <select
            value={bankId}
            onChange={(e) => setBankId(Number(e.target.value))}
            disabled={pending}
            className="rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm"
          >
            {banks.map((b) => (
              <option key={b.id} value={b.id}>
                {b.title} (#{b.id})
              </option>
            ))}
          </select>
        </div>
        <button
          onClick={trigger}
          disabled={pending || typeof bankId !== 'number'}
          className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50"
        >
          {pending ? 'Triggering…' : 'Run now'}
        </button>
        <p className="text-xs text-neutral-500">
          Calls Make Scenario A. Detection runs there; flagged items will appear in the
          queue when Make POSTs them back.
        </p>
      </div>

      {result?.ok && (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
          Triggered <span className="font-medium">{result.bank.title}</span> (#
          {result.bank.id}). Make is now scanning. New items should start appearing
          in <a href="/queue" className="underline">/queue</a> shortly.
        </div>
      )}
      {result && !result.ok && (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          Failed: {result.error}
        </div>
      )}
    </div>
  )
}
