#!/usr/bin/env node
/**
 * Generates Expo Router's typed-routes declaration file (.expo/types/router.d.ts)
 * without starting a Metro/dev server.
 *
 * Expo Router (SDK 55) normally regenerates this file as a side effect of
 * `expo start`, via `@expo/router-server`'s typed-routes generator, which is
 * driven by a Metro file watcher. There is no dedicated `expo` CLI subcommand
 * for this (checked `npx expo --help` / `expo customize --help`), so this
 * script calls the same generator function directly:
 *
 *   @expo/router-server/build/typed-routes/generate.js -> getTypedRoutesDeclarationFile(ctx, options)
 *
 * It builds the same file-system-only `ctx` (via expo-router's
 * `requireContext` ponyfill, which just walks the `app/` directory listing
 * filenames -- it never imports/executes route files) that the dev server
 * uses, and writes the result to .expo/types/router.d.ts itself, avoiding
 * the debounced fire-and-forget write in `regenerateDeclarations`.
 *
 * Requires NODE_PATH=./node_modules (see package.json scripts) because
 * expo-router is installed in apps/mobile/node_modules while @expo/router-server
 * is hoisted under expo's own node_modules, and needs to resolve expo-router's
 * internal modules from apps/mobile/node_modules.
 *
 * Fallback if this breaks: run `npx expo start --offline` once to let Expo write .expo/types/router.d.ts.
 */
const fs = require("node:fs");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
const appRoot = path.join(projectRoot, "app");
const typesDirectory = path.join(projectRoot, ".expo", "types");

process.env.EXPO_ROUTER_APP_ROOT = appRoot;

let requireContext, EXPO_ROUTER_CTX_IGNORE, getTypedRoutesDeclarationFile;

try {
  ({ requireContext } = require("expo-router/internal/testing"));
  ({ EXPO_ROUTER_CTX_IGNORE } = require("expo-router/_ctx-shared"));

  // `@expo/router-server` is not hoisted to a resolvable location from
  // apps/mobile (it lives under expo's own nested node_modules), so resolve it
  // relative to the `@expo/cli` package that ships inside the installed `expo`
  // package, the same way `expo start` loads it internally.
  const expoCliDir = path.dirname(
    require.resolve("@expo/cli/package.json", {
      paths: [path.dirname(require.resolve("expo/package.json"))],
    })
  );
  ({ getTypedRoutesDeclarationFile } = require(
    require.resolve("@expo/router-server/build/typed-routes/generate", { paths: [expoCliDir] })
  ));
} catch (err) {
  console.error(
    "typegen: Expo Router's internal typed-routes generator could not be loaded (Expo SDK upgrade?). " +
    "Update apps/mobile/scripts/typegen.js, or fall back to running `npx expo start --offline` " +
    "until .expo/types/router.d.ts appears."
  );
  console.error("Error:", err.message);
  process.exit(1);
}

const ctx = requireContext(appRoot, true, EXPO_ROUTER_CTX_IGNORE);
const declarationFile = getTypedRoutesDeclarationFile(ctx, {});

if (typeof declarationFile !== "string" || !declarationFile.includes("declare module 'expo-router'")) {
  console.error("typegen: generator returned unexpected output; refusing to write router.d.ts");
  process.exit(1);
}

fs.mkdirSync(typesDirectory, { recursive: true });
fs.writeFileSync(path.join(typesDirectory, "router.d.ts"), declarationFile);

console.log(`typegen: wrote ${path.relative(projectRoot, path.join(typesDirectory, "router.d.ts"))}`);
