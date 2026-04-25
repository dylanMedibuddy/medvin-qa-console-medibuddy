type RawOption = {
  id: number
  option_text: string
  is_correct: boolean
  explanation?: string | null
}

export type CoerceResult =
  | { ok: true; value: Record<string, unknown> }
  | { ok: false; error: 'malformed_json' | 'invalid_payload' }

/**
 * Make.com can't pass nested objects through Data Structures cleanly, so it
 * sometimes sends payload fields as JSON strings. Accept either:
 * - an object → use as-is
 * - a string → JSON.parse, then ensure result is a non-null non-array object
 *
 * Anything else (null, array, number, boolean, undefined, or string-that-doesn't-parse)
 * is rejected with a specific error code.
 */
export function coerceJsonPayload(raw: unknown): CoerceResult {
  let parsed: unknown = raw
  if (typeof raw === 'string') {
    try {
      parsed = JSON.parse(raw)
    } catch {
      return { ok: false, error: 'malformed_json' }
    }
  }
  if (
    parsed === null ||
    typeof parsed !== 'object' ||
    Array.isArray(parsed)
  ) {
    return { ok: false, error: 'invalid_payload' }
  }
  return { ok: true, value: parsed as Record<string, unknown> }
}

/**
 * Strip HTML tags + decode common entities so we can detect "visually empty"
 * content like "<div></div>" or "<p>&nbsp;</p>".
 */
function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim()
}

function isOption(x: unknown): x is RawOption {
  if (!x || typeof x !== 'object') return false
  const o = x as Record<string, unknown>
  return (
    typeof o.id === 'number' &&
    typeof o.option_text === 'string' &&
    typeof o.is_correct === 'boolean'
  )
}

/**
 * Validate a proposed rewrite against the original. Runs every check; returns
 * all failures so the caller can log/return them in one shot.
 */
export function validateRewrite(
  originalOptions: unknown[],
  proposedOptions: unknown[],
  proposedQuestionText: string
): string[] {
  const errors: string[] = []

  if (!originalOptions.every(isOption)) {
    errors.push('original_options has invalid shape (id:number, option_text:string, is_correct:boolean required)')
  }
  if (!proposedOptions.every(isOption)) {
    errors.push('proposed_options has invalid shape (id:number, option_text:string, is_correct:boolean required)')
  }
  if (errors.length) return errors

  const orig = originalOptions as RawOption[]
  const prop = proposedOptions as RawOption[]

  // (a) Same option count
  if (orig.length !== prop.length) {
    errors.push(`option count changed: original ${orig.length} → proposed ${prop.length}`)
  }

  // (b) All option ids preserved (set equality)
  const origIds = new Set(orig.map((o) => o.id))
  const propIds = new Set(prop.map((o) => o.id))
  const missing = [...origIds].filter((id) => !propIds.has(id))
  const added = [...propIds].filter((id) => !origIds.has(id))
  if (missing.length) errors.push(`missing option id(s) in proposed: ${missing.join(',')}`)
  if (added.length) errors.push(`new option id(s) not in original: ${added.join(',')}`)

  // (c) Correct-answer set equality (works for single- and multi-choice)
  const origCorrect = new Set(orig.filter((o) => o.is_correct).map((o) => o.id))
  const propCorrect = new Set(prop.filter((o) => o.is_correct).map((o) => o.id))
  const lost = [...origCorrect].filter((id) => !propCorrect.has(id))
  const gained = [...propCorrect].filter((id) => !origCorrect.has(id))
  if (lost.length) {
    errors.push(`option(s) marked correct in original now not correct in proposed: ${lost.join(',')}`)
  }
  if (gained.length) {
    errors.push(`option(s) marked correct in proposed but not in original: ${gained.join(',')}`)
  }

  // (d) No empty option text (HTML stripped)
  for (const opt of prop) {
    if (stripHtml(opt.option_text) === '') {
      errors.push(`proposed option id ${opt.id} has empty/whitespace-only text`)
    }
  }

  // (e) No empty proposed question text (HTML stripped)
  if (stripHtml(proposedQuestionText) === '') {
    errors.push('proposed_question_text is empty/whitespace-only after stripping HTML')
  }

  return errors
}
