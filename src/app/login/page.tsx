'use client'

import { createClient } from '@/lib/supabase/browser'
import { useState } from 'react'

export default function LoginPage() {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function signIn() {
    setLoading(true)
    setError(null)
    const supabase = createClient()
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
        queryParams: {
          apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
          hd: 'medibuddy.co.uk',
          prompt: 'select_account',
        },
      },
    })
    if (error) {
      setError(error.message)
      setLoading(false)
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-neutral-50 px-6">
      <div className="w-full max-w-sm space-y-6 rounded-xl border border-neutral-200 bg-white p-8 shadow-sm">
        <div className="space-y-1">
          <h1 className="text-xl font-semibold text-neutral-900">Medvin QA Console</h1>
          <p className="text-sm text-neutral-500">Medibuddy content review</p>
        </div>
        <button
          onClick={signIn}
          disabled={loading}
          className="w-full rounded-md bg-neutral-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50"
        >
          {loading ? 'Redirecting…' : 'Sign in with Google'}
        </button>
        <p className="text-xs text-neutral-500">
          Restricted to <span className="font-mono">@medibuddy.co.uk</span> accounts.
        </p>
        {error && <p className="text-xs text-red-600">{error}</p>}
      </div>
    </main>
  )
}
