import type { TypedSupabaseClient } from "../client";

export interface RecordedQuery {
  table: string;
  calls: Array<[method: string, ...args: unknown[]]>;
}

/**
 * A minimal stand-in for a supabase-js client: every `from()` starts a chain that records each
 * builder call and resolves (when awaited) to `{ data, error }` from `respond`.
 */
export function fakeClient(respond: (q: RecordedQuery) => { data: unknown; error: unknown } = () => ({
  data: [],
  error: null,
})) {
  const queries: RecordedQuery[] = [];
  const client = {
    from(table: string) {
      const q: RecordedQuery = { table, calls: [] };
      queries.push(q);
      const builder: Record<string, unknown> = new Proxy(
        {},
        {
          get(_t, prop: string) {
            if (prop === "then") {
              const result = respond(q);
              return (resolve: (v: unknown) => unknown) => resolve(result);
            }
            return (...args: unknown[]) => {
              q.calls.push([prop, ...args]);
              return builder;
            };
          },
        }
      );
      return builder;
    },
  };
  return { client: client as unknown as TypedSupabaseClient, queries };
}
