import { PGlite } from '@electric-sql/pglite'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

// TEST ONLY: a fresh PostgreSQL (PGlite) with the Supabase shim and every
// migration in supabase/migrations applied in order, plus helpers to act as
// a given role the way Supabase does.

const MIGRATIONS = fileURLToPath(new URL('../../supabase/migrations/', import.meta.url))
const SHIM = fileURLToPath(new URL('./supabase-shim.sql', import.meta.url))

export const USER_A = '00000000-0000-4000-8000-00000000000a'
export const USER_B = '00000000-0000-4000-8000-00000000000b'
export type Who = typeof USER_A | typeof USER_B | 'anon' | 'service'

export async function createTestDb() {
  const db = new PGlite()
  await db.exec(readFileSync(SHIM, 'utf8'))
  for (const file of readdirSync(MIGRATIONS).filter(f => f.endsWith('.sql')).sort()) {
    await db.exec(readFileSync(join(MIGRATIONS, file), 'utf8'))
  }
  await db.exec(`insert into auth.users (id) values ('${USER_A}'), ('${USER_B}')`)

  /** Runs `fn` as a role, with auth.uid() set the way Supabase sets it from the JWT. */
  async function as<T>(who: Who, fn: () => Promise<T>): Promise<T> {
    await db.exec('reset role')
    await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [who === 'anon' || who === 'service' ? '' : who])
    await db.exec(`set role ${who === 'anon' ? 'anon' : who === 'service' ? 'service_role' : 'authenticated'}`)
    try {
      return await fn()
    } finally {
      await db.exec('reset role')
    }
  }

  const rows = async (sql: string, params: unknown[] = []) => (await db.query(sql, params)).rows
  const affected = async (sql: string, params: unknown[] = []) => (await db.query(sql, params)).affectedRows ?? 0

  return { db, as, rows, affected }
}
