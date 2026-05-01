export type ReviewStatus =
  | 'pending_rewrite'
  | 'pending_review'
  | 'approved_pending_push'
  | 'rejected'
  | 'pushed'
  | 'push_error'

export type RunState =
  | 'detecting'
  | 'rewriting'
  | 'finished'
  | 'cancelled'
  | 'error'

export type RejectReason =
  | 'false_flag'
  | 'rewrite_wrong'
  | 'flag_correct_rewrite_failed'
  | 'other'

export const REJECT_REASONS: { value: RejectReason; label: string }[] = [
  { value: 'false_flag', label: 'False flag — original was fine' },
  { value: 'rewrite_wrong', label: 'Rewrite changes the answer or is medically wrong' },
  { value: 'flag_correct_rewrite_failed', label: 'Flag was right but the rewrite is bad' },
  { value: 'other', label: 'Other (notes required)' },
]

export type QuestionType =
  | 'single-choice'
  | 'multiple-choice'
  | 'most-least'
  | 'rank-in-order'
  | 'calculation'
  | 'toggle'

export type MedvinOption = {
  id: number
  option_text: string
  explanation?: string | null
  is_correct: boolean
}

export type ReviewItemRow = {
  id: string
  medvin_question_id: number
  medvin_question_bank_id: number
  medvin_topic_id: number | null
  medvin_unit_id: number | null
  question_type: QuestionType
  run_id: string | null
  detected_at: string
  detection_reason: string
  length_ratio: number | null
  original_question_text: string
  original_options: MedvinOption[]
  proposed_question_text: string | null
  proposed_options: MedvinOption[] | null
  rewrite_confidence: number | null
  ai_model_used: string | null
  ai_prompt_version: string | null
  status: ReviewStatus
  reviewed_by: string | null
  reviewed_at: string | null
  reviewer_notes: string | null
  patched_at: string | null
  created_at: string
  updated_at: string
}

export const STATUS_STYLES: Record<ReviewStatus, string> = {
  pending_rewrite: 'bg-purple-100 text-purple-800',
  pending_review: 'bg-amber-100 text-amber-800',
  approved_pending_push: 'bg-emerald-100 text-emerald-800',
  rejected: 'bg-neutral-200 text-neutral-700',
  pushed: 'bg-blue-100 text-blue-800',
  push_error: 'bg-red-100 text-red-800',
}

export const STATUS_LABELS: Record<ReviewStatus, string> = {
  pending_rewrite: 'Awaiting rewrite',
  pending_review: 'Pending review',
  approved_pending_push: 'Approved (ready to push)',
  rejected: 'Rejected',
  pushed: 'Pushed',
  push_error: 'Push error',
}

export const RUN_STATE_STYLES: Record<RunState, string> = {
  detecting: 'bg-blue-100 text-blue-800',
  rewriting: 'bg-purple-100 text-purple-800',
  finished: 'bg-emerald-100 text-emerald-800',
  cancelled: 'bg-neutral-200 text-neutral-700',
  error: 'bg-red-100 text-red-800',
}

export const RUN_STATE_LABELS: Record<RunState, string> = {
  detecting: 'Detecting',
  rewriting: 'Rewriting',
  finished: 'Finished',
  cancelled: 'Cancelled',
  error: 'Error',
}
