# APK Release Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every release APK, local or CI-built, carry a version that increases with each build, get smaller through R8, and be signed with the release key. These are roadmap items #5–#7 in `2026-09-25-improvement-roadmap.md`.

**Architecture:** `scripts/build-apk.sh` becomes the only way to build a release APK. CI calls it instead of running `gradlew assembleRelease` itself, so signing, the ABI choice, versioning, the cert check and the file name are defined in one place. A new `scripts/apk-version.sh` derives `versionName` and `versionCode` from git: the commit count for the code, and the `v*` tag (or the `app.json` version plus `-dev.N`) for the name. Gradle reads them as `-P` properties.

**Tech Stack:** Bash, Gradle (Android Gradle Plugin), R8, `apksigner`/`aapt2` from the Android build-tools, GitHub Actions.

## Global Constraints

- The release cert stays the Apex Maps key: SHA-256 `ef46d303232d7394d83b42f117e2c81f1ca5fe7399a22d0ac0d7dda19a60b8f3`. The phone `RZCXA1ZEXJE` already has an APK signed with it, and a different key forces an uninstall that loses the local SQLite data.
- `versionCode` must strictly increase between the builds a user installs. `git rev-list --count HEAD` provides that on `main`. Builds from other branches may collide, which is acceptable because they are never released.
- A tag build requires the tag version to equal `apps/mobile/app.json` `expo.version`. A mismatch fails the build.
- Release ABI: `arm64-v8a` only. This is already the default in `build-apk.sh`. `gradle.properties` keeps all four ABIs for dev builds.
- No keystore, password or base64 blob is ever committed, echoed or written anywhere except `$RUNNER_TEMP` in CI.
- `android/` is committed (bare workflow). Don't run `expo prebuild --clean`: it would overwrite the `build.gradle` edits.
- Commit messages end with:
  `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`
  `Claude-Session: https://claude.ai/code/session_01XD64vPnTySw8Fk82cmxSNs`

## File structure

| File | Responsibility |
|---|---|
| `scripts/apk-version.sh` (new) | Print `<versionName> <versionCode>` for a repo checkout. Pure: reads git and `app.json`, nothing else. |
| `scripts/test-apk-version.sh` (new) | Self-contained bash test of `apk-version.sh` against temporary git repos. |
| `scripts/build-apk.sh` | Pass the version to gradle; verify it and the cert in the output; find the JDK on CI runners. |
| `apps/mobile/android/app/build.gradle` | Read `rockVersionCode`/`rockVersionName` properties. |
| `apps/mobile/android/gradle.properties` | Turn on R8 minify and shrinkResources. |
| `apps/mobile/android/app/proguard-rules.pro` | Keep rules, only if the on-device smoke test finds R8 breakage. |
| `apps/mobile/app.json` | `version` → `0.2.0`, to match the existing `v0.2.0` tag. |
| `.github/workflows/android-apk.yml` | Gate on the signing secrets, decode the keystore, call `build-apk.sh`. |

---

### Task 1: Versions derived from git

**Files:**
- Create: `scripts/apk-version.sh`
- Create: `scripts/test-apk-version.sh`
- Modify: `apps/mobile/android/app/build.gradle:95-96`
- Modify: `scripts/build-apk.sh` (build and sign sections)
- Modify: `apps/mobile/app.json:5`

**Interfaces:**
- Produces: `scripts/apk-version.sh [REPO_DIR]` prints one line `"<versionName> <versionCode>"` to stdout and exits 0. It exits 1 with a message on stderr if the tag isn't `vX.Y.Z` or disagrees with `app.json`. `REPO_DIR` defaults to the repo containing the script.
- Produces: gradle properties `rockVersionName` (string) and `rockVersionCode` (integer), read by `build.gradle`.
- Produces: output file name `dist/rock_ht-<versionName>-<shortSha>-release.apk` (Task 3's CI globs `dist/*.apk`).

- [ ] **Step 1: Write the failing test**

`scripts/test-apk-version.sh`:

```bash
#!/usr/bin/env bash
# Tests scripts/apk-version.sh against throwaway git repos.
set -euo pipefail

SCRIPT="$(builtin cd "$(dirname "$0")" && pwd)/apk-version.sh"
fails=0

mkrepo() {  # mkrepo <app.json version> <commit count>
    local dir; dir="$(mktemp -d)"
    git -C "$dir" init -q
    git -C "$dir" config user.email t@t
    git -C "$dir" config user.name t
    mkdir -p "$dir/apps/mobile"
    printf '{ "expo": { "version": "%s" } }\n' "$1" > "$dir/apps/mobile/app.json"
    git -C "$dir" add -A
    git -C "$dir" commit -qm c1
    local i
    for ((i = 2; i <= $2; i++)); do git -C "$dir" commit -q --allow-empty -m "c$i"; done
    echo "$dir"
}

expect() {  # expect <name> <expected stdout> <repo>
    local got
    got="$("$SCRIPT" "$3" 2>/dev/null)" || got="<exit $?>"
    if [ "$got" = "$2" ]; then echo "ok   $1"; else echo "FAIL $1: got '$got', want '$2'"; fails=$((fails + 1)); fi
}

r="$(mkrepo 0.2.0 3)"
expect "untagged uses app.json version + dev.<count>" "0.2.0-dev.3 3" "$r"

r="$(mkrepo 0.2.0 5)"; git -C "$r" tag v0.2.0
expect "tag on HEAD gives plain version" "0.2.0 5" "$r"

r="$(mkrepo 0.2.0 4)"; git -C "$r" tag v0.2.0 HEAD~1
expect "tag behind HEAD counts as untagged" "0.2.0-dev.4 4" "$r"

r="$(mkrepo 0.2.0 2)"; git -C "$r" tag v0.3.0
expect "tag disagreeing with app.json fails" "<exit 1>" "$r"

r="$(mkrepo 0.2.0 2)"; git -C "$r" tag v0.2
expect "non-semver tag fails" "<exit 1>" "$r"

[ "$fails" = 0 ] || { echo "$fails failed"; exit 1; }
echo "all passed"
```

Run `chmod +x scripts/test-apk-version.sh`.

- [ ] **Step 2: Run the test to verify it fails**

Run: `scripts/test-apk-version.sh`
Expected: all 5 lines `FAIL … got '<exit 127>'` (script missing), exit 1.

- [ ] **Step 3: Write `scripts/apk-version.sh`**

```bash
#!/usr/bin/env bash
# Print "<versionName> <versionCode>" for the Android build.
#
# versionCode = number of commits on HEAD, so it grows with every build on
# main and a newer APK always installs over an older one.
# versionName = X.Y.Z when HEAD carries the tag vX.Y.Z (must equal
# apps/mobile/app.json expo.version), otherwise <app.json version>-dev.<code>.
set -euo pipefail

die() { echo "apk-version: $*" >&2; exit 1; }

REPO="${1:-$(builtin cd "$(dirname "$0")/.." && pwd)}"
APP_JSON="$REPO/apps/mobile/app.json"
[ -f "$APP_JSON" ] || die "missing $APP_JSON"

code="$(git -C "$REPO" rev-list --count HEAD)"
base="$(node -p "require('$APP_JSON').expo.version")"

tag="$(git -C "$REPO" describe --tags --exact-match --match 'v*' HEAD 2>/dev/null || true)"
if [ -n "$tag" ]; then
    name="${tag#v}"
    [[ "$name" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || die "tag $tag is not vX.Y.Z"
    [ "$name" = "$base" ] || die "tag $tag but app.json version is $base; bump app.json first"
else
    name="$base-dev.$code"
fi

echo "$name $code"
```

Run `chmod +x scripts/apk-version.sh`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `scripts/test-apk-version.sh`
Expected: 5 `ok` lines, then `all passed`, exit 0.

- [ ] **Step 5: Read the properties in gradle**

In `apps/mobile/android/app/build.gradle`, replace:

```groovy
        versionCode 1
        versionName "1.0.0"
```

with:

```groovy
        // Set by scripts/build-apk.sh from scripts/apk-version.sh
        versionCode((findProperty('rockVersionCode') ?: '1').toInteger())
        versionName(findProperty('rockVersionName') ?: '0.0.0-dev')
```

- [ ] **Step 6: Align `app.json` with the existing tag**

In `apps/mobile/app.json`, change `"version": "1.0.0"` to `"version": "0.2.0"`.

- [ ] **Step 7: Wire the version into `build-apk.sh`**

In `scripts/build-apk.sh`, directly after the `gradle_args=( … )` array and its `[ "$abi" = "all" ] || …` line, add:

```bash
read -r VERSION_NAME VERSION_CODE < <("$ROOT/scripts/apk-version.sh" "$ROOT") \
    || die "cannot derive version (see apk-version.sh error above)"
gradle_args+=("-ProckVersionName=$VERSION_NAME" "-ProckVersionCode=$VERSION_CODE")
```

Change the build banner line to:

```bash
echo "== assembleRelease (abi: $abi, version: $VERSION_NAME / $VERSION_CODE)"
```

In the sign section, replace:

```bash
VERSION="$(node -p "require('$MOBILE/app.json').expo.version")"
SHA="$(git -C "$ROOT" rev-parse --short HEAD)"
mkdir -p "$DIST"
OUT="$DIST/rock_ht-$VERSION-$SHA-release.apk"
```

with:

```bash
SHA="$(git -C "$ROOT" rev-parse --short HEAD)"
mkdir -p "$DIST"
OUT="$DIST/rock_ht-$VERSION_NAME-$SHA-release.apk"
```

After the cert check (`[ "$cert" = "$EXPECTED_CERT" ] || die …`), add:

```bash
AAPT2="$(find "$SDK/build-tools" -name aapt2 | sort -V | tail -1)"
[ -n "$AAPT2" ] || die "no aapt2 under $SDK/build-tools"
badging="$("$AAPT2" dump badging "$OUT" | head -1)"
grep -q "versionCode='$VERSION_CODE' versionName='$VERSION_NAME'" <<<"$badging" \
    || die "APK version mismatch: $badging"
```

Then change the final `echo "built …"` line to include the version:

```bash
echo "built $OUT ($(du -h "$OUT" | cut -f1), $VERSION_NAME/$VERSION_CODE, cert ${cert:0:8}…${cert: -4})"
```

Update the header comment's `Output:` line to `dist/rock_ht-<versionName>-<gitShortSha>-release.apk`.

- [ ] **Step 8: Build and check the version end to end**

Run: `scripts/build-apk.sh`
Expected: the last line is `built …/dist/rock_ht-0.2.0-dev.<N>-<sha>-release.apk (…, 0.2.0-dev.<N>/<N>, cert ef46d303…b8f3)`. `<N>` is `git rev-list --count HEAD`. The build is dirty (uncommitted), so the SHA is the parent's, which is fine here.

- [ ] **Step 9: Install over the existing app**

Run: `scripts/build-apk.sh --install RZCXA1ZEXJE`
Expected: `installed on RZCXA1ZEXJE`, with no `INSTALL_FAILED_VERSION_DOWNGRADE`. The app opens with the existing habits still there. Then run `adb -s RZCXA1ZEXJE shell dumpsys package app.rockht.mobile | grep -E 'versionCode|versionName'`, which should show the new code and name.

- [ ] **Step 10: Commit**

```bash
git add scripts/apk-version.sh scripts/test-apk-version.sh scripts/build-apk.sh \
        apps/mobile/android/app/build.gradle apps/mobile/app.json
git commit -m "build(mobile): derive APK versionCode and versionName from git"
```

---

### Task 2: R8 minify and resource shrinking

**Files:**
- Modify: `apps/mobile/android/gradle.properties`
- Modify (only if Step 4 finds breakage): `apps/mobile/android/app/proguard-rules.pro`

**Interfaces:**
- Consumes: `scripts/build-apk.sh` from Task 1 (prints the size and version).
- Produces: none for other tasks. CI picks the change up because it uses the same gradle files.

- [ ] **Step 1: Record the baseline size**

Run: `ls -l dist/*.apk | tail -1`. Note the size of the Task 1 APK (about 48 MB), so it can go in the commit message.

- [ ] **Step 2: Turn on R8 and shrinkResources**

Append to `apps/mobile/android/gradle.properties`:

```properties

# R8 code shrinking/obfuscation and resource shrinking for release builds
# (read by app/build.gradle). Keep rules: app/proguard-rules.pro.
android.enableMinifyInReleaseBuilds=true
android.enableShrinkResourcesInReleaseBuilds=true
```

- [ ] **Step 3: Build and install**

Run: `scripts/build-apk.sh --clean --install RZCXA1ZEXJE`
Expected: `built …` with a smaller size than Step 1, then `installed on RZCXA1ZEXJE`. If R8 fails the build with `Missing class …` errors, gradle writes `app/build/outputs/mapping/release/missing_rules.txt`. Copy its `-dontwarn` lines into `proguard-rules.pro` under `# Add any project specific keep options here:` and rebuild.

- [ ] **Step 4: On-device smoke test (R8 breaks things only at runtime)**

Clear old crash logs first: `adb -s RZCXA1ZEXJE logcat -c`. Then go through each check on the phone:

1. Cold start: the app opens to Today with no red screen and the existing habits listed. This covers expo-sqlite and the local store.
2. Create a habit with an icon, a colour and a reminder time. It appears on Today. This covers the icon font, the forms and expo-notifications scheduling.
3. Swipe or tap to complete it. The progress ring moves and the streak shows 1. This covers reanimated and gesture-handler.
4. Open Analytics. The heatmap and charts render (svg).
5. Write a journal entry and reopen it.
6. Settings: export the JSON backup (share sheet opens), then import it back. This covers expo-file-system, expo-sharing and document-picker.
7. Switch the theme to Midnight, force-stop the app and reopen it. The theme persists.
8. Set a reminder 1–2 minutes ahead and wait for the notification.

Then run: `adb -s RZCXA1ZEXJE logcat -d -b crash` and `adb -s RZCXA1ZEXJE logcat -d | grep -E "ClassNotFound|NoSuchMethod|NoSuchField|ReactNativeJS.*Error"`
Expected: no output from either.

If a check fails, find the class named in the logcat error. Add a keep rule for its package under `# Add any project specific keep options here:` in `apps/mobile/android/app/proguard-rules.pro`, for example:

```proguard
-keep class expo.modules.sqlite.** { *; }
```

Rebuild (Step 3) and repeat the whole checklist.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/android/gradle.properties apps/mobile/android/app/proguard-rules.pro
git commit -m "build(mobile): enable R8 and resource shrinking for release APKs

Release APK (arm64-v8a): <before> MB -> <after> MB. On-device smoke test
on RZCXA1ZEXJE passed (store, notifications, gestures, charts, backup)."
```

(Fill in the two measured sizes. Leave `proguard-rules.pro` out of `git add` if it didn't change.)

---

### Task 3: CI builds through `build-apk.sh` with the release key

**Files:**
- Modify: `scripts/build-apk.sh` (toolchain section)
- Modify: `.github/workflows/android-apk.yml`

**Interfaces:**
- Consumes: `scripts/apk-version.sh`, `scripts/test-apk-version.sh` and the `dist/rock_ht-<versionName>-<sha>-release.apk` name from Task 1.
- Consumes: repository secrets `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASS`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASS`. The user sets these in Step 4.

- [ ] **Step 1: Make `build-apk.sh` find the runner's JDK**

GitHub's `ubuntu-latest` has JDK 17 at `$JAVA_HOME_17_X64` (`/usr/lib/jvm/temurin-17-jdk-amd64`). The script only looks under `~/.gradle/jdks` and `/usr/lib/jvm/java-17*`. Also, `gradle.properties` pins `org.gradle.java.home=/usr/lib/jvm/java-21-openjdk`, which doesn't exist on the runner.

In `scripts/build-apk.sh`, replace the JDK loop:

```bash
for d in "$HOME"/.gradle/jdks/jdk-17* /usr/lib/jvm/java-17*; do
    [ -x "$d/bin/java" ] && { JDK17="$d"; break; }
done
```

with:

```bash
# JAVA_HOME_17_X64 is set on GitHub-hosted runners
for d in "${JAVA_HOME_17_X64:-}" "$HOME"/.gradle/jdks/jdk-17* /usr/lib/jvm/java-17* /usr/lib/jvm/temurin-17*; do
    [ -n "$d" ] && [ -x "$d/bin/java" ] && { JDK17="$d"; break; }
done
```

Directly after the `gradle_args=( … )` array, add:

```bash
# gradle.properties pins org.gradle.java.home to a local JDK 21; where that
# path doesn't exist (CI) run the Gradle daemon on the JDK 17 found above
pinned="$(sed -n 's/^org\.gradle\.java\.home=//p' "$ANDROID_DIR/gradle.properties")"
if [ -n "$pinned" ] && [ ! -x "$pinned/bin/java" ]; then
    gradle_args+=("-Dorg.gradle.java.home=$JDK17")
fi
```

Check that local builds are unaffected: `scripts/build-apk.sh` still ends with `built …`.

- [ ] **Step 2: Rewrite the workflow**

Replace `.github/workflows/android-apk.yml` with:

```yaml
name: Android APK

on:
  push:
    tags: ["v*"]
  workflow_dispatch:

concurrency:
  group: android-apk-${{ github.ref }}
  cancel-in-progress: true

jobs:
  check-secrets:
    name: Check signing secrets
    runs-on: ubuntu-latest
    permissions: {}
    outputs:
      ready: ${{ steps.check.outputs.ready }}
    steps:
      - id: check
        env:
          KS: ${{ secrets.ANDROID_KEYSTORE_BASE64 }}
          PASS: ${{ secrets.ANDROID_KEYSTORE_PASS }}
          ALIAS: ${{ secrets.ANDROID_KEY_ALIAS }}
        run: |
          if [ -n "$KS" ] && [ -n "$PASS" ] && [ -n "$ALIAS" ]; then
            echo "ready=true" >> "$GITHUB_OUTPUT"
          else
            echo "ready=false" >> "$GITHUB_OUTPUT"
            echo "::notice title=Android APK skipped::Set ANDROID_KEYSTORE_BASE64, ANDROID_KEYSTORE_PASS and ANDROID_KEY_ALIAS (optional ANDROID_KEY_PASS) repository secrets to build a signed APK."
          fi

  build-apk:
    name: Build signed release APK
    needs: check-secrets
    if: needs.check-secrets.outputs.ready == 'true'
    runs-on: ubuntu-latest
    permissions:
      contents: write   # attach APK to the GitHub release
    env:
      NODE_ENV: production
      # Inlined into the JS bundle by Metro at build time
      EXPO_PUBLIC_SENTRY_DSN: ${{ secrets.EXPO_PUBLIC_SENTRY_DSN }}

    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0   # apk-version.sh counts commits and reads tags

      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm

      - uses: actions/setup-java@v4
        with:
          distribution: temurin
          java-version: 17

      - uses: gradle/actions/setup-gradle@v4

      - name: Install dependencies
        run: npm ci

      - name: Test version derivation
        run: scripts/test-apk-version.sh

      - name: Decode keystore
        env:
          KS: ${{ secrets.ANDROID_KEYSTORE_BASE64 }}
        run: |
          printf '%s' "$KS" | base64 -d > "$RUNNER_TEMP/release.keystore"
          chmod 600 "$RUNNER_TEMP/release.keystore"

      # build-apk.sh signs with apksigner and fails unless the APK carries
      # the expected release cert and the derived version
      - name: Build signed APK
        env:
          ANDROID_KEYSTORE: ${{ runner.temp }}/release.keystore
          ANDROID_KEYSTORE_PASS: ${{ secrets.ANDROID_KEYSTORE_PASS }}
          ANDROID_KEY_ALIAS: ${{ secrets.ANDROID_KEY_ALIAS }}
          ANDROID_KEY_PASS: ${{ secrets.ANDROID_KEY_PASS }}
        run: scripts/build-apk.sh

      - name: Locate APK
        id: apk
        run: |
          shopt -s nullglob
          files=(dist/rock_ht-*-release.apk)
          [ "${#files[@]}" = 1 ] || { echo "expected one APK, found: ${files[*]}"; exit 1; }
          echo "path=${files[0]}" >> "$GITHUB_OUTPUT"

      - uses: actions/upload-artifact@v4
        with:
          name: rock_ht-android-apk
          path: ${{ steps.apk.outputs.path }}
          if-no-files-found: error

      - name: Attach to GitHub release
        if: startsWith(github.ref, 'refs/tags/v')
        uses: softprops/action-gh-release@v2
        with:
          files: ${{ steps.apk.outputs.path }}
          generate_release_notes: true
```

Notes for the implementer. `NODE_PATH` is gone from the job env because `build-apk.sh` exports it itself. When `ANDROID_KEY_PASS` is an empty secret, the script falls back to the store password (`${ANDROID_KEY_PASS:-$ANDROID_KEYSTORE_PASS}`).

- [ ] **Step 3: Commit**

```bash
git add scripts/build-apk.sh .github/workflows/android-apk.yml
git commit -m "ci(mobile): build the release APK through build-apk.sh with the release key"
```

- [ ] **Step 4: USER ACTION: add the signing secrets**

This step uploads the Apex Maps release keystore to GitHub. After that, anyone with admin access to the repo or its Actions can sign APKs that phones accept as Apex Maps *and* rock updates. The user must decide this, and the user runs the commands. Never run them for the user.

The secrets go into the `release` GitHub Environment (both workflow jobs declare `environment: release`), not plain repo secrets, so `--env release` is required:

```bash
. ~/.config/apex-maps/signing.env
base64 -w0 "$ANDROID_KEYSTORE" | gh secret set ANDROID_KEYSTORE_BASE64 --env release
printf '%s' "$ANDROID_KEYSTORE_PASS" | gh secret set ANDROID_KEYSTORE_PASS --env release
printf '%s' "$ANDROID_KEY_ALIAS"     | gh secret set ANDROID_KEY_ALIAS --env release
printf '%s' "${ANDROID_KEY_PASS:-$ANDROID_KEYSTORE_PASS}" | gh secret set ANDROID_KEY_PASS --env release
```

In repo Settings → Environments → `release`, also restrict deployment branches and tags to `main` and `v*` so the signing secrets are never exposed to a workflow run from an arbitrary branch or PR.

If the user declines, the workflow skips itself with a notice and local `build-apk.sh` stays the release path. Tasks 1–2 still apply.

- [ ] **Step 5: Verify in CI**

Run: `git push && gh workflow run android-apk.yml --ref main && sleep 5 && gh run watch "$(gh run list --workflow android-apk.yml -L1 --json databaseId -q '.[0].databaseId')"`
Expected: both jobs are green, and the `Build signed APK` log ends with `built …/dist/rock_ht-0.2.0-dev.<N>-<sha>-release.apk (…, cert ef46d303…b8f3)`. Without secrets, `Build signed release APK` shows as skipped, with the notice on the run summary.

Then download the artifact and install it over the local build:
`gh run download -n rock_ht-android-apk -D /tmp/ci-apk && adb -s RZCXA1ZEXJE install -r /tmp/ci-apk/*.apk`
Expected: `Success`, because the cert and a versionCode ≥ the local build are the same.

---

## Self-review

- Roadmap #5 (signing): Task 3 signs CI output with the release key, verified by the cert check. Local builds already use it.
- Roadmap #6 (size): arm64-only release via the script default (CI inherits it in Task 3) plus R8 and shrinkResources (Task 2).
- Roadmap #7 (versions): Task 1. The `versionCode` rises for local and CI builds alike, and tag builds must match `app.json`.
- Out of scope, deliberately: ABI splits for other architectures (no users on 32-bit or x86), Play Store AAB upload, and Metro caching (#15).
- Releasing a new version: bump `app.json` `expo.version`, commit, then run `git tag vX.Y.Z && git push --tags`.
