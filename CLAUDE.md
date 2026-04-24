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
- [ ] 2. Supabase project setup + schema SQL + Google provider — **Dylan to do before step 3 works**
- [x] 3. Auth flow + proxy + domain restriction
- [x] 4. /queue basic table
- [ ] 5. /review/[id] side-by-side + approve/reject
- [ ] 6. /api/make/* endpoints with API key auth
- [ ] 7. Seed test items
- [ ] 8. Diff highlighting, keyboard shortcuts, edit-in-place
- [ ] 9. /runs and /audit pages
- [ ] 10. /admin/users
- [ ] 11. Deploy to Railway

## Notes for future sessions

- Admin bootstrap: the `handle_new_user` trigger in CONTEXT.md §4 doesn't currently set admin from `ADMIN_BOOTSTRAP_EMAIL`. When wiring Supabase, extend the trigger (or a separate one) to check the new user's email and set `role = 'admin'` when it matches.
- The `/review/[id]` Hard Rules (CONTEXT.md §7): preserve option ids, exactly one `is_correct` for single-choice. Validate client- AND server-side before approval.
- Make-facing endpoints use the service role client (`createServiceRoleClient` in `lib/supabase/server.ts`) to bypass RLS. Never call that from the browser.
