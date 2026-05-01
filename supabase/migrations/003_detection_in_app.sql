-- Migration 003: detection + rewriting move into the app (replaces Make Scenario A).
-- Run via Supabase SQL Editor *after* 002.
--
-- Adds run lifecycle columns and a pending_rewrite intermediate status for
-- review_items between detection and review.

-- 1. Run lifecycle: state machine + cursor + total_pages.
alter table public.runs add column if not exists state text not null default 'detecting'
  check (state in ('detecting', 'rewriting', 'finished', 'cancelled', 'error'));
alter table public.runs add column if not exists cursor jsonb;
alter table public.runs add column if not exists total_pages integer;
alter table public.runs add column if not exists error_message text;
alter table public.runs add column if not exists enrollment_slug text;

create index if not exists runs_state_idx on public.runs (state);

-- 2. New status: pending_rewrite. Detected by AI, awaiting rewrite step.
alter table public.review_items drop constraint review_items_status_check;
alter table public.review_items add constraint review_items_status_check
  check (status in (
    'pending_rewrite',
    'pending_review',
    'approved_pending_push',
    'rejected',
    'pushed',
    'push_error'
  ));

-- 3. Update partial unique index. "Active" set now includes pending_rewrite.
drop index if exists review_items_question_pending_idx;
create unique index review_items_question_pending_idx
  on public.review_items (medvin_question_id)
  where status in ('pending_rewrite', 'pending_review', 'approved_pending_push');
