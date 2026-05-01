import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { signOut } from '@/app/actions/sign-out'

type ActiveKey = 'queue' | 'approved' | 'runs' | 'audit' | 'console'

async function getCounts() {
  const sb = await createClient()
  const [pendingResult, approvedResult] = await Promise.all([
    sb
      .from('review_items')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'pending_review'),
    sb
      .from('review_items')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'approved_pending_push'),
  ])
  return {
    pending: pendingResult.count ?? 0,
    approved: approvedResult.count ?? 0,
  }
}

export async function Nav({ active }: { active: ActiveKey }) {
  const sb = await createClient()
  const [
    {
      data: { user },
    },
    counts,
  ] = await Promise.all([sb.auth.getUser(), getCounts()])

  const links: Array<{ key: ActiveKey; label: string; href: string; badge?: number }> = [
    { key: 'queue', label: 'Queue', href: '/queue', badge: counts.pending || undefined },
    {
      key: 'approved',
      label: 'Approved',
      href: '/approved-pending-push',
      badge: counts.approved || undefined,
    },
    { key: 'runs', label: 'Runs', href: '/runs' },
    { key: 'audit', label: 'Audit', href: '/audit' },
    { key: 'console', label: 'Console', href: '/admin/console' },
  ]

  return (
    <nav className="border-b border-neutral-200 bg-white">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-3">
        <div className="flex items-center gap-6">
          <Link href="/queue" className="text-sm font-semibold text-neutral-900">
            Medvin QA
          </Link>
          <div className="flex items-center gap-1">
            {links.map((link) => {
              const isActive = active === link.key
              return (
                <Link
                  key={link.key}
                  href={link.href}
                  className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm transition-colors ${
                    isActive
                      ? 'bg-neutral-900 text-white'
                      : 'text-neutral-700 hover:bg-neutral-100'
                  }`}
                >
                  {link.label}
                  {link.badge != null && (
                    <span
                      className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                        isActive
                          ? 'bg-white/20 text-white'
                          : 'bg-neutral-200 text-neutral-700'
                      }`}
                    >
                      {link.badge}
                    </span>
                  )}
                </Link>
              )
            })}
          </div>
        </div>
        <div className="flex items-center gap-3 text-sm text-neutral-600">
          <span>{user?.email}</span>
          <form action={signOut}>
            <button className="rounded-md border border-neutral-300 px-3 py-1 text-sm hover:bg-neutral-100">
              Sign out
            </button>
          </form>
        </div>
      </div>
    </nav>
  )
}
