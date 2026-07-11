import type { ReactNode } from "react";
import { SupabaseProvider } from "./supabase-provider";
import { QueryProvider } from "./query-provider";

export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <SupabaseProvider>
      <QueryProvider>{children}</QueryProvider>
    </SupabaseProvider>
  );
}
