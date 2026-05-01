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

Notes:
  - Args are key=value or positional. e.g. "logs level=error limit=10"
  - level: debug | info | warn | error
  - state: detecting | rewriting | finished | cancelled | error
  - All commands read-only.`

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
  const { data: matches } = await sb
    .from('runs')
    .select('*')
    .ilike('id', `${idPrefix}%`)
    .limit(2)
  if (!matches?.length) return { type: 'error', text: `no run with id starting with "${idPrefix}"` }
  if (matches.length > 1) return { type: 'error', text: `id prefix "${idPrefix}" is ambiguous` }
  const run = matches[0]
  const { data: items } = await sb
    .from('review_items')
    .select('status')
    .eq('run_id', run.id)
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
    default:
      return {
        type: 'error',
        text: `unknown command: ${parsed.name} — type "help" for the list`,
      }
  }
}
