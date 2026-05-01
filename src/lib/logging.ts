import { createServiceRoleClient } from '@/lib/supabase/server'

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

export type LogArgs = {
  level: LogLevel
  source: string
  message: string
  metadata?: Record<string, unknown> | null
}

/**
 * Write a log entry to system_logs (best-effort) AND to console (so Railway
 * logs see it too). Never throws — logging must not break the caller.
 */
export async function log(args: LogArgs): Promise<void> {
  const consoleMethod: 'log' | 'warn' | 'error' =
    args.level === 'error' ? 'error' : args.level === 'warn' ? 'warn' : 'log'
  const prefix = `[${args.source}]`
  if (args.metadata) {
    console[consoleMethod](prefix, args.message, args.metadata)
  } else {
    console[consoleMethod](prefix, args.message)
  }

  try {
    const sb = await createServiceRoleClient()
    await sb.from('system_logs').insert({
      level: args.level,
      source: args.source,
      message: args.message,
      metadata: args.metadata ?? null,
    })
  } catch (e) {
    console.error('[logging] insert failed', e)
  }
}

export const logInfo = (source: string, message: string, metadata?: Record<string, unknown>) =>
  log({ level: 'info', source, message, metadata })

export const logWarn = (source: string, message: string, metadata?: Record<string, unknown>) =>
  log({ level: 'warn', source, message, metadata })

export const logError = (source: string, message: string, metadata?: Record<string, unknown>) =>
  log({ level: 'error', source, message, metadata })
