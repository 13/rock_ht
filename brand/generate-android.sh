#!/usr/bin/env bash
# Writes launcher, splash and notification drawables into the committed android/ project.
set -euo pipefail
cd "$(dirname "$0")/.."
CUT=brand/build/rock-cut.png
RES=apps/mobile/android/app/src/main/res
BG='#0a0a0f'
[ -f "$CUT" ] || brand/generate.sh

# density:launcher_px:foreground_px:splash_logo_px:notification_px
for spec in mdpi:48:108:200:24 hdpi:72:162:300:36 xhdpi:96:216:400:48 xxhdpi:144:324:600:72 xxxhdpi:192:432:800:96; do
  IFS=: read -r d L F S N <<<"$spec"
  mkdir -p "$RES/mipmap-$d" "$RES/drawable-$d"
  inner=$((L * 84 / 100)); fg=$((F * 62 / 100))
  magick "$CUT" -resize "${inner}x${inner}" -background "$BG" -gravity center -extent "${L}x${L}" \
    -alpha remove -alpha off -quality 95 "$RES/mipmap-$d/ic_launcher.webp"
  magick -size "${L}x${L}" xc:none -fill "$BG" -draw "circle $((L/2)),$((L/2)) $((L/2)),0" \
    \( "$CUT" -resize "$((L*70/100))x$((L*70/100))" \) -gravity center -composite \
    -quality 95 "$RES/mipmap-$d/ic_launcher_round.webp"
  magick "$CUT" -resize "${fg}x${fg}" -background none -gravity center -extent "${F}x${F}" \
    -quality 95 "$RES/mipmap-$d/ic_launcher_foreground.webp"
  magick "$CUT" -resize "${S}x${S}" -background none -gravity center -extent "${S}x${S}" \
    "$RES/drawable-$d/splashscreen_logo.png"
  magick "$CUT" -alpha extract -threshold 50% -background black -alpha shape -fill white -colorize 100 \
    -resize "$((N*84/100))x$((N*84/100))" -background none -gravity center -extent "${N}x${N}" \
    "$RES/drawable-$d/notification_icon.png"
done
echo "android res generated"
