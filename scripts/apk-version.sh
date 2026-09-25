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

shallow="$(git -C "$REPO" rev-parse --is-shallow-repository)"
[ "$shallow" = "false" ] || die "repo is a shallow clone; versionCode (commit count) would be wrong - fetch full history first (git fetch --unshallow, or checkout with fetch-depth: 0)"

code="$(git -C "$REPO" rev-list --count HEAD)"
base="$(node -p "require('$APP_JSON').expo.version")"

# --match is a glob, not a strict semver check: it exists so that when a
# release tag (vX.Y.Z) and a prerelease tag (vX.Y.Z-rcN) both sit on HEAD,
# describe has only the release-shaped one to pick. If nothing matches it,
# fall back to a bare 'v*' lookup so a malformed tag (e.g. v0.2) still gets
# reported below instead of silently building a dev version.
tag="$(git -C "$REPO" describe --tags --exact-match --match 'v[0-9]*.[0-9]*.[0-9]*' HEAD 2>/dev/null || true)"
[ -n "$tag" ] || tag="$(git -C "$REPO" describe --tags --exact-match --match 'v*' HEAD 2>/dev/null || true)"
if [ -n "$tag" ]; then
    name="${tag#v}"
    [[ "$name" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || die "tag $tag is not vX.Y.Z"
    [ "$name" = "$base" ] || die "tag $tag but app.json version is $base; bump app.json first"
else
    name="$base-dev.$code"
fi

echo "$name $code"
