# Medvin QA Console – Project Context

> Handover document for Claude Code. Read this first, then confirm you understand the architecture before writing any code.

## 1. What we're building

An internal web app used by the Medibuddy content team to review and approve AI-generated rewrites of medical exam questions flagged as having "obvious answer" flaws. It's the review interface for an automated QA pipeline that runs elsewhere (Make.com).

### Background

Earlier this year we analysed 3,760 MCQs in the Dundee Y1 CST bank and found many questions had structural tells — the correct option was noticeably longer than distractors, or distractors contained giveaway phrases. Students can game these without knowing the material. The pattern is detectable, but reviewing every question by hand across multiple banks isn't feasible.

The solution is a three-part system:

1. **Make.com batch scanner** — enumerates questions in a bank via the Medvin admin API, runs a detector, calls an LLM to draft rewrites, and POSTs flagged items into this web app's database via a small API.
2. **This web app** — reviewers see the queue of proposed rewrites, approve/reject/edit, and everything is logged.
3. **Make.com patcher** — watches the web app for approved items and PATCHes them back to Medvin.

**This repo is only component 2.** The Make scenarios live in Make.com (not this codebase). The web app exposes a small HTTP API for Make to push into and poll.

## 2. Architecture

```
Medvin API ──────┐                                  ┌────── Medvin API
                 │                                  │
                 ▼                                  ▲
       ┌──────────────────┐              ┌──────────────────┐
       │  Make Scenario A │              │  Make Scenario B │
       │  (detect + draft)│              │ (patch approved) │
       └─────────┬────────┘              └─────────▲────────┘
                 │ POST /api/review-items          │
                 │                                 │ GET /api/review-items?status=approved
                 │                                 │ PATCH /api/review-items/:id/patched
                 ▼                                 │
       ┌────────────────────────────────────────────────┐
       │          THIS REPO (Next.js + Supabase)        │
       │                                                │
       │  ┌──────────┐   ┌──────────┐   ┌──────────┐    │
       │  │  /queue  │   │/review/:id│  │ /audit   │    │
       │  └──────────┘   └──────────┘   └──────────┘    │
       │                                                │
       │                  Supabase DB                   │
       │    review_items · runs · audit_log · profiles  │
       └────────────────────────────────────────────────┘
                 ▲
                 │ Google SSO (medibuddy.co.uk only)
                 │
          Reviewers: Dylan, Kat, April, Abbie (+ Alex)
```

Key principle: **the web app is the source of truth for review state. Make is the orchestrator.** They talk over HTTP with an API key. No shared state.

## 3. Tech stack (decided)

- **Framework:** Next.js 15+, App Router, TypeScript
- **DB + Auth:** Supabase (Postgres, RLS, Supabase Auth with Google provider)
- **Styling:** Tailwind CSS. Use shadcn/ui for components where it fits.
- **Hosting:** Railway (same as the user's other projects — Sift, stripe-query-agent-v2)
- **Auth:** Google SSO restricted to `@medibuddy.co.uk` email domain
- **Package manager:** pnpm (or npm if pnpm isn't available — match the user's preference)

This mirrors the Sift project stack so the user has muscle memory. Don't invent a different stack.

## 4. Supabase schema

This is the authoritative schema. Apply via SQL in the Supabase dashboard.

```sql
-- ============================================================
-- enums (using CHECK constraints rather than enum types for
-- easier evolution later; swap to native enums if preferred)
-- ============================================================

-- ============================================================
-- profiles (extends auth.users)
-- ============================================================
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  role text not null default 'reviewer' check (role in ('admin', 'reviewer')),
  medibuddy_team text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index on public.profiles (role);

-- Auto-create profile on signup
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', new.email));
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ============================================================
-- runs (one row per Scenario A batch)
-- ============================================================
create table public.runs (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  question_bank_id integer not null,
  question_bank_title text,
  total_scanned integer not null default 0,
  total_flagged integer not null default 0,
  total_errors integer not null default 0,
  triggered_by text,
  notes text,
  created_at timestamptz not null default now()
);

create index on public.runs (started_at desc);
create index on public.runs (question_bank_id);

-- ============================================================
-- review_items (the core queue)
-- ============================================================
create table public.review_items (
  id uuid primary key default gen_random_uuid(),

  -- Medvin identifiers
  medvin_question_id integer not null,
  medvin_question_bank_id integer not null,
  medvin_topic_id integer,
  medvin_unit_id integer,
  question_type text not null,

  -- Detection
  run_id uuid references public.runs(id) on delete set null,
  detected_at timestamptz not null default now(),
  detection_reason text not null,
  length_ratio numeric(5,2),

  -- Original content (snapshot at time of detection)
  original_question_text text not null,
  original_options jsonb not null,
  original_payload jsonb not null,

  -- Proposed rewrite
  proposed_question_text text,
  proposed_options jsonb,
  proposed_patch_payload jsonb,
  rewrite_confidence numeric(3,2),
  ai_model_used text,
  ai_prompt_version text,

  -- Review state
  status text not null default 'pending_review'
    check (status in ('pending_review','approved','rejected','patching','patched','patch_error')),
  reviewed_by uuid references public.profiles(id),
  reviewed_at timestamptz,
  reviewer_notes text,

  -- Patch result
  patched_at timestamptz,
  patch_response jsonb,

  -- Housekeeping
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index on public.review_items (status);
create index on public.review_items (medvin_question_bank_id);
create index on public.review_items (medvin_question_id);
create index on public.review_items (run_id);
create index on public.review_items (detected_at desc);
create unique index review_items_question_pending_idx
  on public.review_items (medvin_question_id)
  where status in ('pending_review','approved','patching');
  -- prevents two pending reviews for the same question at once

-- ============================================================
-- audit_log (append-only)
-- ============================================================
create table public.audit_log (
  id uuid primary key default gen_random_uuid(),
  review_item_id uuid not null references public.review_items(id) on delete cascade,
  actor_user_id uuid references public.profiles(id),
  actor_type text not null default 'user' check (actor_type in ('user','system')),
  action text not null,
  from_status text,
  to_status text,
  diff jsonb,
  created_at timestamptz not null default now()
);

create index on public.audit_log (review_item_id, created_at desc);
create index on public.audit_log (actor_user_id);

-- ============================================================
-- RLS
-- ============================================================
alter table public.profiles enable row level security;
alter table public.runs enable row level security;
alter table public.review_items enable row level security;
alter table public.audit_log enable row level security;

-- profiles: users can read all profiles, update only their own
create policy "profiles readable by authenticated"
  on public.profiles for select
  to authenticated
  using (true);

create policy "users update own profile"
  on public.profiles for update
  to authenticated
  using (auth.uid() = id);

-- review_items: readable by authenticated users, updatable by reviewers/admins
create policy "review_items readable by authenticated"
  on public.review_items for select
  to authenticated
  using (true);

create policy "review_items updatable by reviewers"
  on public.review_items for update
  to authenticated
  using (
    exists (
      select 1 from public.profiles
      where id = auth.uid() and role in ('admin','reviewer')
    )
  );

-- runs: read-only for authenticated; writes only via service role
create policy "runs readable by authenticated"
  on public.runs for select
  to authenticated
  using (true);

-- audit_log: read-only for authenticated; writes only via service role or triggers
create policy "audit_log readable by authenticated"
  on public.audit_log for select
  to authenticated
  using (true);
```

The Make API endpoints use the Supabase **service role key** (server-side only) to bypass RLS when inserting review_items and runs. Never expose the service role key to the client.

## 5. API contract (Make ↔ this app)

All Make-facing endpoints live under `/api/make/*` and authenticate via `x-api-key` header. The shared secret is stored in `MAKE_API_KEY` env var on both sides.

### `POST /api/make/runs`
Start a new run record.

**Request:**
```json
{
  "question_bank_id": 7,
  "question_bank_title": "Dundee Y1 CST",
  "triggered_by": "manual"
}
```

**Response 201:**
```json
{ "run_id": "uuid-here" }
```

### `PATCH /api/make/runs/:id/finish`
Mark a run as finished with counts.

**Request:**
```json
{
  "total_scanned": 3760,
  "total_flagged": 47,
  "total_errors": 2,
  "notes": "optional free text"
}
```

### `POST /api/make/review-items`
Submit a flagged question for review.

**Request:**
```json
{
  "run_id": "uuid",
  "medvin_question_id": 142,
  "medvin_question_bank_id": 7,
  "medvin_topic_id": 457,
  "medvin_unit_id": null,
  "question_type": "single-choice",
  "detection_reason": "correct option 2.3x length of shortest distractor",
  "length_ratio": 2.3,
  "original_question_text": "<div>...</div>",
  "original_options": [ { "id": 1, "option_text": "...", "is_correct": false, "explanation": "..." } ],
  "original_payload": { /* full GET response from Medvin */ },
  "proposed_question_text": "<div>...</div>",
  "proposed_options": [ { "id": 1, "option_text": "...", "is_correct": false, "explanation": "..." } ],
  "proposed_patch_payload": { /* full PATCH body ready to fire */ },
  "rewrite_confidence": 0.87,
  "ai_model_used": "claude-sonnet-4-5",
  "ai_prompt_version": "v1.0"
}
```

**Response 201:**
```json
{ "review_item_id": "uuid", "status": "pending_review" }
```

Return 409 if a pending_review / approved / patching item already exists for that `medvin_question_id` (enforced by the unique index).

### `GET /api/make/review-items?status=approved&not_patched=true&limit=50`
Used by Scenario B to find items ready to patch.

**Response 200:**
```json
{
  "data": [
    {
      "id": "uuid",
      "medvin_question_id": 142,
      "proposed_patch_payload": { /* ready to fire */ }
    }
  ]
}
```

### `PATCH /api/make/review-items/:id/patched`
Scenario B reports the patch result back.

**Request (success):**
```json
{
  "status": "patched",
  "patch_response": { /* Medvin response */ }
}
```

**Request (error):**
```json
{
  "status": "patch_error",
  "patch_response": { /* error body or description */ }
}
```

## 6. Pages / routes

- `/login` — Google SSO, restrict to `@medibuddy.co.uk` domain (enforce in a Supabase auth hook or via middleware after sign-in)
- `/queue` — default landing page for authenticated users. Table of review items, filter by status/bank/question_type, sort by confidence / detected_at. Default: pending_review, newest first.
- `/review/[id]` — review detail screen. See section 7.
- `/runs` — run history, with links filtering the queue.
- `/audit` — timeline of every audit_log entry, filterable by user/item/action. Admin-only.
- `/admin/users` — manage profile roles. Admin-only.
- `/api/make/*` — server-side API routes for Make (service role key).
- `/api/ui/*` — server actions or route handlers for UI-triggered actions (approve, reject, edit proposal).

## 7. Review screen requirements

This is where reviewers will spend their time. Get this right.

**Layout:**
- Top: breadcrumb (Bank → Topic → Unit → Question ID), detection reason, confidence score badge.
- Main: two-column diff. Left = original, right = proposed. Each column renders the question_text then the options.
- Options render as cards — correct option has a visible green marker. Keep HTML rendering sandboxed (these are trusted-ish admin strings, but still treat as untrusted for defense in depth).
- Word-level diff highlighting between original and proposed option_text. Use `diff-match-patch` or `react-diff-viewer`.
- Bottom bar: Approve / Reject / Edit Proposal buttons. Keyboard shortcuts: A = approve, R = reject, E = edit, J/K = next/previous item.
- Edit mode lets reviewers modify `proposed_question_text` and each option's `option_text` inline, preserving `id` and `is_correct`. Saving an edit logs the change in audit_log.

**Hard rules:**
- Must preserve all option ids from `original_options` into `proposed_options`.
- Must keep exactly one option marked `is_correct: true` (for single-choice) or at least one (for multiple-choice).
- Must not allow submitting an approval if either of the above fails — show a clear error.

## 8. Auth details

- Google OAuth via Supabase.
- After sign-in, check the user's email ends with `@medibuddy.co.uk`. If not, sign them out and show an error.
- First Medibuddy user to sign up should be auto-promoted to `admin` — implement via a one-time bootstrap (e.g. an `ADMIN_BOOTSTRAP_EMAIL` env var that gets `admin` role on profile creation).
- All other users start as `reviewer` and can be promoted via `/admin/users`.

## 9. Environment variables

```
# Supabase
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=         # server-only

# Make integration
MAKE_API_KEY=                      # shared secret for /api/make/*

# Auth
ADMIN_BOOTSTRAP_EMAIL=dylan@medibuddy.co.uk

# App
NEXT_PUBLIC_APP_URL=https://medvin-qa.up.railway.app
```

## 10. Medvin API reference (for Make — included for context only)

The web app does **not** call the Medvin API directly. Make does. But Claude Code should understand the shape of data being stored.

- Base URL (staging): `https://mvin.onfynno.in`
- Base URL (prod): `https://hub.medibuddy.co.uk`
- Auth: Laravel Sanctum bearer token. `POST /api/admin/login` returns `{ token, user }`.
- Key endpoints: `GET /api/admin/questions/{id}`, `PATCH /api/admin/questions/{id}`, `GET /api/admin/question-banks`, `GET /api/admin/topics?question_bank_id=`, `GET /api/admin/units?question_bank_id=&topic_id=`.

Sample question response shape (what goes into `original_payload`):
```json
{
  "data": {
    "id": 142,
    "question_type": { "slug": "single-choice", "label": "Single Choice" },
    "question_bank_id": 7,
    "topic_id": 457,
    "unit_id": null,
    "question_text": "<div>...</div>",
    "learning_objective": null,
    "difficulty_level": 3,
    "marks": 10,
    "flashcard_tags": [],
    "chapters": [],
    "sections": [],
    "videos": [],
    "in_mock_exam_only": false,
    "is_free_trial": true,
    "explanation": null,
    "options": [
      { "id": 4, "option_text": "<div>...</div>", "explanation": "...", "is_correct": false }
    ]
  }
}
```

Question types in the wild: `single-choice`, `multiple-choice`, `most-least`, `rank-in-order`, `calculation`, `toggle`. v1 of this tool only handles `single-choice` and `multiple-choice`.

## 11. Decisions already made (don't relitigate)

- Next.js + Supabase + Railway stack (matches Sift).
- Make.com does detection and AI rewriting, not this app.
- Sheet-based approach was rejected — web app is the review UI.
- Polling (not webhooks) for Scenario B in v1. Webhooks can come later.
- Google SSO domain-restricted. No password auth.
- Append-only audit_log, no soft deletes.
- Store full `original_payload` and `proposed_patch_payload` forever (rollback safety net).

## 12. Out of scope for this repo

- Running the detector (Make does it).
- Calling the LLM for rewrites (Make does it).
- Calling the Medvin API directly (Make does it).
- Email notifications (v2, maybe).
- Mobile app (not happening).

## 13. Open questions (flag to user if relevant)

- Final sign-off policy — is content-team approval alone sufficient, or does Alex want to see samples first? Affects whether we need a two-stage approval flow.
- Revert/rollback UX — v1 has the data to revert but no UI. Decide if it's v1 or v2.
- Bulk actions on the queue (e.g. "approve all with confidence > 0.9") — v1 or v2?
- Whether the `/api/make/*` API key should be a single shared secret or a rotatable key per Make scenario.

## 14. Suggested build order

1. Scaffold Next.js + Tailwind + Supabase client.
2. Supabase project setup, run the schema SQL, configure Google auth provider, set domain restriction.
3. Auth flow + middleware + profile bootstrap.
4. `/queue` page with basic table from `review_items` (no filters yet).
5. `/review/[id]` with side-by-side view (no diff highlighting yet), approve/reject buttons.
6. `/api/make/*` endpoints with API key auth — can test via curl or Postman.
7. Seed a couple of test review_items manually so the UI has something to render.
8. Add diff highlighting, keyboard shortcuts, edit-in-place.
9. `/runs` and `/audit` pages.
10. `/admin/users`.
11. Deploy to Railway.

At this point the repo is ready for integration with the real Make scenarios. Those are built separately.

## 15. User profile (Dylan)

- UK-based developer at Medibuddy. Primary author of this system.
- Experienced with the stack — Next.js, Supabase, Railway, Make.com, Anthropic API.
- Prefers casual, direct communication. No corporate filler.
- Builds incrementally — doesn't want elaborate upfront design, prefers to ship working slices.
- Naming convention for repos: `kebab-case-medibuddy` or `kebab-case-v2` (see `unified-outreach-tool-medibuddy`, `stripe-query-agent-v2`).

## 16. First thing to do

Before writing any code: confirm you've read this document, outline the build plan for the first slice (probably items 1–4 from section 14), and ask Dylan any clarifying questions. Don't start scaffolding until he says go.
