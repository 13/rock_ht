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
