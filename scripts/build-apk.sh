#!/usr/bin/env bash
# Build a signed release APK of the rock mobile app, optionally install it.
#
# Output: dist/rock_ht-<versionName>-<gitShortSha>-release.apk
#
# Signs with the same release keystore as Apex Maps (MUH Studios cert), so
# phones carrying a script-built rock APK only accept updates signed with it;
# a debug-signed build fails with INSTALL_FAILED_UPDATE_INCOMPATIBLE.
#
# Releasing: set apps/mobile/app.json expo.version to X.Y.Z, commit, then
# `git tag vX.Y.Z && git push --tags`. Right after, bump app.json's version to
# the next minor (X.(Y+1).0) so later dev builds (…-dev.N) sort after this
# release instead of colliding with it.
set -euo pipefail

usage() {
    cat <<'EOF'
usage: scripts/build-apk.sh [options]

  --install [SERIAL]  adb install -r after building (SERIAL required when
                      more than one device is attached)
  --abi LIST          reactNativeArchitectures, comma separated
                      (default arm64-v8a; "all" = every ABI in gradle.properties)
  --clean             gradlew clean first
  -h, --help          this help

Release signing:
  ANDROID_KEYSTORE       path to .jks/.keystore
  ANDROID_KEYSTORE_PASS  store password
  ANDROID_KEY_ALIAS      key alias
  ANDROID_KEY_PASS       key password (defaults to store password)

Loaded from ~/.config/apex-maps/signing.env (override with ROCK_SIGNING_ENV)
when ANDROID_KEYSTORE is not already set. The signed APK's certificate must
match ROCK_EXPECTED_CERT_SHA256 (defaults to the Apex Maps release cert).
EOF
}

die() { echo "build-apk: $*" >&2; exit 1; }

ROOT="$(builtin cd "$(dirname "$0")/.." && pwd)"
MOBILE="$ROOT/apps/mobile"
ANDROID_DIR="$MOBILE/android"
DIST="$ROOT/dist"
EXPECTED_CERT="${ROCK_EXPECTED_CERT_SHA256:-ef46d303232d7394d83b42f117e2c81f1ca5fe7399a22d0ac0d7dda19a60b8f3}"

do_install=0 serial="" abi="arm64-v8a" do_clean=0
while [ $# -gt 0 ]; do
    case "$1" in
        --install)
            do_install=1
            if [ $# -ge 2 ] && [[ "$2" != --* ]]; then serial="$2"; shift; fi ;;
        --abi)             [ $# -ge 2 ] || die "--abi needs a value"; abi="$2"; shift ;;
        --clean)           do_clean=1 ;;
        -h|--help)         usage; exit 0 ;;
        *) die "unknown option: $1 (see --help)" ;;
    esac
    shift
done

# ---- signing ---------------------------------------------------------------
SIGN_ENV="${ROCK_SIGNING_ENV:-$HOME/.config/apex-maps/signing.env}"
if [ -z "${ANDROID_KEYSTORE:-}" ] && [ -f "$SIGN_ENV" ]; then
    # shellcheck disable=SC1090
    . "$SIGN_ENV"
fi
[ -n "${ANDROID_KEYSTORE:-}" ] || die "no keystore: set ANDROID_KEYSTORE or fill $SIGN_ENV"
[ "${ANDROID_KEYSTORE_PASS:-}" != "CHANGE_ME" ] || die "$SIGN_ENV still has placeholder passwords"
[ -f "$ANDROID_KEYSTORE" ] || die "keystore not found: $ANDROID_KEYSTORE"
[ -n "${ANDROID_KEYSTORE_PASS:-}" ] && [ -n "${ANDROID_KEY_ALIAS:-}" ] \
    || die "ANDROID_KEYSTORE_PASS and ANDROID_KEY_ALIAS must be set"
# apksigner reads passwords from the environment (env:VAR), keeping them out
# of the process list
export ANDROID_KEYSTORE_PASS
export ANDROID_KEY_PASS="${ANDROID_KEY_PASS:-$ANDROID_KEYSTORE_PASS}"

# ---- app env (optional; EXPO_PUBLIC_* is inlined into the JS bundle) --------
# The app needs no env to run. .env.local may set EXPO_PUBLIC_SENTRY_DSN.
if [ -f "$MOBILE/.env.local" ]; then
    set -a
    # shellcheck disable=SC1091
    . "$MOBILE/.env.local"
    set +a
fi

# Inlined into the JS bundle by Metro; shown under Settings → About
export EXPO_PUBLIC_BUILD_DATE="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
export EXPO_PUBLIC_GIT_SHA="$(git -C "$ROOT" rev-parse --short HEAD)$(git -C "$ROOT" diff --quiet HEAD -- || echo '+dirty')"
export EXPO_PUBLIC_UPDATE_REPO="${EXPO_PUBLIC_UPDATE_REPO:-13/rock_ht}"

# ---- toolchain -------------------------------------------------------------
# a stale ANDROID_HOME (e.g. root-owned /opt/android-sdk without accepted
# licenses) fails the NDK auto-install; fall back to the user SDK
SDK="${ANDROID_HOME:-$HOME/Android/Sdk}"
[ -d "$SDK/licenses" ] || SDK="$HOME/Android/Sdk"
[ -d "$SDK/licenses" ] || die "no Android SDK with accepted licenses (tried ANDROID_HOME and ~/Android/Sdk)"
export ANDROID_HOME="$SDK" ANDROID_SDK_ROOT="$SDK"

# @react-native/gradle-plugin requests a JDK 17 toolchain; without a local
# one Gradle's foojay 0.5.0 auto-download crashes on Gradle 9 (IBM_SEMERU)
JDK17=""
# JAVA_HOME_17_X64 is set on GitHub-hosted runners
for d in "${JAVA_HOME_17_X64:-}" "$HOME"/.gradle/jdks/jdk-17* /usr/lib/jvm/java-17* /usr/lib/jvm/temurin-17*; do
    [ -n "$d" ] && [ -x "$d/bin/java" ] && { JDK17="$d"; break; }
done
if [ -z "$JDK17" ]; then
    cat >&2 <<'EOF'
build-apk: no JDK 17 found. Install one, e.g.:
  cd ~/.gradle/jdks && curl -sSL -o t.tgz \
    https://api.adoptium.net/v3/binary/latest/17/ga/linux/x64/jdk/hotspot/normal/eclipse \
    && tar xzf t.tgz && rm t.tgz
EOF
    exit 1
fi

# the bundler resolves expo-router through NODE_PATH; it must be absolute
# because the bundle task runs from a different cwd
export NODE_PATH="$MOBILE/node_modules"
[ -d "$ROOT/node_modules" ] || (builtin cd "$ROOT" && npm ci)

# ---- build -----------------------------------------------------------------
gradle_args=(
    --console=plain
    "-Porg.gradle.java.installations.paths=$JDK17"
    -Porg.gradle.java.installations.auto-download=false
)
[ "$abi" = "all" ] || gradle_args+=("-PreactNativeArchitectures=$abi")

# gradle.properties pins org.gradle.java.home to a local JDK 21; where that
# path doesn't exist (CI) run the Gradle daemon on the JDK 17 found above
pinned="$(sed -n 's/^org\.gradle\.java\.home=//p' "$ANDROID_DIR/gradle.properties")"
if [ -n "$pinned" ] && [ ! -x "$pinned/bin/java" ]; then
    gradle_args+=("-Dorg.gradle.java.home=$JDK17")
fi

read -r VERSION_NAME VERSION_CODE < <("$ROOT/scripts/apk-version.sh" "$ROOT") \
    || die "cannot derive version (see apk-version.sh error above)"
gradle_args+=("-ProckVersionName=$VERSION_NAME" "-ProckVersionCode=$VERSION_CODE")

builtin cd "$ANDROID_DIR"
[ "$do_clean" = 1 ] && ./gradlew "${gradle_args[@]}" clean
echo "== assembleRelease (abi: $abi, version: $VERSION_NAME / $VERSION_CODE)"
./gradlew "${gradle_args[@]}" assembleRelease

UNSIGNED="$ANDROID_DIR/app/build/outputs/apk/release/app-release.apk"
[ -f "$UNSIGNED" ] || die "gradle produced no $UNSIGNED"

# ---- sign ------------------------------------------------------------------
APKSIGNER="$(find "$SDK/build-tools" -name apksigner | sort -V | tail -1)"
[ -n "$APKSIGNER" ] || die "no apksigner under $SDK/build-tools"

SHA="$(git -C "$ROOT" rev-parse --short HEAD)"
mkdir -p "$DIST"
OUT="$DIST/rock_ht-$VERSION_NAME-$SHA-release.apk"

# minSdk 24: v1 (JAR) signing is only read by Android 6 and older
echo "== signing"
"$APKSIGNER" sign --ks "$ANDROID_KEYSTORE" \
    --ks-pass env:ANDROID_KEYSTORE_PASS \
    --ks-key-alias "$ANDROID_KEY_ALIAS" \
    --key-pass env:ANDROID_KEY_PASS \
    --min-sdk-version 24 --v1-signing-enabled false \
    --out "$OUT" "$UNSIGNED" 2> >(grep -v '^WARNING' >&2)
rm -f "$OUT.idsig"

cert="$("$APKSIGNER" verify --print-certs "$OUT" 2>/dev/null \
        | sed -n 's/^Signer #1 certificate SHA-256 digest: //p')"
[ "$cert" = "$EXPECTED_CERT" ] \
    || die "signed with unexpected cert $cert (expected $EXPECTED_CERT)"

AAPT2="$(find "$SDK/build-tools" -name aapt2 | sort -V | tail -1)"
[ -n "$AAPT2" ] || die "no aapt2 under $SDK/build-tools"
# capture full output rather than piping to `head -1`: aapt2 writes many
# lines, and under `pipefail` a reader that stops early gives aapt2 SIGPIPE,
# which aborts the script even though the line we want was already produced
badging="$("$AAPT2" dump badging "$OUT")"
badging="${badging%%$'\n'*}"
grep -q "versionCode='$VERSION_CODE' versionName='$VERSION_NAME'" <<<"$badging" \
    || die "APK version mismatch: $badging"

echo "built $OUT ($(du -h "$OUT" | cut -f1), $VERSION_NAME/$VERSION_CODE, cert ${cert:0:8}…${cert: -4})"

# ---- install ---------------------------------------------------------------
[ "$do_install" = 1 ] || exit 0
adb_args=()
if [ -n "$serial" ]; then
    adb_args=(-s "$serial")
elif [ "$(adb devices | grep -c $'\tdevice$')" -gt 1 ]; then
    die "several devices attached - pass --install SERIAL"
fi
if ! log="$(adb "${adb_args[@]}" install -r "$OUT" 2>&1)"; then
    echo "$log" >&2
    if grep -q INSTALL_FAILED_UPDATE_INCOMPATIBLE <<<"$log"; then
        die "device has app.rockht.mobile signed with another key; uninstall it manually (loses app data)"
    fi
    die "adb install failed"
fi
echo "installed on ${serial:-default device}"
