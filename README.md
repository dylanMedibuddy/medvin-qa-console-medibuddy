# Medvin QA Console

Internal Medibuddy tool for reviewing AI-generated rewrites of medical exam questions flagged for structural flaws. Component 2 of a three-part pipeline — see [CONTEXT.md](./CONTEXT.md) for architecture.

## Stack

- Next.js 16 (App Router, TypeScript)
- Supabase (Postgres + Auth + RLS)
- Tailwind v4
- Railway (hosting)

## Setup

1. Copy env vars: `cp .env.local.example .env.local` and fill in Supabase keys + `MAKE_API_KEY`.
2. Create a Supabase project, run the SQL from [CONTEXT.md](./CONTEXT.md) §4, enable Google auth provider.
3. Install + run:
   ```
   npm install
   npm run dev
   ```

## Routes

- `/login` — Google SSO, restricted to `@medibuddy.co.uk`
- `/queue` — pending review items
- `/review/[id]` — side-by-side review *(not yet built)*
- `/api/make/*` — Make.com integration endpoints *(not yet built)*

## Claude Code

See [CLAUDE.md](./CLAUDE.md) for stack deltas, project layout, and build-order status.
