#!/usr/bin/env bash
# Regenerates every logo/icon derivative from brand/rock.png.
# Usage: brand/generate.sh   (needs ImageMagick 7: `magick`)
set -euo pipefail
cd "$(dirname "$0")/.."

SRC=brand/rock.png
CUT=brand/build/rock-cut.png
BG='#0a0a0f'
WEB=apps/web
MOB=apps/mobile/assets

mkdir -p brand/build "$WEB/public/icons" "$WEB/public/brand" "$MOB"

# Pick an installed sans font (names differ per distro); override with FONT=/FONT_BOLD= env.
font() { magick -list font | awk '/Font:/{print $2}' | grep -iE "$1" | head -1 || true; }
FONT_BOLD=${FONT_BOLD:-$(font '^(Inter|DejaVu-Sans|Adwaita-Sans|Liberation-Sans|Noto-Sans)-Bold$')}
FONT=${FONT:-$(font '^(Inter|DejaVu-Sans|Adwaita-Sans|Liberation-Sans|Noto-Sans)(-Regular)?$')}
: "${FONT_BOLD:?no bold sans font found; set FONT_BOLD=<name from magick -list font>}"
: "${FONT:?no sans font found; set FONT=<name from magick -list font>}"

# 1. Transparent, trimmed master: flood-fill black from the corners, erode 1px fringe.
W=$(magick identify -format %w "$SRC"); H=$(magick identify -format %h "$SRC")
magick "$SRC" -alpha set -fuzz 3% -fill none \
  -draw "color 0,0 floodfill" -draw "color $((W-1)),0 floodfill" \
  -draw "color 0,$((H-1)) floodfill" -draw "color $((W-1)),$((H-1)) floodfill" \
  -channel A -morphology Erode Disk:1 +channel \
  -trim +repage -define png:exclude-chunks=date,time "$CUT"

# fit <size> <inner> <bg|none> <out>: rock scaled to fit inner×inner, centered on size×size
fit() {
  magick "$CUT" -resize "$2x$2" -background "$3" -gravity center -extent "$1x$1" \
    $([ "$3" != none ] && echo "-alpha remove -alpha off") \
    -define png:exclude-chunks=date,time "$4"
}

# 2. Web
fit 512 480 none  "$WEB/app/icon.png"
fit 180 150 "$BG" "$WEB/app/apple-icon.png"
fit 192 176 "$BG" "$WEB/public/icons/icon-192.png"
fit 512 470 "$BG" "$WEB/public/icons/icon-512.png"
fit 512 400 "$BG" "$WEB/public/icons/icon-512-maskable.png"   # 80% safe zone
fit 512 512 none  "$WEB/public/brand/rock.png"
magick "$CUT" -background none -gravity center \
  \( -clone 0 -resize 16x16 -extent 16x16 \) \
  \( -clone 0 -resize 32x32 -extent 32x32 \) \
  \( -clone 0 -resize 48x48 -extent 48x48 \) \
  -delete 0 -strip "$WEB/app/favicon.ico"
magick -size 1200x630 "xc:$BG" \
  \( "$CUT" -resize 420x420 \) -gravity center -geometry -250+0 -composite \
  -fill '#e5e7eb' -font "$FONT_BOLD" -pointsize 110 -gravity center -annotate +230-20 'rock' \
  -fill '#9ca3af' -font "$FONT" -pointsize 34 -annotate +230+70 'Build habits that stick' \
  -define png:exclude-chunks=date,time "$WEB/app/opengraph-image.png"

# 3. Mobile (Expo)
fit 1024 860 "$BG" "$MOB/icon.png"
fit 1024 640 none  "$MOB/adaptive-icon.png"                    # 66% safe zone
fit 512  512 none  "$MOB/rock.png"
magick -size 1284x2778 "xc:$BG" \( "$CUT" -resize 520x520 \) -gravity center -composite \
  -define png:exclude-chunks=date,time "$MOB/splash.png"
magick "$CUT" -alpha extract -threshold 50% -background black -alpha shape \
  -fill white -colorize 100 -resize 80x80 -background none -gravity center -extent 96x96 \
  -define png:exclude-chunks=date,time "$MOB/notification-icon.png"

echo "brand assets generated"
