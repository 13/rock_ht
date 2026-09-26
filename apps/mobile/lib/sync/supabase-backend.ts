import type { SyncBackend } from "./remote-factory";

/** Replaced by the Supabase remote in Task 15. */
export async function supabaseBackend(_url: string, _anonKey: string): Promise<SyncBackend> {
  throw new Error("Supabase sync arrives in a later version. Use a self-hosted server for now.");
}
