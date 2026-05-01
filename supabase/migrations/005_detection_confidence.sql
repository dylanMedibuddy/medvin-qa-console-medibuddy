-- Migration 005: store the detector's confidence on flagged review_items.
-- Lets us tune (or retroactively filter) on detector confidence without
-- re-running the AI detector.

alter table public.review_items
  add column if not exists detection_confidence numeric(3,2);

create index if not exists review_items_detection_confidence_idx
  on public.review_items (detection_confidence);
