import { describe, it, expect } from 'vitest'
import { consumeQuota, QUOTAS, type RpcClient } from './quota'

const client = (reply: { data: unknown; error: { message: string } | null } | Error): RpcClient & { calls: unknown[] } => {
  const calls: unknown[] = []
  return { calls, rpc: async (_fn, args) => { calls.push(args); if (reply instanceof Error) throw reply; return reply } }
}

describe('consumeQuota', () => {
  it('passes the bucket limits to the database function', async () => {
    const c = client({ data: true, error: null })
    expect(await consumeQuota(c, 'pipeline')).toBe('ok')
    expect(c.calls[0]).toEqual({ p_bucket: 'pipeline', p_max: QUOTAS.pipeline.max, p_window_seconds: QUOTAS.pipeline.windowSeconds })
  })
  it('false from the database = exceeded', async () => {
    expect(await consumeQuota(client({ data: false, error: null }), 'v1-ai')).toBe('exceeded')
  })
  it('fails open when the check itself fails (migration missing, network)', async () => {
    expect(await consumeQuota(client({ data: null, error: { message: 'function consume_quota does not exist' } }), 'pipeline')).toBe('unavailable')
    expect(await consumeQuota(client(new Error('fetch failed')), 'pipeline')).toBe('unavailable')
  })
})
