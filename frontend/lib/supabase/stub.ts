// ============================================================================
// The stand-in Supabase client used when no real project is configured (local
// dev, NEXT_PUBLIC_DEMO_MODE). Shared by lib/supabase/client.ts and server.ts.
//
// Queries are chainable like the real query builder (.select().eq().order()
// .limit() …) and resolve to "nothing stored": [] for lists, null for single
// rows and writes. The old stub only had a bare select(), so any chained query
// (e.g. /progress) crashed with "order is not a function".
// ============================================================================

const LIST_RESULT = { data: [], error: null }
const NULL_RESULT = { data: null, error: null }

/** Builder methods that narrow or shape a query; each returns the same builder. */
const CHAIN_METHODS = [
  'select', 'eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'like', 'ilike', 'is', 'in',
  'contains', 'match', 'not', 'or', 'filter', 'order', 'limit', 'range',
] as const

function query(result: { data: unknown; error: null }) {
  const builder: Record<string, unknown> = {
    maybeSingle: () => Promise.resolve(NULL_RESULT),
    single: () => Promise.resolve(NULL_RESULT),
    // Awaiting the builder runs the query, as with supabase-js.
    then: (onFulfilled?: (v: unknown) => unknown, onRejected?: (e: unknown) => unknown) =>
      Promise.resolve(result).then(onFulfilled, onRejected),
  }
  for (const method of CHAIN_METHODS) builder[method] = () => builder
  return builder
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createStubClient(): any {
  return {
    auth: {
      getUser: async () => ({ data: { user: null }, error: null }),
      getSession: async () => ({ data: { session: null }, error: null }),
      signOut: async () => ({ error: null }),
      signInWithPassword: async () => ({ data: null, error: { message: 'Supabase not configured' } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
    },
    from: () => ({
      select: () => query(LIST_RESULT),
      insert: () => query(NULL_RESULT),
      update: () => query(NULL_RESULT),
      delete: () => query(NULL_RESULT),
      upsert: () => query(NULL_RESULT),
    }),
    rpc: async () => ({ data: null, error: { message: 'Supabase not configured' } }),
  }
}
