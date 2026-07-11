"use client";

import { QueryProvider } from "./query-provider";
import { SupabaseProvider } from "./supabase-provider";
import { ThemeProvider } from "./theme-provider";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider
      attribute="data-theme"
      defaultTheme="dark"
      enableSystem={false}
      themes={["light", "dark", "midnight", "forest", "sunset"]}
    >
      <SupabaseProvider>
        <QueryProvider>{children}</QueryProvider>
      </SupabaseProvider>
    </ThemeProvider>
  );
}
