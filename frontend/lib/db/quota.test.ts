import { describe, it, expect, beforeAll } from 'vitest'
import { createTestDb, USER_A as A, USER_B as B } from '@/test/pglite'

// 8.4: consume_quota() is the server-side rate limit (migration 20261003090000).
let t: Awaited<ReturnType<typeof createTestDb>>
beforeAll(async () => { t = await createTestDb() })

const consume = (bucket: string, max: number, windowS = 3600) =>
  t.rows('select public.consume_quota($1, $2, $3) as ok', [bucket, max, windowS]).then(r => (r[0] as { ok: boolean }).ok)

describe('consume_quota (8.4)', () => {
  it('allows up to max uses per user and bucket, then refuses', async () => {
    const got = await t.as(A, async () => [await consume('pipeline', 2), await consume('pipeline', 2), await consume('pipeline', 2)])
    expect(got).toEqual([true, true, false])
  })

  it('buckets and users are independent', async () => {
    expect(await t.as(A, () => consume('v1-ai', 1))).toBe(true)
    expect(await t.as(B, () => consume('pipeline', 2))).toBe(true)
  })

  it('anonymous callers cannot use it; nobody can read or write the table directly', async () => {
    await expect(t.as('anon', () => consume('pipeline', 5))).rejects.toThrow(/permission denied/)
    expect(await t.as(A, () => t.rows('select * from public.api_usage'))).toEqual([])
    await expect(t.as(A, () => t.rows(`insert into public.api_usage (user_id, bucket) values ('${A}', 'pipeline')`))).rejects.toThrow()
  })

  it('old uses fall out of the window', async () => {
    await t.rows(`update public.api_usage set at = now() - interval '2 hours' where user_id = '${A}' and bucket = 'pipeline'`)
    expect(await t.as(A, () => consume('pipeline', 2))).toBe(true)
  })
})
