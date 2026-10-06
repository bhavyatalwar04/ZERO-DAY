// ============================================================================
// 5.4 study design (docs/STUDY.md): with study mode on, each user is assigned
// to "coached" or "control" by a stable hash of their user id, so the same
// person always gets the same condition on every device, with no table to keep.
// Control users still have every decision scored by Monitor (the scorecard is
// computed by replay), but see no coach feedback. Without a control group, a
// drop in mistakes could just be practice; with one, the coach's effect is the
// difference between the groups' trends.
// Off by default: everyone is coached. No 'server-only': the browser uses it too.
// Written by Claude at Bhavya's request (2026-10-03).
// ============================================================================

export type StudyCondition = 'coached' | 'control'

/** Inlined at build time. On only when explicitly "true". */
export const STUDY_MODE = process.env.NEXT_PUBLIC_STUDY_MODE === 'true'

/** FNV-1a (32-bit): a fast, stable string hash. Not cryptographic; it doesn't need to be. */
export function fnv1a(text: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h
}

export function studyCondition(userId: string, studyMode = STUDY_MODE): StudyCondition {
  if (!studyMode) return 'coached'
  return fnv1a(userId) % 2 === 0 ? 'coached' : 'control'
}
