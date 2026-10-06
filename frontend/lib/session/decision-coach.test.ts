import { describe, it, expect } from 'vitest'
import { buy, drive, findMoment, px, qtyFor, sell, COV20_DATASET } from '@/lib/monitor/test-helpers'
import { monitorSession } from '@/lib/monitor/monitor'
import { describeSource, newEvents, requestFeedback, type FeedbackDeps } from './decision-coach'
import type { SyncStatus } from './sync'

const loss = findMoment('a 5-minute loss', (s, m) => m > 20 && m + 5 < 70 && px(s, m + 5) < px(s, m) * 0.998)
const q = qtyFor(loss.symbol, loss.minute, 15_000)
const session = drive([loss.minute, buy(loss.symbol, q), 5, sell(loss.symbol, q), 2, buy('TCS', qtyFor('TCS', loss.minute + 7, 30_000))])
const event = monitorSession(session.entries, COV20_DATASET).find(e => e.kind === 'revenge_trade')!
const feedback = { message: 'You traded bigger right after a loss.', severity: 'warning' as const, question: 'Why this size?' }

function fakeSync(sent: number, status: SyncStatus = 'idle', id: string | null = 'sess') {
  const s = { sentN: sent, statusV: status }
  return { s, sync: { sent: () => s.sentN, status: () => s.statusV, sessionId: () => id } }
}
function deps(over: Partial<FeedbackDeps> & { responses?: (Response | Error)[] } = {}) {
  const requests: unknown[] = []
  let t = 0
  const responses = over.responses ?? [Response.json({ pipelineId: 'p', path: 'full', feedback, event: null, audited: true })]
  const d: FeedbackDeps = {
    sync: fakeSync(event.actionSeq + 1).sync,
    fetch: (async (_url: string, init: RequestInit) => {
      requests.push(JSON.parse(init.body as string))
      const r = responses.shift() ?? Response.json({}, { status: 500 })
      if (r instanceof Error) throw r
      return r
    }) as unknown as typeof fetch,
    sleep: async ms => { t += ms },
    now: () => t,
    ...over,
  }
  return { d, requests }
}

describe('newEvents', () => {
  it('returns only events from entries after the processed seq', () => {
    expect(newEvents(session.entries, -1, COV20_DATASET).map(e => e.kind)).toContain('revenge_trade')
    expect(newEvents(session.entries, event.actionSeq, COV20_DATASET)).toEqual([])
  })
})

describe('requestFeedback', () => {
  it('server feedback: sends the claim (kind, minute, symbol) for the triggering action', async () => {
    const { d, requests } = deps()
    const r = await requestFeedback(event, d)
    expect(r).toEqual({ feedback, source: { kind: 'server', path: 'full' } })
    expect(requests[0]).toEqual({ sessionId: 'sess', actionSeq: event.actionSeq, claimed: { kind: 'revenge_trade', simMinute: event.simMinute, symbol: 'TCS' } })
  })

  it('waits until the triggering action is synced before asking', async () => {
    const { s, sync } = fakeSync(event.actionSeq)          // not yet sent
    let slept = 0
    const { d } = deps({ sync, sleep: async () => { if (++slept === 3) s.sentN = event.actionSeq + 1 } })
    const r = await requestFeedback(event, d)
    expect(r.source).toEqual({ kind: 'server', path: 'full' })
    expect(slept).toBe(3)
  })

  it('retries on 409 (stored rows not visible yet)', async () => {
    const { d, requests } = deps({ responses: [Response.json({ error: 'not_synced' }, { status: 409 }), Response.json({ pipelineId: 'p', path: 'monitor_only', feedback, event: null, audited: true })] })
    expect((await requestFeedback(event, d)).source).toEqual({ kind: 'server', path: 'monitor_only' })
    expect(requests).toHaveLength(2)
  })

  it.each([
    ['signed out / demo (no sync)', { sync: null }, 'not_signed_in'],
    ['sync failed', { sync: fakeSync(0, 'failed').sync }, 'sync_failed'],
    ['sync too slow', { sync: fakeSync(0, 'retrying').sync }, 'sync_slow'],
    ['network error', { responses: [new TypeError('Failed to fetch')] }, 'network'],
    ['server error', { responses: [Response.json({}, { status: 500 })] }, 'server_error'],
    ['server rejected the claim', { responses: [Response.json({ pipelineId: 'p', path: 'rejected', feedback: null, event: null, audited: true })] }, 'rejected'],
    ['hourly limit reached (429)', { responses: [Response.json({ error: 'rate_limited' }, { status: 429 })] }, 'rate_limited'],
    ['never synced (409 ×4)', { responses: [409, 409, 409, 409].map(s => Response.json({}, { status: s })) }, 'not_synced'],
  ] as const)('%s → local template, with the reason', async (_, over, reason) => {
    const { d } = deps(over as Partial<FeedbackDeps> & { responses?: (Response | Error)[] })
    const r = await requestFeedback(event, d)
    expect(r.source).toEqual({ kind: 'local', reason })
    expect(r.feedback.message).toContain(event.summary)
  })
})

describe('describeSource', () => {
  it('is honest about which kind of feedback the user is reading', () => {
    expect(describeSource({ kind: 'server', path: 'full' })).toMatch(/AI coach · with market research/)
    expect(describeSource({ kind: 'server', path: 'template' })).toMatch(/Standard feedback/)
    expect(describeSource({ kind: 'local', reason: 'not_signed_in' })).toMatch(/sign in/)
  })
})
