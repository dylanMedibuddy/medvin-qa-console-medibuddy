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
- `/queue` — pending review items
- `/review/[id]` — side-by-side review with Approve / Reject
- `/api/make/*` — Make.com integration endpoints (see below)

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
    "original_question_text": "<p>Question…</p>",
    "original_options": [
      {"id": 1, "option_text": "<p>A</p>", "is_correct": false, "explanation": ""},
      {"id": 2, "option_text": "<p>B</p>", "is_correct": true,  "explanation": ""}
    ],
    "original_payload": {"raw": "fake"},
    "proposed_question_text": "<p>Question…</p>",
    "proposed_options": [
      {"id": 1, "option_text": "<p>A</p>", "is_correct": false, "explanation": ""},
      {"id": 2, "option_text": "<p>B</p>", "is_correct": true,  "explanation": ""}
    ],
    "proposed_patch_payload": {"question_text": "", "options": []},
    "rewrite_confidence": 0.87,
    "ai_model_used": "claude-sonnet-4-5",
    "ai_prompt_version": "v1.0"
  }'
# → 201 { "review_item_id": "…", "status": "pending_review" }
```

**Failure — same `medvin_question_id` resubmitted while still active:**
```bash
# run the same curl again →
# 409 { "error": "already_in_queue", "medvin_question_id": 999 }
```

### 4. `PATCH /api/make/review-items/:id/patched` — report patch result

Success:
```bash
curl -s -X PATCH "$API/api/make/review-items/<ITEM_ID>/patched" \
  -H "x-api-key: $KEY" \
  -H "content-type: application/json" \
  -d '{
    "status": "patched",
    "patch_response": {"updated": true}
  }'
# → 200 { "ok": true }
```

Error:
```bash
curl -s -X PATCH "$API/api/make/review-items/<ITEM_ID>/patched" \
  -H "x-api-key: $KEY" \
  -H "content-type: application/json" \
  -d '{
    "status": "patch_error",
    "patch_response": {"status": 500, "body": "Medvin said no"}
  }'
# → 200 { "ok": true }
```

Dry run (no `patched_at` is written):
```bash
curl -s -X PATCH "$API/api/make/review-items/<ITEM_ID>/patched" \
  -H "x-api-key: $KEY" \
  -H "content-type: application/json" \
  -d '{
    "status": "dry_run_would_patch",
    "patch_response": null
  }'
# → 200 { "ok": true }
```

**Failure — invalid status:**
```bash
curl -s -X PATCH "$API/api/make/review-items/<ITEM_ID>/patched" \
  -H "x-api-key: $KEY" \
  -H "content-type: application/json" \
  -d '{"status": "wat"}'
# → 400 { "error": "invalid_body", "fields": ["status"] }
```

## Claude Code

See [CLAUDE.md](./CLAUDE.md) for stack deltas, project layout, and build-order status.
