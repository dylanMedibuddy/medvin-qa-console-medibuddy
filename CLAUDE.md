@AGENTS.md
@CONTEXT.md

# Medvin QA Console — Claude Code notes

Read `CONTEXT.md` first. It is the authoritative handover doc (architecture, schema, API contract, review-screen rules, locked-in decisions). The notes below are deltas and gotchas that don't belong in the handover doc itself.

## Stack deltas from CONTEXT.md

- **Next.js 16** (not 15 as written in CONTEXT.md §3). The scaffold pulled the latest. Relevant breaking changes:
  - `middleware.ts` is renamed to `proxy.ts`. Named export is `proxy`. Node runtime only (no edge). See `src/proxy.ts`.
  - `cookies()`, `headers()`, `params`, `searchParams` are all async — always `await` them.
  - `next lint` is removed; use `eslint` directly.
  - Turbopack is the default for `dev` and `build`.
- **npm** (not pnpm) — pnpm is not installed on Dylan's machine and the other Medibuddy projects use npm.
- **Tailwind v4** — uses `@theme` in CSS, no `tailwind.config.ts`.

## Project layout

```
src/
  app/
    actions/sign-out.ts      # server action
    auth/callback/route.ts   # OAuth code exchange
    auth/error/page.tsx      # domain-restriction error page
    login/page.tsx           # Google SSO button
    queue/page.tsx           # main landing — pending_review items
    layout.tsx               # root, Geist fonts
    page.tsx                 # redirects to /queue
  lib/
    supabase/
      browser.ts             # client-side Supabase client
      server.ts              # server-side (async cookies) + service role helper
      proxy.ts               # session refresh + auth gate + domain check
    types.ts                 # ReviewItemRow, MedvinOption, etc.
  proxy.ts                   # the Next 16 "middleware" — calls lib/supabase/proxy
```

## Auth flow

1. User hits any protected route → `proxy.ts` sees no user, redirects to `/login`.
2. `/login` triggers Supabase `signInWithOAuth({ provider: 'google' })` with `hd=medibuddy.co.uk` hint.
3. Google redirects to `/auth/callback?code=…`.
4. Callback exchanges the code, verifies email ends in `@medibuddy.co.uk`, otherwise signs out and redirects to `/auth/error?reason=domain`.
5. On success, redirects to `/queue`.
6. `proxy.ts` enforces the domain check on every subsequent request as defence-in-depth.

The `hd` param is a hint to Google, not a guarantee — the server-side domain check in both `/auth/callback` and `proxy.ts` is the real enforcement.

## Build order status (CONTEXT.md §14)

- [x] 1. Scaffold Next.js + Tailwind + Supabase client
- [x] 2. Supabase project setup + schema SQL + Google provider
- [x] 3. Auth flow + proxy + domain restriction
- [x] 4. /queue basic table
- [x] 5. /review/[id] side-by-side + approve/reject
- [x] 6. /api/make/* endpoints with API key auth — **requires `supabase/migrations/001_add_dry_run_status.sql` applied**
- [x] 7. Seed test items (via SQL insert, see commit history)
- [ ] 8. Diff highlighting, keyboard shortcuts, edit-in-place
- [ ] 9. /runs and /audit pages
- [ ] 10. /admin/users
- [x] 11. Deploy to Railway — live at https://medvin-qa-console-medibuddy-production.up.railway.app

## Lifecycle (after migration 002)

Statuses: `pending_review` → `approved_pending_push` | `rejected` → `pushed` | `push_error`. The `approved` / `patching` / `patched` / `patch_error` / `dry_run_would_patch` statuses from the original schema were removed; data was migrated. See `supabase/migrations/002_review_lifecycle_v2.sql`.

## Column naming caveat

`review_items.patched_at` and `review_items.patch_response` are misnamed after migration 002 (semantically they're now `pushed_at` / `push_response`). Left in place to avoid invasive renames; rename when Scenario B is built.

## Detection + rewrite are in-app (Phase 1 of the Make migration)

Make Scenario A is deprecated. The pipeline now runs as two cron-triggered routes:
- `src/app/api/cron/detect/route.ts` — picks oldest `state='detecting'` run, fetches one Medvin page, runs the AI detector on each question, inserts flagged items as `pending_rewrite`, advances cursor. When out of pages, flips run to `state='rewriting'`.
- `src/app/api/cron/rewrite/route.ts` — picks up to 10 `pending_rewrite` items, runs the AI rewriter, validates output, flips to `pending_review` (success) or `rejected` with auto-note (rewriter declined / validation failed).

Prompts ported verbatim from the Make blueprint live in `src/lib/prompts/{detect,rewrite}.ts`. Bump `*_PROMPT_VERSION` when editing — `ai_prompt_version` is recorded on every review_item.

LLM client: `src/lib/llm.ts` (OpenAI SDK, rate-limit retry with backoff, `chatCompleteJson` helper).

Cron auth: `CRON_SECRET` env var, `x-cron-secret` header. See `src/lib/api/cron-auth.ts`.

`POST /api/ui/runs` no longer POSTs to a Make webhook — it just inserts a `runs` row. Detection cron picks it up next tick.

## Outstanding
- Phase 2 push to Medvin. Approved items sit in `approved_pending_push` until built. Will be `src/app/api/cron/push/route.ts` calling `PATCH /api/admin/questions/{id}` via an extended `src/lib/medvin.ts`. **At that point the "Medvin client is read-only" rule below stops being true.**
- Make Scenario A teardown: pause/delete in Make once the cron pipeline is proven end-to-end. `MAKE_API_KEY` and `MAKE_SCENARIO_A_WEBHOOK_URL` env vars become unused.
- Inline edit mode on `/review/[id]`. API already supports `edited_proposal`; UI doesn't expose it.
- Keyboard shortcuts (A/R/E/J/K) on review screen.
- `/admin/users` + admin bootstrap trigger.
- `gpt-5.2` is hardcoded in both prompt files. Move to env var if you want runtime model switching.
- Medvin client (`src/lib/medvin.ts`) is currently read-only. Push (Phase 2) adds write methods.
- Approve/reject server actions are gone; the UI calls `/api/ui/*` via fetch and the audit_log captures every transition with `actor_user_id` and a `diff` payload.

## Notes for future sessions

- Admin bootstrap: the `handle_new_user` trigger in CONTEXT.md §4 doesn't currently set admin from `ADMIN_BOOTSTRAP_EMAIL`. When wiring Supabase, extend the trigger (or a separate one) to check the new user's email and set `role = 'admin'` when it matches.
- The `/review/[id]` Hard Rules (CONTEXT.md §7): preserve option ids, exactly one `is_correct` for single-choice. Validate client- AND server-side before approval.
- Make-facing endpoints use the service role client (`createServiceRoleClient` in `lib/supabase/server.ts`) to bypass RLS. Never call that from the browser.
- Schema evolution lives in `supabase/migrations/NNN_*.sql` — apply in order via Supabase SQL Editor. `001` adds `dry_run_would_patch` to the `review_items.status` check constraint.
- Audit log: `/api/make/*` endpoints write `actor_type = 'system'` rows. User-initiated approve/reject actions don't yet write audit_log — will need to when `/audit` page is built (either an RLS insert policy for authenticated or switch those server actions to the service role).
