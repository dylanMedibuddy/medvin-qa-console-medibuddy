# Medvin QA Console

Internal Medibuddy tool for reviewing AI-generated rewrites of medical exam questions flagged for structural flaws. Component 2 of a three-part pipeline — see [CONTEXT.md](./CONTEXT.md) for architecture.

## Stack

- Next.js 16 (App Router, TypeScript)
- Supabase (Postgres + Auth + RLS)
- Tailwind v4
- Railway (hosting)

## Setup

1. Copy env vars: `cp .env.local.example .env.local` and fill in Supabase keys + `MAKE_API_KEY`.
2. Create a Supabase project, run the SQL from [CONTEXT.md](./CONTEXT.md) §4, then the migrations in `supabase/migrations/` in order.
3. Enable Google auth provider.
4. Install + run:
   ```
   npm install
   npm run dev
   ```

## Routes

- `/login` — Google SSO, restricted to `@medibuddy.co.uk`
- `/queue` — pending review items, with status / bank filters and bulk-action support
- `/approved-pending-push` — items reviewers have approved, waiting to be pushed to Medvin
- `/review/[id]` — side-by-side review with Approve / Reject
- `/api/make/*` — Make.com integration endpoints (see below)
- `/api/ui/*` — UI-triggered actions (approve / reject / bulk-action)

## Lifecycle

```
detection cron       rewrite cron        reviewer            push (TBD)
─────────────        ────────────        ────────            ────────
pending_rewrite ──>  pending_review ──>  approved_pending_push ──> pushed
                                    └─>  rejected                  push_error
```

A run starts in `state='detecting'` and walks Medvin pages one cron tick at a time. For each question the AI detector judges whether it's structurally obvious. Flagged items land as `pending_rewrite`. Once detection is done, the run flips to `state='rewriting'`. The rewrite cron picks up `pending_rewrite` items in batches, runs the AI rewriter, and either flips them to `pending_review` (success) or `rejected` with a note (rewriter declined or output failed validation). When no `pending_rewrite` items remain for a run, it flips to `state='finished'`.

Reviewer actions only operate on `pending_review`. Push from `approved_pending_push` to Medvin is the next slice (not built yet).

## In-app detection + rewrite

Two cron-triggered jobs replace what was Make Scenario A. Both authenticated via the `x-cron-secret` header.

### `POST /api/cron/detect` (run every 1 minute)

Picks the oldest run in `state='detecting'`. Fetches its next page (100 questions) from Medvin's `/api/admin/enrollments/{slug}/questions`. Runs the AI detector on each. Inserts flagged items as `pending_rewrite`. Advances cursor.

Each invocation processes one page (~1 minute on OpenAI tier 1). When the run runs out of pages, it flips to `state='rewriting'`.

```bash
curl -s -X POST "$API/api/cron/detect" -H "x-cron-secret: $CRON_SECRET"
# → 200 { ok, run_id, page, last_page, questions_on_page, flagged, detector_errors, state }
# → 200 { ok: true, processed: 0, note: "no detecting runs" } when there's nothing to do
```

### `POST /api/cron/rewrite` (run every 2 minutes)

Picks up to 10 `pending_rewrite` items. Runs the AI rewriter. Validates the output against the original (option ids preserved, correct answer preserved, no empty text). Flips to `pending_review` on success or `rejected` with `[auto-rejected: ...]` notes on failure.

After the batch, finishes any `state='rewriting'` runs whose pending items are all done.

```bash
curl -s -X POST "$API/api/cron/rewrite" -H "x-cron-secret: $CRON_SECRET"
# → 200 { ok, processed, succeeded, rewriter_failed, validation_failed, llm_errors }
```

### Railway cron setup

In Railway dashboard for the service:
1. Settings → **Cron Schedule** → add two schedules:
   - `* * * * *` (every minute) → `curl -fsS -X POST "$RAILWAY_PUBLIC_DOMAIN/api/cron/detect" -H "x-cron-secret: $CRON_SECRET"`
   - `*/2 * * * *` (every 2 min) → same shape but `/api/cron/rewrite`
2. Set env vars: `CRON_SECRET` (random hex), `OPENAI_API_KEY`, `MEDVIN_ADMIN_EMAIL`, `MEDVIN_ADMIN_PASSWORD`
3. Trigger a run from `/runs` and watch the Runs table — state should flip from `Detecting` → `Rewriting` → `Finished`

## Make API

All endpoints authenticate via `x-api-key` header matching `MAKE_API_KEY`. They use the Supabase service-role key server-side to bypass RLS. Every request logs method/path/status/duration to the server console.

Set once:

```bash
export API=http://localhost:3000
export KEY=$(grep '^MAKE_API_KEY=' .env.local | cut -d= -f2-)
```

### 1. `POST /api/make/runs` — start a run

```bash
curl -s -X POST "$API/api/make/runs" \
  -H "x-api-key: $KEY" \
  -H "content-type: application/json" \
  -d '{
    "question_bank_id": 7,
    "question_bank_title": "Dundee Y1 CST",
    "triggered_by": "manual:dylan@medibuddy.co.uk"
  }'
# → 201 { "run_id": "…" }
```

**Failure — missing API key:**
```bash
curl -s -X POST "$API/api/make/runs" \
  -H "content-type: application/json" \
  -d '{"question_bank_id": 7, "triggered_by": "manual"}'
# → 401 { "error": "unauthorized" }
```

### 2. `PATCH /api/make/runs/:id/finish` — close a run

```bash
curl -s -X PATCH "$API/api/make/runs/<RUN_ID>/finish" \
  -H "x-api-key: $KEY" \
  -H "content-type: application/json" \
  -d '{
    "total_scanned": 3760,
    "total_flagged": 47,
    "total_errors": 2,
    "notes": null
  }'
# → 200 { "ok": true }
```

### 3. `POST /api/make/review-items` — submit a flagged question

`original_payload` and `proposed_patch_payload` accept either a JSON object **or** a JSON-encoded string (the latter is a Make.com workaround — Data Structures can't pass nested objects cleanly).

The endpoint also runs structural validation against the rewrite before insert:
- proposed_options must have the same length as original_options
- the set of option `id`s must match exactly (no new ids, no missing ids)
- the set of correct-option ids must match exactly
- no proposed option may have empty/whitespace-only text (HTML stripped)
- proposed_question_text may not be empty/whitespace-only (HTML stripped)

All failures are returned together as `{ "error": "validation_failed", "details": [...] }` and logged to the server console as `[review-items] Validation failed`.

**Success — payloads as objects:**
```bash
curl -s -X POST "$API/api/make/review-items" \
  -H "x-api-key: $KEY" \
  -H "content-type: application/json" \
  -d '{
    "run_id": "<RUN_ID>",
    "medvin_question_id": 999,
    "medvin_question_bank_id": 7,
    "medvin_topic_id": 457,
    "medvin_unit_id": null,
    "question_type": "single-choice",
    "detection_reason": "correct option 2.3x length of shortest distractor",
    "length_ratio": 2.3,
    "original_question_text": "<p>Question?</p>",
    "original_options": [
      {"id": 1, "option_text": "<p>A long correct answer with extra words</p>", "is_correct": true,  "explanation": ""},
      {"id": 2, "option_text": "<p>B</p>", "is_correct": false, "explanation": ""}
    ],
    "original_payload": {"raw": "fake"},
    "proposed_question_text": "<p>Question?</p>",
    "proposed_options": [
      {"id": 1, "option_text": "<p>A short answer</p>", "is_correct": true,  "explanation": ""},
      {"id": 2, "option_text": "<p>B short distractor</p>", "is_correct": false, "explanation": ""}
    ],
    "proposed_patch_payload": {"question_text": "", "options": []},
    "rewrite_confidence": 0.87,
    "ai_model_used": "claude-sonnet-4-5",
    "ai_prompt_version": "v1.0"
  }'
# → 201 { "review_item_id": "…", "status": "pending_review" }
```

**Success — payloads as JSON strings (Make.com Data Structure workaround):**
```bash
curl -s -X POST "$API/api/make/review-items" \
  -H "x-api-key: $KEY" \
  -H "content-type: application/json" \
  -d '{
    "run_id": "<RUN_ID>",
    "medvin_question_id": 1000,
    "medvin_question_bank_id": 7,
    "medvin_topic_id": null,
    "medvin_unit_id": null,
    "question_type": "single-choice",
    "detection_reason": "test",
    "length_ratio": 2.0,
    "original_question_text": "<p>Q?</p>",
    "original_options": [
      {"id": 10, "option_text": "<p>A</p>", "is_correct": true,  "explanation": ""},
      {"id": 11, "option_text": "<p>B</p>", "is_correct": false, "explanation": ""}
    ],
    "original_payload": "{\"raw\":\"sent-as-string\"}",
    "proposed_question_text": "<p>Q?</p>",
    "proposed_options": [
      {"id": 10, "option_text": "<p>A2</p>", "is_correct": true,  "explanation": ""},
      {"id": 11, "option_text": "<p>B2</p>", "is_correct": false, "explanation": ""}
    ],
    "proposed_patch_payload": "{\"question_text\":\"\",\"options\":[]}",
    "rewrite_confidence": 0.9,
    "ai_model_used": "claude-sonnet-4-5",
    "ai_prompt_version": "v1.0"
  }'
# → 201 { "review_item_id": "…", "status": "pending_review" }
```

**Failure — duplicate `medvin_question_id` resubmitted while still active:**
```bash
# run the success curl again →
# 409 { "error": "already_in_queue", "medvin_question_id": 999 }
```

**Failure — validation (correct answer flipped, option text empty, ids changed):**
```bash
curl -s -X POST "$API/api/make/review-items" \
  -H "x-api-key: $KEY" \
  -H "content-type: application/json" \
  -d '{
    "run_id": "<RUN_ID>",
    "medvin_question_id": 1001,
    "medvin_question_bank_id": 7,
    "medvin_topic_id": null,
    "medvin_unit_id": null,
    "question_type": "single-choice",
    "detection_reason": "test",
    "length_ratio": 2.0,
    "original_question_text": "<p>Q?</p>",
    "original_options": [
      {"id": 10, "option_text": "<p>A</p>", "is_correct": true,  "explanation": ""},
      {"id": 11, "option_text": "<p>B</p>", "is_correct": false, "explanation": ""}
    ],
    "original_payload": {},
    "proposed_question_text": "<p>Q?</p>",
    "proposed_options": [
      {"id": 99, "option_text": "<p>A2</p>", "is_correct": false, "explanation": ""},
      {"id": 11, "option_text": "<div></div>", "is_correct": true, "explanation": ""}
    ],
    "proposed_patch_payload": {},
    "rewrite_confidence": 0.5,
    "ai_model_used": "x",
    "ai_prompt_version": "v1"
  }'
# → 400 {
#   "error": "validation_failed",
#   "details": [
#     "missing option id(s) in proposed: 10",
#     "new option id(s) not in original: 99",
#     "option(s) marked correct in original now not correct in proposed: 10",
#     "option(s) marked correct in proposed but not in original: 11",
#     "proposed option id 11 has empty/whitespace-only text"
#   ]
# }
```

**Failure — malformed JSON in a stringified payload field:**
```bash
curl -s -X POST "$API/api/make/review-items" \
  -H "x-api-key: $KEY" \
  -H "content-type: application/json" \
  -d '{ ..., "original_payload": "{not valid json", ... }'
# → 400 { "error": "malformed_json", "field": "original_payload" }
```

### 4. `GET /api/make/review-items?status=approved_pending_push&limit=50` — Scenario B polling

Make Scenario B polls this on a schedule to find items ready to push to Medvin. Returns items oldest-first (so retries don't starve fresh approvals).

```bash
curl -s "$API/api/make/review-items?status=approved_pending_push&limit=50" \
  -H "x-api-key: $KEY"
# → 200 {
#   "data": [
#     {
#       "id": "uuid",
#       "medvin_question_id": 142,
#       "medvin_question_bank_id": 7,
#       "proposed_patch_payload": { /* ready to fire at Medvin */ },
#       "reviewed_at": "..."
#     }
#   ]
# }
```

`status` can be any lifecycle value (defaults to `approved_pending_push`). `limit` is clamped to 1..200, default 50.

### 5. `PATCH /api/make/review-items/:id/pushed` — report push result

Make Scenario B calls this after PATCHing Medvin to report success or failure.

Allowed transitions: `approved_pending_push` → `pushed | push_error`, and `push_error` → `pushed | push_error` (retries).

```bash
# Success
curl -s -X PATCH "$API/api/make/review-items/<ITEM_ID>/pushed" \
  -H "x-api-key: $KEY" -H "content-type: application/json" \
  -d '{"status": "pushed", "patch_response": {"updated": true}}'
# → 200 { "ok": true }

# Failure
curl -s -X PATCH "$API/api/make/review-items/<ITEM_ID>/pushed" \
  -H "x-api-key: $KEY" -H "content-type: application/json" \
  -d '{"status": "push_error", "patch_response": {"status": 500, "body": "Medvin said no"}}'
# → 200 { "ok": true }
```

## Make.com integration

Two scenarios live in Make.com (not in this repo):

### Scenario A — Detection + LLM rewrite

**Trigger:** webhook (URL stored in env var `MAKE_SCENARIO_A_WEBHOOK_URL` on this app's server).

**Payload received:**
```json
{
  "question_bank_id": 7,
  "question_bank_title": "Dundee Y1 CST",
  "triggered_by": "ui:dylan@medibuddy.co.uk"
}
```

**Make does:**
1. `POST /api/make/runs` to open a run record (gets `run_id`)
2. Iterate questions in the bank, run length-ratio detection, LLM-rewrite flagged ones
3. For each flagged question: `POST /api/make/review-items` (must include `run_id`)
4. `PATCH /api/make/runs/:id/finish` with totals when done

**Trigger from UI:** the "Run now" button on `/runs` calls `POST /api/ui/runs` with `{question_bank_id}`. That endpoint POSTs to the Make webhook and returns immediately. The new run record is created by Make once Scenario A actually starts; expect 5-30s lag.

### Scenario B — Push approved rewrites to Medvin

**Trigger:** schedule (every N minutes).

**Make does:**
1. `GET /api/make/review-items?status=approved_pending_push&limit=50` to find work
2. For each item: `PATCH https://<medvin>/api/admin/questions/{medvin_question_id}` with the `proposed_patch_payload`
3. Report result back: `PATCH /api/make/review-items/:id/pushed` with `{status:"pushed"|"push_error", patch_response}`

**No UI trigger** — approving an item flips it to `approved_pending_push`, and the next Scenario B tick picks it up automatically.

### Bank list

The "Run now" dropdown is populated live from Medvin via `GET /api/admin/question-banks`. The app uses an admin account (read-only — this app never writes to Medvin) configured via these env vars on the server:

```
MEDVIN_BASE_URL=https://hub.medibuddy.co.uk
MEDVIN_ADMIN_EMAIL=...
MEDVIN_ADMIN_PASSWORD=...
```

The bearer token is cached in memory and refreshed automatically on a 401. If Medvin is unreachable, the page renders an amber warning above the dropdown rather than crashing.

## UI API

User-triggered actions live under `/api/ui/*`. They authenticate via the Supabase session cookie (Google SSO) and require the user's profile to have role `reviewer` or `admin`. They use the service-role client server-side for the mutation + audit_log writes.

Test these from the browser console (they need your session cookie) rather than curl:

```js
// browser console — paste while signed in to the deployed app
const id = '<review-item-id>'

// approve
await fetch(`/api/ui/review-items/${id}/approve`, {
  method: 'POST',
  headers: {'content-type': 'application/json'},
  body: '{}',
}).then(r => r.json())

// approve with edits
await fetch(`/api/ui/review-items/${id}/approve`, {
  method: 'POST',
  headers: {'content-type': 'application/json'},
  body: JSON.stringify({
    edited_proposal: {
      proposed_question_text: '<p>Edited question text</p>',
      proposed_options: [
        {id: 101, option_text: '<p>Edited A</p>', is_correct: false, explanation: ''},
        // ... must preserve all original ids and the original correct-set
      ],
      proposed_patch_payload: {edited: true},
    },
    reviewer_notes: 'Tightened the wording on option C.',
  }),
}).then(r => r.json())

// reject
await fetch(`/api/ui/review-items/${id}/reject`, {
  method: 'POST',
  headers: {'content-type': 'application/json'},
  body: JSON.stringify({reject_reason: 'rewrite_wrong'}),
}).then(r => r.json())

// reject with reason "other" (notes required)
await fetch(`/api/ui/review-items/${id}/reject`, {
  method: 'POST',
  headers: {'content-type': 'application/json'},
  body: JSON.stringify({
    reject_reason: 'other',
    reviewer_notes: 'Question is fine but explanation is misleading.',
  }),
}).then(r => r.json())

// bulk approve
await fetch('/api/ui/review-items/bulk-action', {
  method: 'POST',
  headers: {'content-type': 'application/json'},
  body: JSON.stringify({
    review_item_ids: ['id-1', 'id-2', 'id-3'],
    action: 'approve',
  }),
}).then(r => r.json())
// → { succeeded: ['id-1', 'id-2'], skipped: [{id: 'id-3', reason: 'not_pending_review (was approved_pending_push)'}] }
```

`reject_reason` values: `false_flag` · `rewrite_wrong` · `flag_correct_rewrite_failed` · `other` (notes required).

Common error responses:
- `401 unauthorized` — not signed in
- `403 forbidden` — signed in but profile role isn't reviewer/admin
- `404 not_found` — review item id doesn't exist
- `400 not_pending_review` — already actioned (race condition or stale UI)
- `400 validation_failed` — edited proposal failed structural rules (see Make API §3 for the rules)

## Claude Code

See [CLAUDE.md](./CLAUDE.md) for stack deltas, project layout, and build-order status.
