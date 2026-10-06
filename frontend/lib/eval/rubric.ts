import { ungroundedNumbers } from '@/lib/agents/research/grounding'
import type { MonitorEventKind } from '@/lib/monitor/thresholds'
import type { MarketTruth } from './cases'

// ============================================================================
// 2.7 rubric: automatic, transparent checks on one piece of coach feedback
// (ADR-010). Each check is a regex or the grounding matcher, so every score can
// be explained line by line in the viva. No LLM judge: a judge model would add
// its own errors and cost quota; it is an optional extension.
//
// Known limits (say them in the report):
//   - Lexicons are crude: they catch a missing pattern name or a contradicted
//     price direction, not subtle wrongness. False positives are possible
//     ("risk could rise" is fine; the direction lexicon avoids bare "rise").
//   - Grounding checks number provenance, not meaning (same gap as M6.1).
// Written by Claude at Bhavya's request (2026-10-03).
// ============================================================================

export interface Feedback { message: string; question: string; severity?: string }

export const CHECKS = ['valid', 'grounded', 'noStopLoss', 'namesPattern', 'directionConsistent', 'actionable', 'hasQuestion'] as const
export type CheckName = (typeof CHECKS)[number]

/** Words that show the feedback names the right behaviour. */
export const PATTERN_WORDS: Record<MonitorEventKind, RegExp> = {
  panic_sell: /panic|fear|capitulat|sell(?:ing|s)? (?:in|into|during|on) (?:a |the )?(?:drop|fall|slide|sell-?off|crash|red|decline)|(?:lock|locking|locked) in (?:a |the |your )?loss|bail(?:ed|ing)? out|dump(?:ed|ing)?/i,
  averaging_down: /averag(?:e|ed|ing) down|add(?:ed|ing|s)? (?:more )?to (?:a |the |your )?(?:losing|underwater|falling)|buy(?:ing|s)? more (?:of )?(?:a |the |your )?(?:losing|falling|underwater)|doubl(?:e|ed|ing) down|more of a (?:losing|falling)/i,
  revenge_trade: /revenge|win (?:it|the loss|that|this) back|make up for|recoup|recover (?:the|your|that) loss|chas(?:e|ing) (?:the|your|a) loss|(?:right|soon|just) after (?:a |the |your |that )?loss|bigger after (?:a |the )?loss/i,
  news_reflex: /headline|news|knee-?jerk|reflex|impuls|react(?:ed|ing|ion)? (?:to|instantly|immediately|quickly|straight)/i,
  oversized_position: /oversiz|too (?:big|large)|position[- ]siz|sizing|size of (?:the|this|your|that) (?:order|position|trade|bet)|% of (?:your|the) (?:account|capital|portfolio|equity)|concentrat|(?:large|big) (?:share|chunk|portion|slice)/i,
  overtrading: /overtrad|(?:too )?many (?:orders|trades)|trad(?:e|es|ing) (?:too )?(?:often|frequently|fast)|(?:number|pace) of (?:orders|trades)|churn|(?:five|5) orders|rapid[- ]fire/i,
}

/**
 * Claims that contradict the stock's real move on the day. 2026-10-02 production:
 * the coach said "buying at a peak" while INDIGO was −7.9% on the day.
 */
export const CONTRADICTS: Record<MarketTruth['direction'], RegExp | null> = {
  down: /\b(?:at|near|into) (?:a|the) (?:peak|top|high)s?\b|\bbuying (?:the )?(?:high|top)\b|\brall(?:y|ies|ied|ying)\b|\bsurg(?:e|ed|es|ing)\b|\bsoar(?:ed|ing|s)?\b|\buptrend\b|\b(?:price|prices|stock|it) (?:is|are|was|were|has been|keeps) (?:rising|climbing|going up|up)\b/i,
  up: /\b(?:at|near|into) (?:a|the) (?:bottom|low)s?\b|\bcrash(?:ed|es|ing)?\b|\bplung(?:e|ed|es|ing)\b|\bcollaps(?:e|ed|es|ing)\b|\bdowntrend\b|\b(?:price|prices|stock|it) (?:is|are|was|were|has been|keeps) (?:falling|dropping|going down|down)\b/i,
  flat: null,
}

/** One thing the user can actually do in this simulator (mirrors the Coach prompt). */
export const ACTION = /\bpause|\bwait|smaller|reduc(?:e|ing) (?:the |your )?(?:size|position|stake)|size (?:it |down)|limit order|write (?:down|out)|\breason\b|\bplan\b|step back|breath|set (?:a |yourself a )?(?:rule|limit)|before (?:acting|you act|placing|buying|selling|trading)|check (?:the|your) (?:chart|position|size)|give it (?:a few|some) minutes/i

export const STOP_LOSS = /stop[\s-]?loss|\bSL\b|stop[\s-]?(?:order|price)|trailing stop/i

export interface ScoreInput {
  expected: MonitorEventKind
  truth: MarketTruth
  /** everything the system was given: numbers in the feedback must appear here */
  sources: string
}

export interface Score { checks: Record<CheckName, boolean>; passed: number; total: number; ungrounded: string[] }

/** Scores feedback for a case where a pattern IS present. null feedback fails every check. */
export function scoreFeedback(fb: Feedback | null, { expected, truth, sources }: ScoreInput): Score {
  const valid = !!fb && fb.message.trim().length >= 20 && fb.question.trim().length >= 5
  const text = fb ? `${fb.message} ${fb.question}` : ''
  const ungrounded = fb ? ungroundedNumbers(text, sources) : []
  const contra = CONTRADICTS[truth.direction]
  const checks: Record<CheckName, boolean> = {
    valid,
    grounded: valid && ungrounded.length === 0,
    noStopLoss: valid && !STOP_LOSS.test(text),
    namesPattern: valid && PATTERN_WORDS[expected].test(text),
    directionConsistent: valid && !(contra?.test(text) ?? false),
    actionable: valid && ACTION.test(fb!.message),
    hasQuestion: valid && /\?\s*$/.test(fb!.question.trim()),
  }
  const passed = CHECKS.filter(c => checks[c]).length
  return { checks, passed, total: CHECKS.length, ungrounded }
}
