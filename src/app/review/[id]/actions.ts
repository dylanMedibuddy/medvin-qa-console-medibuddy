'use server'

import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'

type ApproveResult = { ok: true } | { ok: false; error: string }

async function currentUserId() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('not authenticated')
  return { supabase, userId: user.id }
}

export async function approveItem(id: string): Promise<ApproveResult> {
  const { supabase, userId } = await currentUserId()

  const { data: item, error: fetchErr } = await supabase
    .from('review_items')
    .select('id, status, question_type, proposed_options')
    .eq('id', id)
    .single()

  if (fetchErr || !item) return { ok: false, error: 'Item not found' }
  if (item.status !== 'pending_review') return { ok: false, error: `Already ${item.status}` }

  const options = (item.proposed_options ?? []) as Array<{ id: number; is_correct: boolean }>
  if (options.length === 0) return { ok: false, error: 'Proposed options are empty' }

  const correctCount = options.filter((o) => o.is_correct).length
  if (item.question_type === 'single-choice' && correctCount !== 1) {
    return { ok: false, error: `Single-choice needs exactly one correct option (found ${correctCount})` }
  }
  if (item.question_type === 'multiple-choice' && correctCount < 1) {
    return { ok: false, error: 'Multiple-choice needs at least one correct option' }
  }

  const { error: updateErr } = await supabase
    .from('review_items')
    .update({
      status: 'approved',
      reviewed_by: userId,
      reviewed_at: new Date().toISOString(),
    })
    .eq('id', id)
    .eq('status', 'pending_review')

  if (updateErr) return { ok: false, error: updateErr.message }

  revalidatePath('/queue')
  revalidatePath(`/review/${id}`)
  return { ok: true }
}

export async function rejectItem(id: string, notes: string): Promise<ApproveResult> {
  const { supabase, userId } = await currentUserId()

  const { error } = await supabase
    .from('review_items')
    .update({
      status: 'rejected',
      reviewed_by: userId,
      reviewed_at: new Date().toISOString(),
      reviewer_notes: notes.trim() || null,
    })
    .eq('id', id)
    .eq('status', 'pending_review')

  if (error) return { ok: false, error: error.message }

  revalidatePath('/queue')
  revalidatePath(`/review/${id}`)
  return { ok: true }
}

export async function approveAndReturn(id: string) {
  const result = await approveItem(id)
  if (result.ok) redirect('/queue')
  return result
}

export async function rejectAndReturn(id: string, notes: string) {
  const result = await rejectItem(id, notes)
  if (result.ok) redirect('/queue')
  return result
}
