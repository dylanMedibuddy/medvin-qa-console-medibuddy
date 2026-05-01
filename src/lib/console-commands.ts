/**
 * In-app debug console — parser + read-only command executor.
 *
 * Input is a single line of text. First token is the command name; remaining
 * tokens are either positional or `key=value` pairs. No quoted strings — all
 * values are bare words.
 *
 * All commands are READ-ONLY against the DB. No mutations. If you add a
 * mutating command later, add an explicit confirmation flow on the UI side.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

export type CommandOutput =
  | { type: 'text'; text: string }
  | { type: 'error'; text: string }
  | {
      type: 'table'
      columns: string[]
      rows: Array<Record<string, unknown>>
      footer?: string
    }
  | { type: 'json'; data: unknown }

export type ParsedCommand = {
  name: string
  positional: string[]
  args: Record<string, string>
}

export function parseCommand(input: string): ParsedCommand | null {
  const trimmed = input.trim()
  if (!trimmed) return null
  const tokens = trimmed.split(/\s+/)
  const name = (tokens.shift() ?? '').toLowerCase()
  const positional: string[] = []
  const args: Record<string, string> = {}
  for (const t of tokens) {
    const eq = t.indexOf('=')
    if (eq > 0) {
      args[t.slice(0, eq).toLowerCase()] = t.slice(eq + 1)
    } else {
      positional.push(t)
    }
  }
  return { name, positional, args }
}

/* -------------------------------------------------------------------------- */
/*  Command implementations                                                    */
/* -------------------------------------------------------------------------- */

const HELP_TEXT = `Available commands:

  help                                      this list
  stats                                     overall counts (runs, items by status)
  logs   [level=...] [source=...] [limit=N] recent system_logs (default last 50)
  errors [limit=N]                          shortcut for: logs level=error
  runs   [state=...] [limit=N]              recent runs
  run    <run_id_prefix>                    single run + its item breakdown
  bank   <bank_id>                          review_items breakdown for a bank
  item   <medvin_question_id>               review_item by Medvin question id

Destructive (require apply=true to actually run; default is dry-run):
  purge_low_confidence threshold=0.75 [include_null=true] [status=pending_review,pending_rewrite] [bank=N] [apply=true]
                                            delete review_items below detector confidence threshold

Notes:
  - Args are key=value or positional. e.g. "logs level=error limit=10"
  - level: debug | info | warn | error
  - state: detecting | rewriting | finished | cancelled | error
  - Read commands are RLS-bypassed (service role) — see all rows.`

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n))
}

function intArg(v: string | undefined, def: number, lo: number, hi: number): number {
  if (v == null) return def
  const n = parseInt(v, 10)
  return Number.isFinite(n) ? clamp(n, lo, hi) : def
}

async function cmdLogs(
  sb: SupabaseClient,
  args: Record<string, string>
): Promise<CommandOutput> {
  const limit = intArg(args.limit, 50, 1, 500)
  let q = sb
    .from('system_logs')
    .select('created_at, level, source, message, metadata')
    .order('created_at', { ascending: false })
    .limit(limit)
  if (args.level) q = q.eq('level', args.level)
  if (args.source) q = q.eq('source', args.source)
  const { data, error } = await q
  if (error) return { type: 'error', text: error.message }
  return {
    type: 'table',
    columns: ['created_at', 'level', 'source', 'message', 'metadata'],
    rows: data ?? [],
    footer: `${data?.length ?? 0} row(s)`,
  }
}

async function cmdErrors(
  sb: SupabaseClient,
  args: Record<string, string>
): Promise<CommandOutput> {
  return cmdLogs(sb, { ...args, level: 'error' })
}

async function cmdStats(sb: SupabaseClient): Promise<CommandOutput> {
  // Run counts by state
  const { data: runs } = await sb.from('runs').select('state')
  const runStates = new Map<string, number>()
  for (const r of runs ?? []) {
    runStates.set(r.state ?? 'unknown', (runStates.get(r.state ?? 'unknown') ?? 0) + 1)
  }
  // Item counts by status
  const { data: items } = await sb.from('review_items').select('status')
  const itemStatuses = new Map<string, number>()
  for (const r of items ?? []) {
    itemStatuses.set(r.status, (itemStatuses.get(r.status) ?? 0) + 1)
  }
  // Recent log volume (last 1h)
  const since = new Date(Date.now() - 60 * 60 * 1000).toISOString()
  const { data: logs } = await sb
    .from('system_logs')
    .select('level')
    .gte('created_at', since)
  const logLevels = new Map<string, number>()
  for (const r of logs ?? []) {
    logLevels.set(r.level, (logLevels.get(r.level) ?? 0) + 1)
  }

  return {
    type: 'json',
    data: {
      runs_by_state: Object.fromEntries(runStates),
      items_by_status: Object.fromEntries(itemStatuses),
      logs_last_hour_by_level: Object.fromEntries(logLevels),
    },
  }
}

async function cmdRuns(
  sb: SupabaseClient,
  args: Record<string, string>
): Promise<CommandOutput> {
  const limit = intArg(args.limit, 20, 1, 200)
  let q = sb
    .from('runs')
    .select(
      'id, started_at, state, question_bank_title, total_scanned, total_flagged, total_errors, cursor, total_pages'
    )
    .order('started_at', { ascending: false })
    .limit(limit)
  if (args.state) q = q.eq('state', args.state)
  const { data, error } = await q
  if (error) return { type: 'error', text: error.message }
  return {
    type: 'table',
    columns: [
      'started_at',
      'state',
      'question_bank_title',
      'total_scanned',
      'total_flagged',
      'total_errors',
      'cursor',
      'total_pages',
      'id',
    ],
    rows: data ?? [],
    footer: `${data?.length ?? 0} run(s)`,
  }
}

async function cmdRun(
  sb: SupabaseClient,
  positional: string[]
): Promise<CommandOutput> {
  const idPrefix = positional[0]
  if (!idPrefix) return { type: 'error', text: 'usage: run <run_id_prefix>' }

  // ilike on uuid columns is unreliable through Supabase JS — fetch a recent
  // window of runs and prefix-match client-side. Runs table stays small enough
  // that this is cheap.
  const { data: candidates } = await sb
    .from('runs')
    .select('id')
    .order('started_at', { ascending: false })
    .limit(500)
  const matches = (candidates ?? []).filter((r) =>
    r.id.toLowerCase().startsWith(idPrefix.toLowerCase())
  )
  if (matches.length === 0) {
    return { type: 'error', text: `no run with id starting with "${idPrefix}"` }
  }
  if (matches.length > 1) {
    return {
      type: 'error',
      text: `prefix "${idPrefix}" matches ${matches.length} runs — be more specific`,
    }
  }

  const { data: run } = await sb
    .from('runs')
    .select('*')
    .eq('id', matches[0].id)
    .single()
  const { data: items } = await sb
    .from('review_items')
    .select('status')
    .eq('run_id', matches[0].id)
  const breakdown: Record<string, number> = {}
  for (const i of items ?? []) breakdown[i.status] = (breakdown[i.status] ?? 0) + 1
  return {
    type: 'json',
    data: {
      run,
      item_breakdown: breakdown,
    },
  }
}

async function cmdBank(
  sb: SupabaseClient,
  positional: string[]
): Promise<CommandOutput> {
  const id = parseInt(positional[0] ?? '', 10)
  if (!Number.isFinite(id)) return { type: 'error', text: 'usage: bank <bank_id>' }
  const { data: items } = await sb
    .from('review_items')
    .select('status')
    .eq('medvin_question_bank_id', id)
  if (!items?.length) {
    return { type: 'text', text: `no review_items for bank ${id}` }
  }
  const breakdown: Record<string, number> = {}
  for (const i of items) breakdown[i.status] = (breakdown[i.status] ?? 0) + 1
  return { type: 'json', data: { bank_id: id, total: items.length, breakdown } }
}

async function cmdItem(
  sb: SupabaseClient,
  positional: string[]
): Promise<CommandOutput> {
  const qid = parseInt(positional[0] ?? '', 10)
  if (!Number.isFinite(qid)) {
    return { type: 'error', text: 'usage: item <medvin_question_id>' }
  }
  const { data, error } = await sb
    .from('review_items')
    .select(
      'id, medvin_question_id, medvin_question_bank_id, question_type, status, detection_reason, length_ratio, rewrite_confidence, ai_model_used, ai_prompt_version, reviewed_by, reviewed_at, reviewer_notes, created_at, updated_at, run_id'
    )
    .eq('medvin_question_id', qid)
    .order('created_at', { ascending: false })
  if (error) return { type: 'error', text: error.message }
  if (!data?.length) return { type: 'text', text: `no review_items for medvin_question_id ${qid}` }
  return {
    type: 'table',
    columns: [
      'medvin_question_id',
      'status',
      'created_at',
      'detection_reason',
      'length_ratio',
      'rewrite_confidence',
      'ai_model_used',
      'reviewer_notes',
      'id',
      'run_id',
    ],
    rows: data,
    footer: `${data.length} row(s)`,
  }
}

/* -------------------------------------------------------------------------- */
/*  Destructive commands                                                       */
/* -------------------------------------------------------------------------- */

/**
 * purge_low_confidence — delete review_items below a detector confidence
 * threshold. Defaults to dry-run (returns the count without deleting); pass
 * apply=true to actually delete.
 *
 * By default scoped to status in (pending_review, pending_rewrite) so we
 * don't auto-nuke already-actioned items. Default include_null=true treats
 * legacy items (created before detection_confidence existed) as low-conf.
 */
async function cmdPurgeLowConfidence(
  sb: SupabaseClient,
  args: Record<string, string>
): Promise<CommandOutput> {
  const threshold = parseFloat(args.threshold ?? '')
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1) {
    return {
      type: 'error',
      text: 'usage: purge_low_confidence threshold=<0..1> [include_null=true|false] [status=...] [bank=N] [apply=true]',
    }
  }
  const includeNull = (args.include_null ?? 'true').toLowerCase() !== 'false'
  const apply = (args.apply ?? '').toLowerCase() === 'true'
  const statusFilter = (args.status ?? 'pending_review,pending_rewrite')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  const bankId = args.bank ? parseInt(args.bank, 10) : null

  // Build the matching query
  let q = sb.from('review_items').select('id, detection_confidence, status, medvin_question_bank_id')
  if (statusFilter.length) q = q.in('status', statusFilter)
  if (bankId !== null && Number.isFinite(bankId)) {
    q = q.eq('medvin_question_bank_id', bankId)
  }
  if (includeNull) {
    q = q.or(`detection_confidence.lt.${threshold},detection_confidence.is.null`)
  } else {
    q = q.lt('detection_confidence', threshold)
  }
  const { data: matches, error } = await q
  if (error) return { type: 'error', text: error.message }

  const total = matches?.length ?? 0
  const nullCount = (matches ?? []).filter((r) => r.detection_confidence == null).length
  const belowCount = total - nullCount

  if (!apply) {
    return {
      type: 'json',
      data: {
        dry_run: true,
        would_delete: total,
        breakdown: {
          below_threshold: belowCount,
          null_confidence: nullCount,
        },
        threshold,
        include_null: includeNull,
        status_filter: statusFilter,
        bank: bankId,
        note: 'Dry run. Add apply=true to actually delete.',
      },
    }
  }

  if (total === 0) {
    return { type: 'text', text: 'Nothing to delete.' }
  }

  const ids = (matches ?? []).map((r) => r.id)
  // Chunk delete to keep individual queries under the URL length limit.
  const CHUNK = 200
  let deleted = 0
  for (let i = 0; i < ids.length; i += CHUNK) {
    const chunk = ids.slice(i, i + CHUNK)
    const { data: del, error: delErr } = await sb
      .from('review_items')
      .delete()
      .in('id', chunk)
      .select('id')
    if (delErr) {
      return {
        type: 'error',
        text: `partial: deleted ${deleted}/${total} before failing on: ${delErr.message}`,
      }
    }
    deleted += del?.length ?? 0
  }

  return {
    type: 'json',
    data: {
      dry_run: false,
      deleted,
      breakdown: {
        below_threshold: belowCount,
        null_confidence: nullCount,
      },
      threshold,
      include_null: includeNull,
      status_filter: statusFilter,
      bank: bankId,
    },
  }
}

/* -------------------------------------------------------------------------- */
/*  Dispatcher                                                                 */
/* -------------------------------------------------------------------------- */

export async function executeCommand(
  sb: SupabaseClient,
  parsed: ParsedCommand
): Promise<CommandOutput> {
  switch (parsed.name) {
    case 'help':
    case '?':
      return { type: 'text', text: HELP_TEXT }
    case 'stats':
      return cmdStats(sb)
    case 'logs':
      return cmdLogs(sb, parsed.args)
    case 'errors':
      return cmdErrors(sb, parsed.args)
    case 'runs':
      return cmdRuns(sb, parsed.args)
    case 'run':
      return cmdRun(sb, parsed.positional)
    case 'bank':
      return cmdBank(sb, parsed.positional)
    case 'item':
      return cmdItem(sb, parsed.positional)
    case 'purge_low_confidence':
      return cmdPurgeLowConfidence(sb, parsed.args)
    default:
      return {
        type: 'error',
        text: `unknown command: ${parsed.name} — type "help" for the list`,
      }
  }
}
