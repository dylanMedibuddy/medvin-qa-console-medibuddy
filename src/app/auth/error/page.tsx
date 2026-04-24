type PageProps = { searchParams: Promise<{ reason?: string }> }

const REASONS: Record<string, string> = {
  domain: 'That account is not a Medibuddy account. Sign in with your @medibuddy.co.uk email.',
  missing_code: 'Authentication code missing. Try again.',
  exchange_failed: 'Sign-in failed. Try again.',
}

export default async function AuthErrorPage({ searchParams }: PageProps) {
  const { reason } = await searchParams
  const message = (reason && REASONS[reason]) ?? 'Sign-in failed.'

  return (
    <main className="flex min-h-screen items-center justify-center bg-neutral-50 px-6">
      <div className="w-full max-w-sm space-y-4 rounded-xl border border-neutral-200 bg-white p-8 shadow-sm">
        <h1 className="text-lg font-semibold text-neutral-900">Sign-in blocked</h1>
        <p className="text-sm text-neutral-600">{message}</p>
        <a
          href="/login"
          className="inline-block rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800"
        >
          Back to sign in
        </a>
      </div>
    </main>
  )
}
