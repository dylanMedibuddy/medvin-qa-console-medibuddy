'use client'

import { useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'
import { ConsoleUI } from './console-ui'

const HIDE_ON_PATHS = ['/login', '/auth']

/**
 * Floating debug console — a slide-up drawer available on every page (except
 * auth). Toggle with the bottom-right button or the `~` key.
 *
 * Mounted in the root layout but only renders the heavy ConsoleUI once the
 * user has actually opened it.
 */
export function FloatingConsole() {
  const pathname = usePathname()
  const [open, setOpen] = useState(false)
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      // Toggle on `~` (the unshifted backtick on most layouts) or Esc to close
      const target = e.target as HTMLElement | null
      const inInput =
        target?.tagName === 'INPUT' ||
        target?.tagName === 'TEXTAREA' ||
        target?.isContentEditable
      if (e.key === 'Escape' && open) {
        setOpen(false)
        return
      }
      if (inInput) return
      if (e.key === '`' || e.key === '~') {
        e.preventDefault()
        setOpen((v) => !v)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  useEffect(() => {
    if (open) setMounted(true)
  }, [open])

  if (HIDE_ON_PATHS.some((p) => pathname?.startsWith(p))) return null

  return (
    <>
      {/* Toggle button (always visible, bottom-right) */}
      <button
        onClick={() => setOpen((v) => !v)}
        title={open ? 'Close console (~ or Esc)' : 'Open console (~)'}
        className={`fixed bottom-4 right-4 z-40 flex h-10 items-center gap-2 rounded-full border border-neutral-700 bg-neutral-900 px-4 text-xs font-mono text-neutral-100 shadow-lg transition-all hover:bg-neutral-800 ${
          open ? 'opacity-0 pointer-events-none' : 'opacity-100'
        }`}
      >
        <span>$</span>
        <span>console</span>
        <kbd className="rounded border border-neutral-700 bg-neutral-800 px-1 text-[10px] text-neutral-400">
          ~
        </kbd>
      </button>

      {/* Drawer (slides up from bottom) */}
      <div
        className={`fixed inset-x-0 bottom-0 z-50 transition-transform duration-200 ${
          open ? 'translate-y-0' : 'translate-y-full pointer-events-none'
        }`}
      >
        <div className="mx-auto max-w-6xl px-4 pb-4">
          <div className="rounded-t-xl border border-b-0 border-neutral-800 bg-neutral-950 shadow-2xl">
            <div className="flex items-center justify-between border-b border-neutral-800 px-4 py-2">
              <div className="flex items-center gap-2 text-xs text-neutral-400">
                <span className="font-mono text-emerald-400">$</span>
                <span>debug console</span>
                <span className="text-neutral-600">·</span>
                <span className="text-neutral-500">read-only</span>
              </div>
              <div className="flex items-center gap-2 text-xs text-neutral-500">
                <kbd className="rounded border border-neutral-700 bg-neutral-800 px-1 text-[10px]">
                  Esc
                </kbd>
                <button
                  onClick={() => setOpen(false)}
                  className="rounded p-1 text-neutral-400 hover:bg-neutral-800 hover:text-neutral-100"
                  aria-label="Close console"
                >
                  ✕
                </button>
              </div>
            </div>
            <div className="p-3">{mounted && <ConsoleUI />}</div>
          </div>
        </div>
      </div>
    </>
  )
}
