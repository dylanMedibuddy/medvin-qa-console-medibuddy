export type ReviewStatus =
  | 'pending_review'
  | 'approved'
  | 'rejected'
  | 'patching'
  | 'patched'
  | 'patch_error'

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
