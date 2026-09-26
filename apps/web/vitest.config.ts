import { configDefaults, defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    // Route-handler / lib tests live next to their code in `__tests__/*.test.ts`,
    // mirroring the packages/* convention (src/__tests__).
    include: ['**/__tests__/**/*.test.ts'],
    // `*.int.test.ts` need a real Postgres: `npm run test:int` (vitest.int.config.ts).
    exclude: [...configDefaults.exclude, '**/*.int.test.ts'],
  },
  resolve: {
    alias: {
      // Mirrors the `@/*` -> `./*` path alias from tsconfig.json.
      '@': fileURLToPath(new URL('.', import.meta.url)),
    },
  },
})
