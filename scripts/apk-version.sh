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
