import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

// Integration tests against a real Postgres with db/selfhost/init/*.sql loaded.
// Run with DATABASE_URL set: `npm run test:int --workspace=apps/web` (see .github/workflows/test.yml).
export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    include: ['**/__tests__/**/*.int.test.ts'],
    exclude: ['**/node_modules/**', '.next/**'],
    // One shared database: keep files sequential.
    fileParallelism: false,
    testTimeout: 20_000,
    env: {
      BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET ?? 'test-secret-test-secret-test-secret-0123',
      BETTER_AUTH_URL: process.env.BETTER_AUTH_URL ?? 'http://localhost:3000',
    },
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('.', import.meta.url)),
    },
  },
})
