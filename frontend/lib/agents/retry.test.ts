import { describe, it, expect } from 'vitest'
import { withRetry, isRetryable, backoffDelay, DEFAULT_RETRY } from './retry'
import { scriptedModel, ModelCallError, type ModelRequest } from './model'

const req = (signal = new AbortController().signal): ModelRequest =>
  ({ model: 'm', messages: [{ role: 'user', content: 'hi' }], maxTokens: 10, signal })

const noSleep = async () => {}
const err = (kind: ModelCallError['kind'], status?: number) => new ModelCallError(kind, `${kind} ${status ?? ''}`, status)

describe('isRetryable', () => {
  it('retries only failures that waiting can fix', () => {
    expect(isRetryable(err('network'))).toBe(true)
    expect(isRetryable(err('rate_limited', 429))).toBe(true)
    expect(isRetryable(err('http', 503))).toBe(true)
    expect(isRetryable(err('http', 408))).toBe(true)
    expect(isRetryable(err('http', 400))).toBe(false)
    expect(isRetryable(err('http', 404))).toBe(false)
    expect(isRetryable(err('tool_use_failed', 400))).toBe(false)
    expect(isRetryable(err('aborted'))).toBe(false)
    expect(isRetryable(err('bad_response'))).toBe(false)
    expect(isRetryable(new Error('plain'))).toBe(false)
  })
})

describe('backoffDelay', () => {
  it('doubles per retry, is capped, and scales by the random factor (full jitter)', () => {
    const one = () => 1
    expect([0, 1, 2, 3, 4].map(n => backoffDelay(n, DEFAULT_RETRY, one))).toEqual([250, 500, 1000, 2000, 2000])
    expect(backoffDelay(1, DEFAULT_RETRY, () => 0.5)).toBe(250)
  })
})

describe('withRetry', () => {
  it('succeeds after a transient 503, reporting the retry', async () => {
    const model = scriptedModel([{ error: err('http', 503) }, { text: 'ok' }])
    const retries: number[] = []
    const res = await withRetry(model, DEFAULT_RETRY, { sleep: noSleep, random: () => 1, onRetry: i => retries.push(i.delayMs) })(req())
    expect(res.step.text).toBe('ok')
    expect(model.requests).toHaveLength(2)
    expect(retries).toEqual([250])
  })

  it('does not retry a permanent error: 404 model_not_found fails on the first call', async () => {
    const model = scriptedModel([{ error: err('http', 404) }, { text: 'never' }])
    await expect(withRetry(model, DEFAULT_RETRY, { sleep: noSleep })(req())).rejects.toMatchObject({ kind: 'http', status: 404 })
    expect(model.requests).toHaveLength(1)
  })

  it('gives up after maxRetries and throws the last error', async () => {
    const model = scriptedModel([{ error: err('network') }, { error: err('network') }, { error: err('http', 502) }, { text: 'never' }])
    await expect(withRetry(model, DEFAULT_RETRY, { sleep: noSleep })(req())).rejects.toMatchObject({ status: 502 })
    expect(model.requests).toHaveLength(3)
  })

  it('stops waiting when the run is aborted during backoff, without another call', async () => {
    const model = scriptedModel([{ error: err('http', 503) }, { text: 'never' }])
    const ac = new AbortController()
    setTimeout(() => ac.abort(), 20)
    const started = Date.now()
    await expect(withRetry(model, { maxRetries: 2, baseDelayMs: 5000, maxDelayMs: 5000 }, { random: () => 1 })(req(ac.signal)))
      .rejects.toMatchObject({ kind: 'aborted' })
    expect(Date.now() - started).toBeLessThan(1000)
    expect(model.requests).toHaveLength(1)
  })
})

describe('withRetry: provider wait hints (429 retry-after)', () => {
  const limited = (ms: number) => new ModelCallError('rate_limited', 'TPM', 429, ms)

  it('waits what the provider asked (plus a little jitter) instead of the short backoff', async () => {
    const waits: number[] = []
    const model = scriptedModel([{ error: limited(1500) }, { text: 'ok' }])
    const res = await withRetry(model, DEFAULT_RETRY, { sleep: async ms => { waits.push(ms) }, random: () => 0.5 })(req())
    expect(res.step.text).toBe('ok')
    expect(waits).toEqual([1500 + 125])
  })

  it('gives up at once when the asked wait exceeds what the budget allows', async () => {
    const model = scriptedModel([{ error: limited(30_000) }, { text: 'never reached' }])
    await expect(withRetry(model, DEFAULT_RETRY, { sleep: noSleep })(req())).rejects.toMatchObject({ kind: 'rate_limited', retryAfterMs: 30_000 })
    expect(model.requests).toHaveLength(1)
  })

  it('ignores hints when the policy has no maxRetryAfterMs', async () => {
    const waits: number[] = []
    const model = scriptedModel([{ error: limited(30_000) }, { text: 'ok' }])
    const policy = { maxRetries: 2, baseDelayMs: 250, maxDelayMs: 2000 }
    await withRetry(model, policy, { sleep: async ms => { waits.push(ms) }, random: () => 1 })(req())
    expect(waits).toEqual([250])
  })
})
