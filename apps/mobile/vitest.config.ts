import { defineConfig } from "vitest/config";

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
});
