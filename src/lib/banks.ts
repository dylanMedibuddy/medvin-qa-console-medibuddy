/**
 * Static list of question banks the "Run now" UI offers.
 * Edit this file to add/remove banks. IDs come from Medvin admin.
 *
 * TODO: replace with a live fetch from Medvin's GET /api/admin/question-banks
 * once we have the admin token plumbing.
 */

export type Bank = {
  id: number
  title: string
}

export const BANKS: Bank[] = [
  { id: 7, title: 'Dundee Y1 CST' },
  // Add more banks here as you scan them.
]
