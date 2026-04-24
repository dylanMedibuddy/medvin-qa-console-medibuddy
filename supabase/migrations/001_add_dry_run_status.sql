-- Extend review_items.status to allow 'dry_run_would_patch' (Scenario B dry-run mode).
-- Run via Supabase SQL Editor.

alter table public.review_items
  drop constraint review_items_status_check;

alter table public.review_items
  add constraint review_items_status_check
  check (status in (
    'pending_review',
    'approved',
    'rejected',
    'patching',
    'patched',
    'patch_error',
    'dry_run_would_patch'
  ));
