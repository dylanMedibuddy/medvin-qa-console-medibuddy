import { createClient } from '@/lib/supabase/server'
import {
  STATUS_LABELS,
  STATUS_STYLES,
  type MedvinOption,
  type ReviewItemRow,
} from '@/lib/types'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { Nav } from '@/components/nav'
import { ReviewControls } from './controls'

type PageProps = { params: Promise<{ id: string }> }

function HtmlBlock({ html }: { html: string }) {
  return (
    <div
      className="prose prose-sm prose-neutral max-w-none text-neutral-800"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}

function OptionCard({ option, label }: { option: MedvinOption; label: string }) {
  return (
    <div
      className={`rounded-md border p-3 ${
        option.is_correct
          ? 'border-emerald-300 bg-emerald-50'
          : 'border-neutral-200 bg-white'
      }`}
    >
      <div className="mb-1 flex items-center justify-between">
        <span className="text-xs font-medium text-neutral-500">
          {label} · id {option.id}
        </span>
        {option.is_correct && (
          <span className="rounded bg-emerald-600 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">
            correct
          </span>
        )}
      </div>
      <HtmlBlock html={option.option_text} />
    </div>
  )
}

function Column({
  title,
  questionText,
  options,
}: {
  title: string
  questionText: string
  options: MedvinOption[]
}) {
  return (
    <section className="rounded-lg border border-neutral-200 bg-neutral-50 p-4">
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-neutral-500">
        {title}
      </h2>
      <div className="mb-4 rounded-md border border-neutral-200 bg-white p-3">
        <HtmlBlock html={questionText} />
      </div>
      <div className="space-y-2">
        {options.map((opt, i) => (
          <OptionCard
            key={`${opt.id}-${i}`}
            option={opt}
            label={String.fromCharCode(65 + i)}
          />
        ))}
      </div>
    </section>
  )
}

export default async function ReviewPage({ params }: PageProps) {
  const { id } = await params
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('review_items')
    .select('*')
    .eq('id', id)
    .maybeSingle<ReviewItemRow>()

  if (error) {
    return (
      <>
        <Nav active="queue" />
        <main className="mx-auto max-w-6xl px-6 py-10">
          <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-800">
            Failed to load item: {error.message}
          </div>
        </main>
      </>
    )
  }
  if (!data) notFound()

  const hasProposed = !!data.proposed_question_text && !!data.proposed_options
  const locked = data.status !== 'pending_review'
  const lockedReason = locked
    ? `This item is ${STATUS_LABELS[data.status].toLowerCase()} — no further actions available.`
    : !hasProposed
      ? 'No proposed rewrite on this item.'
      : undefined

  return (
    <>
      <Nav active="queue" />
      <main className="mx-auto max-w-7xl px-6 py-8">
        <nav className="mb-4 text-sm">
          <Link
            href="/queue"
            className="text-neutral-500 hover:text-neutral-900 hover:underline"
          >
            ← Back to queue
          </Link>
        </nav>

        <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-xs text-neutral-500">
              <span>Bank {data.medvin_question_bank_id}</span>
              {data.medvin_topic_id && <span>· Topic {data.medvin_topic_id}</span>}
              {data.medvin_unit_id && <span>· Unit {data.medvin_unit_id}</span>}
              <span>· Question #{data.medvin_question_id}</span>
              <span className="rounded bg-neutral-100 px-1.5 py-0.5 font-mono text-[10px] text-neutral-600">
                {data.question_type}
              </span>
            </div>
            <h1 className="text-xl font-semibold text-neutral-900">Review</h1>
            <p className="max-w-3xl text-sm text-neutral-700">
              <span className="font-medium">Detection reason:</span>{' '}
              {data.detection_reason}
              {data.length_ratio != null && (
                <span className="ml-2 text-neutral-500">
                  (length ratio {data.length_ratio.toFixed(2)}×)
                </span>
              )}
            </p>
          </div>
          <div className="flex flex-col items-end gap-2 text-right">
            <span
              className={`rounded px-2 py-0.5 text-xs font-medium ${
                STATUS_STYLES[data.status] ?? 'bg-neutral-100 text-neutral-700'
              }`}
            >
              {STATUS_LABELS[data.status] ?? data.status}
            </span>
            {data.rewrite_confidence != null && (
              <span className="text-xs text-neutral-500">
                confidence {data.rewrite_confidence.toFixed(2)}
              </span>
            )}
            {data.ai_model_used && (
              <span className="font-mono text-[10px] text-neutral-400">
                {data.ai_model_used}
                {data.ai_prompt_version ? ` · ${data.ai_prompt_version}` : ''}
              </span>
            )}
          </div>
        </header>

        <div className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Column
            title="Original"
            questionText={data.original_question_text}
            options={data.original_options}
          />
          {hasProposed ? (
            <Column
              title="Proposed rewrite"
              questionText={data.proposed_question_text!}
              options={data.proposed_options!}
            />
          ) : (
            <section className="rounded-lg border border-dashed border-neutral-300 bg-white p-8 text-center text-sm text-neutral-500">
              No proposed rewrite on this item.
            </section>
          )}
        </div>

        {data.reviewer_notes && (
          <div className="mb-6 rounded-md border border-neutral-200 bg-white p-3 text-sm">
            <div className="mb-1 text-xs font-medium text-neutral-500">
              Reviewer notes
            </div>
            <div className="whitespace-pre-wrap text-neutral-800">
              {data.reviewer_notes}
            </div>
          </div>
        )}

        <div className="rounded-lg border border-neutral-200 bg-white p-4">
          <ReviewControls
            id={data.id}
            disabled={locked || !hasProposed}
            lockedReason={lockedReason}
          />
        </div>
      </main>
    </>
  )
}
