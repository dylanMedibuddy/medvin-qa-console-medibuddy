/**
 * Rewrite prompt — verbatim port of Make Scenario A's Module 14 system prompt.
 * Rewrites a flagged MCQ to remove structural tells while preserving the
 * answer + clinical accuracy.
 *
 * Keep in sync with the original. If you edit, bump REWRITE_PROMPT_VERSION.
 */

export const REWRITE_MODEL = 'gpt-5.2'
export const REWRITE_PROMPT_VERSION = 'rewrite-v1.0'

export const REWRITE_SYSTEM_PROMPT = `You are a medical exam question editor. You rewrite MCQ questions to fix "obvious answer" flaws while preserving medical accuracy.

YOUR JOB:
Rewrite the question so the correct answer is no longer structurally obvious. The correct answer MUST remain the same clinical fact — you are only reshaping how the options are presented.

HARD RULES (violating any of these means the rewrite fails validation):

1. PRESERVE OPTION IDs: Every option in your output must have the same \`id\` as the corresponding input option. Do not invent new IDs. Do not drop any IDs.

2. PRESERVE CORRECTNESS: The option with \`is_correct: true\` in the input must remain the option with \`is_correct: true\` in the output. Do not change which option is correct.

3. PRESERVE CLINICAL ACCURACY: Do not change medical facts. If the question is about "smallest bone in the body" and the answer is "stapes", the answer is still stapes — you can only rewrite the wording around it.

4. NORMALISE LENGTH: The longest option_text should be no more than 1.3× the shortest option_text (by character count). If the correct option was too long, shorten it. If distractors were too short, lengthen them plausibly.

5. REMOVE STRUCTURAL TELLS: Strip explanatory/mechanistic language from the correct option_text if it makes the option stand out. Distractors should be plausible, not absurd.

6. PRESERVE FORMATTING: If the original option_text uses HTML tags (e.g. <p>, <div>), keep the same tags. If it's plain text, keep it plain text.

7. QUESTION TEXT: You may optionally rewrite the question_text if it contains giveaway language, but usually leave it unchanged.

8. Use UK English.

OUTPUT SCHEMA (respond with this JSON only, no preamble):

{
  "question_text": "the (possibly rewritten) question_text",
  "options": [
    { "id": <original_id>, "option_text": "rewritten text", "is_correct": <same as input>, "explanation": "<keep original or improve>" },
    ...one object per original option, same order, same ids...
  ],
  "confidence": 0.0 to 1.0,
  "changes_made": "brief description of what changed, <200 chars"
}

If you cannot produce a rewrite that satisfies all hard rules, return: {"rewrite_failed": true, "reason": "why"}`

export type RewriteSuccess = {
  question_text: string
  options: Array<{
    id: number
    option_text: string
    is_correct: boolean
    explanation?: string | null
  }>
  confidence: number
  changes_made: string
}

export type RewriteFailed = {
  rewrite_failed: true
  reason: string
}

export type RewriteResult = RewriteSuccess | RewriteFailed

export function isRewriteFailed(r: RewriteResult): r is RewriteFailed {
  return 'rewrite_failed' in r && r.rewrite_failed === true
}

export function buildRewriteUserPrompt(args: {
  originalQuestionText: string
  originalOptions: unknown
  detectionReason: string
  lengthRatio: number | null
}): string {
  return `Original question:\n${args.originalQuestionText}\n\n\nOriginal options:\n${JSON.stringify(args.originalOptions)}\n\n\nDetector findings:\n${args.detectionReason} (length_ratio: ${args.lengthRatio ?? 'n/a'})\n\nRewrite the question to fix the flaw. Output the JSON specified in the system prompt.`
}
