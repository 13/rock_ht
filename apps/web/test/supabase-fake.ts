import { vi } from 'vitest'

/**
 * A reusable fake for the small slice of the Supabase query builder our
 * route handlers use (`from(table).update(values).eq(col, val)`,
 * `.select(cols).eq(col, val).single()`, ...). It records every chained
 * call so tests can assert *what* was written *where*, without hand-rolling
 * a bespoke chain mock per test.
 */

export interface RecordedCall {
  method: string
  args: unknown[]
}

export interface FakeQuery {
  table: string
  /** All chained calls on this query, in order, starting with the verb
   * that opened it (`select` | `update` | `upsert` | `insert` | `delete`). */
  calls: RecordedCall[]
}

export interface Resolvable {
  data: unknown
  error: unknown
}

export interface FakeSupabase {
  from: ReturnType<typeof vi.fn>
  /** Every query built via `from(...)`, in call order. */
  queries: FakeQuery[]
}

const defaultResult: Resolvable = { data: null, error: null }

/**
 * Creates a fake Supabase client exposing only `.from(table)`. Pass
 * `resolve` to control what a chain resolves to (both when awaited directly
 * and when terminated with `.single()`), based on the table name and the
 * calls recorded so far.
 */
export function createFakeSupabase(
  options: { resolve?: (query: FakeQuery) => Resolvable } = {}
): FakeSupabase {
  const queries: FakeQuery[] = []
  const resolve = options.resolve ?? (() => defaultResult)

  function makeChain(query: FakeQuery) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const chain: any = {
      eq: vi.fn((...args: unknown[]) => {
        query.calls.push({ method: 'eq', args })
        return chain
      }),
      select: vi.fn((...args: unknown[]) => {
        query.calls.push({ method: 'select', args })
        return chain
      }),
      order: vi.fn((...args: unknown[]) => {
        query.calls.push({ method: 'order', args })
        return chain
      }),
      single: vi.fn(() => {
        query.calls.push({ method: 'single', args: [] })
        return Promise.resolve(resolve(query))
      }),
      // Makes the chain awaitable, like the real PostgREST builder.
      // Deferred so `resolve(query)` sees every call made synchronously
      // before the `await`.
      then: (
        onFulfilled?: ((value: Resolvable) => unknown) | null,
        onRejected?: ((reason: unknown) => unknown) | null
      ) => Promise.resolve(resolve(query)).then(onFulfilled, onRejected),
    }
    return chain
  }

  function openQuery(table: string, method: string, args: unknown[]) {
    const query: FakeQuery = { table, calls: [{ method, args }] }
    queries.push(query)
    return makeChain(query)
  }

  const from = vi.fn((table: string) => ({
    select: vi.fn((...args: unknown[]) => openQuery(table, 'select', args)),
    update: vi.fn((...args: unknown[]) => openQuery(table, 'update', args)),
    upsert: vi.fn((...args: unknown[]) => openQuery(table, 'upsert', args)),
    insert: vi.fn((...args: unknown[]) => openQuery(table, 'insert', args)),
    delete: vi.fn(() => openQuery(table, 'delete', [])),
  }))

  return { from, queries }
}

/** The `update(values)` call that opened a query, if any. */
export function updateValues(query: FakeQuery): unknown {
  return query.calls[0]?.method === 'update' ? query.calls[0].args[0] : undefined
}

/** The args of every `.eq(...)` call on a query, in order. */
export function eqFilters(query: FakeQuery): unknown[][] {
  return query.calls.filter((c) => c.method === 'eq').map((c) => c.args)
}
