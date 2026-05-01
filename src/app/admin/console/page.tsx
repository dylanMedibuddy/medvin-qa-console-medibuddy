import { Nav } from '@/components/nav'
import { ConsoleUI } from './console-ui'

export const metadata = { title: 'Debug console — Medvin QA' }

export default function ConsolePage() {
  return (
    <>
      <Nav active="console" />
      <main className="mx-auto max-w-7xl px-6 py-8">
        <header className="mb-4">
          <h1 className="text-2xl font-semibold text-neutral-900">Debug console</h1>
          <p className="mt-1 text-sm text-neutral-500">
            Read-only commands against the database + system_logs. Up/down for
            history, &quot;clear&quot; to wipe the screen, &quot;help&quot; for available commands.
          </p>
        </header>
        <ConsoleUI />
      </main>
    </>
  )
}
