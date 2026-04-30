-- Migration 002: lifecycle is now "review then push later", not "approve = patch immediately".
-- Statuses are renamed; existing rows are migrated.
-- Run via Supabase SQL Editor *after* 001.
--
-- Order matters: drop the old CHECK constraint first, then migrate data
-- (new status values would be rejected if the old constraint were still in effect),
-- then re-add the CHECK constraint with the new allowed values.

-- 1. Drop old CHECK constraint so the UPDATE statements below can use the new status values.
alter table public.review_items drop constraint review_items_status_check;

-- 2. Migrate existing rows to the new status values.
update public.review_items set status = 'approved_pending_push' where status = 'approved';
update public.review_items set status = 'pushed'                where status = 'patched';
update public.review_items set status = 'push_error'            where status = 'patch_error';
update public.review_items set status = 'approved_pending_push' where status in ('patching', 'dry_run_would_patch');

-- 3. Re-add CHECK constraint with the new allowed values.
alter table public.review_items add constraint review_items_status_check
  check (status in (
    'pending_review',
    'approved_pending_push',
    'rejected',
    'pushed',
    'push_error'
  ));

-- 4. Replace the partial unique index. The "active" set (where dupes are not allowed)
--    is now pending_review + approved_pending_push: those are the in-flight states for a question.
drop index if exists review_items_question_pending_idx;
create unique index review_items_question_pending_idx
  on public.review_items (medvin_question_id)
  where status in ('pending_review', 'approved_pending_push');
