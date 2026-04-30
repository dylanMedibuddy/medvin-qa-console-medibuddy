/**
 * Read-only Medvin admin client.
 *
 * This app NEVER mutates Medvin. The only Medvin write path is via Make
 * Scenario B (separate process), which holds its own credentials. The helpers
 * here only read — currently just listing question banks for the "Run now"
 * dropdown.
 *
 * Auth: Laravel Sanctum bearer token from POST /api/admin/login. Cached in
 * memory; refreshed automatically on a 401.
 */

const DEFAULT_BASE_URL = 'https://hub.medibuddy.co.uk'

export type MedvinBank = { id: number; title: string; enrollment_slug: string }

/**
 * Derive an enrollment slug from a bank title. Mirrors Laravel's Str::slug()
 * (which Medvin uses): lowercase, replace non-alphanumeric chars with hyphens,
 * collapse multiple hyphens, trim leading/trailing.
 *
 * Confirmed against hub.medibuddy.co.uk/api/admin/enrollments/{slug}/questions
 * for: dundee-pre-clinical-year-1, aston-pre-clinical-year-1,
 * cambridge-pre-clinical-year-1, ucl-pre-clinical-year-1,
 * brighton-and-sussex-pre-clinical-year-1, etc.
 */
export function bankTitleToEnrollmentSlug(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

let cachedToken: string | null = null
let inflightLogin: Promise<string> | null = null

function baseUrl(): string {
  return process.env.MEDVIN_BASE_URL || DEFAULT_BASE_URL
}

async function login(): Promise<string> {
  const email = process.env.MEDVIN_ADMIN_EMAIL
  const password = process.env.MEDVIN_ADMIN_PASSWORD
  if (!email || !password) {
    throw new Error('MEDVIN_ADMIN_EMAIL and MEDVIN_ADMIN_PASSWORD must be set')
  }

  const res = await fetch(`${baseUrl()}/api/admin/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Medvin login failed: ${res.status} ${text.slice(0, 200)}`)
  }
  const json = (await res.json().catch(() => ({}))) as { token?: string }
  if (!json.token) throw new Error('Medvin login did not return a token')
  return json.token
}

async function getToken(): Promise<string> {
  if (cachedToken) return cachedToken
  if (inflightLogin) return inflightLogin
  inflightLogin = login()
    .then((t) => {
      cachedToken = t
      inflightLogin = null
      return t
    })
    .catch((e) => {
      inflightLogin = null
      throw e
    })
  return inflightLogin
}

async function medvinFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const token = await getToken()
  const headers = new Headers(init.headers)
  headers.set('Authorization', `Bearer ${token}`)
  headers.set('Accept', 'application/json')

  let res = await fetch(`${baseUrl()}${path}`, { ...init, headers })
  if (res.status === 401) {
    cachedToken = null
    const newToken = await getToken()
    headers.set('Authorization', `Bearer ${newToken}`)
    res = await fetch(`${baseUrl()}${path}`, { ...init, headers })
  }
  return res
}

/**
 * GET /api/admin/question-banks. Tolerant to two response shapes:
 *   - Laravel-style { data: [...] }
 *   - Bare array
 *
 * Banks lacking a numeric id or title are skipped. Sort by title for
 * predictable dropdown order.
 */
export async function listQuestionBanks(): Promise<MedvinBank[]> {
  const res = await medvinFetch('/api/admin/question-banks')
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`question-banks fetch failed: ${res.status} ${text.slice(0, 200)}`)
  }
  const json = await res.json().catch(() => null)
  const raw: unknown[] = Array.isArray(json)
    ? json
    : Array.isArray((json as { data?: unknown[] })?.data)
      ? ((json as { data: unknown[] }).data)
      : []

  return raw
    .map((b) => {
      if (!b || typeof b !== 'object') return null
      const o = b as Record<string, unknown>
      const id = typeof o.id === 'number' ? o.id : Number(o.id)
      const title =
        (typeof o.title === 'string' && o.title) ||
        (typeof o.name === 'string' && o.name) ||
        ''
      if (!Number.isFinite(id)) return null
      const finalTitle = title || `Bank ${id}`
      return {
        id,
        title: finalTitle,
        enrollment_slug: bankTitleToEnrollmentSlug(finalTitle),
      } as MedvinBank
    })
    .filter((b): b is MedvinBank => b !== null)
    .sort((a, b) => a.title.localeCompare(b.title))
}
