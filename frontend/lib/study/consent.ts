// ============================================================================
// 5.4 study consent (docs/STUDY.md § Ethics). With study mode on, a signed-in
// user is asked once whether they agree to take part. Only people who agreed
// are randomised into coached/control; everyone else gets the normal (coached)
// product and their sessions carry no study condition, so they can't end up in
// the analysis by accident.
//
// The answer is stored in the user's own Supabase user_metadata
// (`study_consent`). That field is writable by the user (AUDIT §5), which is
// right here: consent is the participant's own statement, and they must be able
// to withdraw it. The export (docs/STUDY.md) reads it from auth.users, so a
// withdrawal also removes their earlier sessions from the analysis.
// Pure functions: no 'server-only', the browser uses them too.
// Written by Claude at Bhavya's request (2026-11-04).
// ============================================================================

import { STUDY_MODE, studyCondition, type StudyCondition } from './condition'

/** Bump when the information sheet changes materially: everyone is asked again. */
export const CONSENT_VERSION = '2026-11'

export type ConsentStatus = 'given' | 'declined' | 'withdrawn'

export interface ConsentRecord {
  status: ConsentStatus
  version: string
  /** ISO timestamp of the answer */
  at: string
}

const STATUSES: readonly ConsentStatus[] = ['given', 'declined', 'withdrawn']

/** Reads the consent record from user_metadata. Anything malformed counts as "not asked". */
export function consentOf(metadata: unknown): ConsentRecord | null {
  const raw = (metadata as { study_consent?: unknown } | null | undefined)?.study_consent as Partial<ConsentRecord> | undefined
  if (!raw || typeof raw !== 'object') return null
  if (!STATUSES.includes(raw.status as ConsentStatus) || typeof raw.version !== 'string' || typeof raw.at !== 'string') return null
  return { status: raw.status as ConsentStatus, version: raw.version, at: raw.at }
}

/** A participant: agreed to the current information sheet and hasn't withdrawn. */
export function isParticipant(record: ConsentRecord | null): boolean {
  return record?.status === 'given' && record.version === CONSENT_VERSION
}

/** Should the consent screen be shown? Only in study mode, and only until they answer the current version. */
export function needsConsentPrompt(record: ConsentRecord | null, studyMode = STUDY_MODE): boolean {
  if (!studyMode) return false
  return !record || record.version !== CONSENT_VERSION
}

/**
 * The condition this user actually plays under. Non-participants are always
 * coached: declining the study must never cost anyone the product's feedback.
 */
export function effectiveCondition(
  user: { id: string; user_metadata?: unknown },
  studyMode = STUDY_MODE,
): StudyCondition {
  if (!studyMode || !isParticipant(consentOf(user.user_metadata))) return 'coached'
  return studyCondition(user.id, true)
}

export function consentRecord(status: ConsentStatus, now = new Date()): ConsentRecord {
  return { status, version: CONSENT_VERSION, at: now.toISOString() }
}
