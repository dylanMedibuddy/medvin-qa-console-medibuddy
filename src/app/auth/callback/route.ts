import { createClient } from '@/lib/supabase/server'
import { NextResponse, type NextRequest } from 'next/server'

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const next = searchParams.get('next') ?? '/queue'

  if (!code) {
    return NextResponse.redirect(`${origin}/auth/error?reason=missing_code`)
  }

  const supabase = await createClient()
  const { data, error } = await supabase.auth.exchangeCodeForSession(code)

  if (error || !data.user) {
    return NextResponse.redirect(`${origin}/auth/error?reason=exchange_failed`)
  }

  if (!data.user.email?.toLowerCase().endsWith('@medibuddy.co.uk')) {
    await supabase.auth.signOut()
    return NextResponse.redirect(`${origin}/auth/error?reason=domain`)
  }

  return NextResponse.redirect(`${origin}${next}`)
}
