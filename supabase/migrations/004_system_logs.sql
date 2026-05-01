-- Migration 004: system_logs table.
-- Append-only log of significant events from cron handlers and other server
-- code. Powers the /admin/console "logs" command.

create table public.system_logs (
  id uuid primary key default gen_random_uuid(),
  level text not null check (level in ('debug', 'info', 'warn', 'error')),
  source text not null,
  message text not null,
  metadata jsonb,
  created_at timestamptz not null default now()
);

create index on public.system_logs (created_at desc);
create index on public.system_logs (level, created_at desc);
create index on public.system_logs (source, created_at desc);

alter table public.system_logs enable row level security;

create policy "system_logs readable by authenticated"
  on public.system_logs for select
  to authenticated
  using (true);
