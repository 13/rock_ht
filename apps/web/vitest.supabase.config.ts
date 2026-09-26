import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

// Integration tests for supabase/migrations against a LOCAL Supabase stack (never a hosted project).
// From the repo root: `npm run db:start && npx supabase db reset`, then
// `npm run test:supabase --workspace=apps/web`, then `npm run db:stop`.
export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    include: ['**/__tests__/**/*.supabase.test.ts'],
    exclude: ['**/node_modules/**', '.next/**'],
    fileParallelism: false,
    testTimeout: 20_000,
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('.', import.meta.url)),
    },
  },
})
