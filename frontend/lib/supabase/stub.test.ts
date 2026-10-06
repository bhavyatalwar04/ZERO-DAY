import { describe, it, expect } from 'vitest'
import { createStubClient } from './stub'

describe('createStubClient (no Supabase configured)', () => {
  const db = createStubClient()

  it('resolves a chained list query to an empty list', async () => {
    const res = await db.from('sessions').select('id').eq('status', 'completed').order('started_at', { ascending: false }).limit(100)
    expect(res).toEqual({ data: [], error: null })
  })

  it('resolves single-row queries to null', async () => {
    expect(await db.from('sessions').select('id').eq('id', 'x').maybeSingle()).toEqual({ data: null, error: null })
    expect(await db.from('sessions').select('id').single()).toEqual({ data: null, error: null })
  })

  it('resolves writes to null data', async () => {
    expect(await db.from('session_actions').insert([{ seq: 1 }])).toEqual({ data: null, error: null })
    expect(await db.from('sessions').update({ status: 'x' }).eq('id', 'x')).toEqual({ data: null, error: null })
  })

  it('reports rpc calls as unavailable instead of throwing', async () => {
    const res = await db.rpc('consume_quota', {})
    expect(res.data).toBeNull()
    expect(res.error?.message).toMatch(/not configured/i)
  })

  it('has no signed-in user', async () => {
    expect(await db.auth.getUser()).toEqual({ data: { user: null }, error: null })
  })
})
