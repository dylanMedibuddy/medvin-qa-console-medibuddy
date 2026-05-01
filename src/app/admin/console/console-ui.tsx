'use client'

import { useEffect, useRef, useState } from 'react'

type CommandOutput =
  | { type: 'text'; text: string }
  | { type: 'error'; text: string }
  | {
      type: 'table'
      columns: string[]
      rows: Array<Record<string, unknown>>
      footer?: string
    }
  | { type: 'json'; data: unknown }

type Entry =
  | { kind: 'command'; text: string; ts: string }
  | { kind: 'output'; output: CommandOutput; ts: string }
  | { kind: 'pending'; text: string; ts: string }

const INITIAL_ENTRIES: Entry[] = [
  {
    kind: 'output',
    ts: new Date().toISOString(),
    output: {
      type: 'text',
      text: 'Medvin QA debug console. Type "help" to see commands.',
    },
  },
]

function fmtTs(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

function CellValue({ v }: { v: unknown }) {
  if (v == null) return <span className="text-neutral-500">null</span>
  if (typeof v === 'object') {
    return (
      <span className="font-mono text-[11px] text-neutral-300">
        {JSON.stringify(v)}
      </span>
    )
  }
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v)) {
    return (
      <span className="text-neutral-300">
        {new Date(v).toLocaleString('en-GB', {
          day: '2-digit',
          month: 'short',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
        })}
      </span>
    )
  }
  return <span>{String(v)}</span>
}

function OutputBlock({ output }: { output: CommandOutput }) {
  if (output.type === 'text') {
    return (
      <pre className="whitespace-pre-wrap font-mono text-xs text-neutral-200">
        {output.text}
      </pre>
    )
  }
  if (output.type === 'error') {
    return (
      <pre className="whitespace-pre-wrap font-mono text-xs text-red-400">
        ! {output.text}
      </pre>
    )
  }
  if (output.type === 'json') {
    return (
      <pre className="whitespace-pre-wrap font-mono text-xs text-neutral-200">
        {JSON.stringify(output.data, null, 2)}
      </pre>
    )
  }
  // table
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead className="text-left text-[10px] uppercase tracking-wide text-neutral-500">
          <tr>
            {output.columns.map((c) => (
              <th key={c} className="px-2 py-1 font-medium">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-neutral-800">
          {output.rows.map((row, i) => (
            <tr key={i}>
              {output.columns.map((c) => (
                <td key={c} className="px-2 py-1 align-top text-neutral-200">
                  <CellValue v={row[c]} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {output.footer && (
        <div className="mt-1 text-[10px] text-neutral-500">{output.footer}</div>
      )}
    </div>
  )
}

export function ConsoleUI() {
  const [entries, setEntries] = useState<Entry[]>(INITIAL_ENTRIES)
  const [input, setInput] = useState('')
  const [pending, setPending] = useState(false)
  const [history, setHistory] = useState<string[]>([])
  const [historyIdx, setHistoryIdx] = useState<number | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
  }, [entries])

  async function run(cmd: string) {
    const trimmed = cmd.trim()
    if (!trimmed) return
    const ts = new Date().toISOString()
    setEntries((es) => [...es, { kind: 'command', text: trimmed, ts }])
    setHistory((h) => [trimmed, ...h.filter((x) => x !== trimmed)].slice(0, 100))
    setHistoryIdx(null)
    setInput('')

    if (trimmed.toLowerCase() === 'clear') {
      setEntries(INITIAL_ENTRIES)
      return
    }

    setPending(true)
    try {
      const res = await fetch('/api/ui/console', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ command: trimmed }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setEntries((es) => [
          ...es,
          {
            kind: 'output',
            ts: new Date().toISOString(),
            output: {
              type: 'error',
              text: json?.detail ?? json?.error ?? `HTTP ${res.status}`,
            },
          },
        ])
        return
      }
      setEntries((es) => [
        ...es,
        { kind: 'output', ts: new Date().toISOString(), output: json.output },
      ])
    } catch (e) {
      const text = e instanceof Error ? e.message : String(e)
      setEntries((es) => [
        ...es,
        { kind: 'output', ts: new Date().toISOString(), output: { type: 'error', text } },
      ])
    } finally {
      setPending(false)
      inputRef.current?.focus()
    }
  }

  function onKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' && !pending) {
      run(input)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      const next = historyIdx == null ? 0 : Math.min(historyIdx + 1, history.length - 1)
      if (history[next] != null) {
        setHistoryIdx(next)
        setInput(history[next])
      }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (historyIdx == null) return
      const next = historyIdx - 1
      if (next < 0) {
        setHistoryIdx(null)
        setInput('')
      } else {
        setHistoryIdx(next)
        setInput(history[next])
      }
    }
  }

  return (
    <div className="rounded-lg border border-neutral-800 bg-neutral-950 p-3 font-mono">
      <div
        ref={scrollRef}
        className="max-h-[60vh] min-h-[300px] space-y-3 overflow-y-auto pr-2"
      >
        {entries.map((e, i) => (
          <div key={i}>
            {e.kind === 'command' && (
              <div className="text-xs text-emerald-400">
                <span className="text-neutral-600">{fmtTs(e.ts)} </span>
                <span className="text-neutral-500">$ </span>
                {e.text}
              </div>
            )}
            {e.kind === 'output' && (
              <div className="ml-4 mt-1">
                <OutputBlock output={e.output} />
              </div>
            )}
          </div>
        ))}
        {pending && (
          <div className="ml-4 text-xs text-neutral-500">…running</div>
        )}
      </div>

      <div className="mt-3 flex items-center gap-2 border-t border-neutral-800 pt-3">
        <span className="text-emerald-400">$</span>
        <input
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKey}
          disabled={pending}
          placeholder='try "help" or "stats"'
          className="flex-1 bg-transparent font-mono text-sm text-neutral-100 outline-none placeholder:text-neutral-600"
          autoComplete="off"
          spellCheck={false}
        />
      </div>
    </div>
  )
}
