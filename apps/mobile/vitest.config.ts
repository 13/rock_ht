import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// Plain-Node tests for app logic that doesn't touch native modules (providers, hooks rendered with
// react-test-renderer). Anything importing react-native / expo-* must be mocked in the test.
export default defineConfig({
  esbuild: { jsx: "automatic" },
  test: {
    globals: false,
    environment: "node",
    include: ["**/__tests__/**/*.test.{ts,tsx}"],
    exclude: ["node_modules/**", "android/**", "ios/**"],
  },
  // Same `@/` alias as tsconfig.json's paths, so modules under test can import app code.
  resolve: { alias: { "@": fileURLToPath(new URL(".", import.meta.url).href) } },
});
