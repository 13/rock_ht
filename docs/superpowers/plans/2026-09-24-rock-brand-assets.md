# Rock Logo Brand Assets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace every logo, favicon, app icon and splash in the web and mobile apps with `rock.png` (faceted slate boulder with an amber rim light), generated reproducibly from one source file.

**Architecture:** Commit `rock.png` as the brand master under `brand/`. One ImageMagick script (`brand/generate.sh`) cuts the black background into a transparent master, then renders every derivative at exact sizes into the web and mobile asset paths. Nobody edits generated files by hand; to change the logo, replace the master and rerun the script. The web `Logo` component switches from its inline SVG to the generated PNG through `next/image`.

**Tech Stack:** ImageMagick 7 (`magick`), Next.js 16 app-dir metadata file conventions (`app/icon.png`, `app/apple-icon.png`, `app/favicon.ico`, `app/opengraph-image.png`), Expo `app.json` icon/splash/adaptive-icon config, Android native `res/` (the repo commits a prebuilt `android/` folder).

## Global Constraints

- Source: `rock.png`, 1254×1254 RGB with no alpha, pure black (`#000`–`#010101`) background, rock is about 907×677 after trimming.
- App background colour stays `#0a0a0f` (`app.json` `splash.backgroundColor`, `android.adaptiveIcon.backgroundColor`, `res/values/colors.xml`, web manifest `background_color`).
- Background removal: flood fill from all four corners with `-fuzz 3%`, then a 1 px alpha erode to drop the dark fringe. Verified: this separates the black background from the rock's darkest navy edge.
- iOS app icon (`apps/mobile/assets/icon.png`) must be opaque 1024×1024 (App Store rejects alpha).
- Android adaptive foreground: 1024×1024, transparent, rock inside the central 66% safe zone (≤ 676 px wide).
- Android notification icon: white silhouette on transparent (Android ignores colour and renders the alpha only).
- PWA maskable icon: rock inside the central 80% safe zone on `#0a0a0f`.
- Generated files are committed so CI builds (Docker image, APK) don't need ImageMagick.

## File structure

```
brand/
  rock.png                  MOVED from repo root (master, never edited)
  generate.sh               NEW  single source of truth for derivatives
  README.md                 NEW  how to regenerate
  build/rock-cut.png        GENERATED transparent trimmed master (committed)

apps/web/app/
  favicon.ico               GENERATED 16/32/48 multi-size
  icon.png                  GENERATED 512×512 transparent (Next emits <link rel=icon>)
  apple-icon.png            GENERATED 180×180 opaque #0a0a0f
  opengraph-image.png       GENERATED 1200×630 rock + "rock" wordmark
apps/web/public/
  icons/icon-192.png        GENERATED (manifest.ts already references it)
  icons/icon-512.png        GENERATED
  icons/icon-512-maskable.png GENERATED
  brand/rock.png            GENERATED 512×512 transparent for <Logo>
apps/web/components/ui/logo.tsx   MODIFY  SVG → next/image

apps/mobile/assets/
  icon.png                  GENERATED 1024 opaque
  adaptive-icon.png         GENERATED 1024 transparent, 66% safe zone
  splash.png                GENERATED 1284×2778 rock centered on #0a0a0f
  notification-icon.png     GENERATED 96×96 white silhouette
  rock.png                  GENERATED 512 transparent for in-app logo
apps/mobile/android/app/src/main/res/
  mipmap-*/ic_launcher*.webp          GENERATED
  drawable-*/splashscreen_logo.png    GENERATED
  drawable-*/notification_icon.png    GENERATED
```

---

### Task 1: Brand master + generator script (web + mobile Expo assets)

**Files:**
- Move: `rock.png` → `brand/rock.png`
- Create: `brand/generate.sh`, `brand/README.md`
- Generated: every file in the structure above except the Android `res/` files (Task 3)

**Interfaces:**
- Produces: `brand/build/rock-cut.png` (transparent, trimmed), which Tasks 2–3 consume, plus all derivative paths above.

- [ ] **Step 1: Move the master**

```bash
mkdir -p brand/build
git mv rock.png brand/rock.png 2>/dev/null || mv rock.png brand/rock.png
```

- [ ] **Step 2: Write `brand/generate.sh`**

```bash
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
font() { magick -list font | awk '/Font:/{print $2}' | grep -iE "$1" | head -1; }
FONT_BOLD=${FONT_BOLD:-$(font '^(Inter|DejaVu-Sans|Adwaita-Sans|Liberation-Sans|Noto-Sans)-Bold$')}
FONT=${FONT:-$(font '^(Inter|DejaVu-Sans|Adwaita-Sans|Liberation-Sans|Noto-Sans)(-Regular)?$')}

# 1. Transparent, trimmed master: flood-fill black from the corners, erode 1px fringe.
W=$(magick identify -format %w "$SRC"); H=$(magick identify -format %h "$SRC")
magick "$SRC" -alpha set -fuzz 3% -fill none \
  -draw "color 0,0 floodfill" -draw "color $((W-1)),0 floodfill" \
  -draw "color 0,$((H-1)) floodfill" -draw "color $((W-1)),$((H-1)) floodfill" \
  -channel A -morphology Erode Disk:1 +channel \
  -trim +repage "$CUT"

# fit <size> <inner> <bg|none> <out>: rock scaled to fit inner×inner, centered on size×size
fit() {
  magick "$CUT" -resize "$2x$2" -background "$3" -gravity center -extent "$1x$1" \
    $([ "$3" != none ] && echo "-alpha remove -alpha off") "$4"
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
  -delete 0 "$WEB/app/favicon.ico"
magick -size 1200x630 "xc:$BG" \
  \( "$CUT" -resize 420x420 \) -gravity center -geometry -250+0 -composite \
  -fill '#e5e7eb' -font "$FONT_BOLD" -pointsize 110 -gravity center -annotate +230-20 'rock' \
  -fill '#9ca3af' -font "$FONT" -pointsize 34 -annotate +230+70 'Build habits that stick' \
  "$WEB/app/opengraph-image.png"

# 3. Mobile (Expo)
fit 1024 860 "$BG" "$MOB/icon.png"
fit 1024 640 none  "$MOB/adaptive-icon.png"                    # 66% safe zone
fit 512  512 none  "$MOB/rock.png"
magick -size 1284x2778 "xc:$BG" \( "$CUT" -resize 520x520 \) -gravity center -composite "$MOB/splash.png"
magick "$CUT" -alpha extract -threshold 50% -background black -alpha shape \
  -fill white -colorize 100 -resize 80x80 -background none -gravity center -extent 96x96 \
  "$MOB/notification-icon.png"

echo "brand assets generated"
```
Run: `chmod +x brand/generate.sh && brand/generate.sh`
Expected: `brand assets generated`, with no ImageMagick warnings. The script picks the first installed font from Inter / DejaVu / Adwaita / Liberation / Noto; set `FONT_BOLD=… FONT=…` to force one (`magick -list font`). CI doesn't need ImageMagick, because outputs are committed.

- [ ] **Step 3: Verify sizes and alpha**

```bash
magick identify -format '%f %wx%h alpha=%A\n' \
  apps/web/app/icon.png apps/web/app/apple-icon.png apps/web/app/favicon.ico \
  apps/web/public/icons/*.png apps/mobile/assets/{icon,adaptive-icon,splash,notification-icon}.png
```
Expected:
- `icon.png 512x512 alpha=Blend` (web, transparent)
- `apple-icon.png 180x180 alpha=Undefined` (opaque)
- `favicon.ico` three frames: 16x16, 32x32, 48x48
- mobile `icon.png 1024x1024 alpha=Undefined` (opaque, iOS requirement)
- `adaptive-icon.png 1024x1024 alpha=Blend`
- `notification-icon.png 96x96 alpha=Blend`

Visual check: open `brand/build/rock-cut.png` over a light background (`magick brand/build/rock-cut.png -background '#f0f0f0' -flatten /tmp/check.png`). There should be no black halo around the edge.

- [ ] **Step 4: README**

`brand/README.md`:
```markdown
# Brand assets

`rock.png` is the master logo. Every icon, favicon and splash in `apps/web` and
`apps/mobile` is generated from it. Never edit the generated files by hand.

    brand/generate.sh            # web + Expo assets
    brand/generate-android.sh    # native Android res/ (prebuilt android/ folder)

Requires ImageMagick 7 (`magick`). Commit the outputs.
```

- [ ] **Step 5: Commit**

```bash
git add brand apps/web/app/icon.png apps/web/app/apple-icon.png apps/web/app/favicon.ico \
  apps/web/app/opengraph-image.png apps/web/public apps/mobile/assets
git commit -m "feat(brand): generate icons, favicon, splash and OG image from rock logo"
```

### Task 2: Use the rock in UI components and metadata

**Files:**
- Modify: `apps/web/components/ui/logo.tsx`
- Modify: `apps/web/app/manifest.ts` (`theme_color`)
- Modify: `apps/web/app/layout.tsx` (only if the OG metadata needs `metadataBase`)
- Modify: `apps/mobile/app.json` (splash `resizeMode`, notification colour)

**Interfaces:**
- Consumes: `/brand/rock.png` (web public), `assets/rock.png` (mobile).
- Produces: `LogoMark` and `Logo` with unchanged props (`size`, `className`, `showText`, `textClassName`), so call sites in `components/layout/sidebar.tsx` and `app/(auth)/layout.tsx` need no edits.

- [ ] **Step 1: Replace the SVG in `logo.tsx`**

```tsx
import Image from "next/image";
import { cn } from "@/lib/utils";

interface LogoMarkProps {
  className?: string;
  size?: number;
}

/** The rock rock. Generated from brand/rock.png by brand/generate.sh. */
export function LogoMark({ className, size = 32 }: LogoMarkProps) {
  return (
    <Image
      src="/brand/rock.png"
      alt=""
      aria-hidden="true"
      width={size}
      height={size}
      className={cn("shrink-0 object-contain", className)}
      priority
    />
  );
}
```
Keep the `Logo` component below it unchanged.

- [ ] **Step 2: Metadata**

Next.js picks up `app/icon.png`, `app/apple-icon.png`, `app/favicon.ico` and `app/opengraph-image.png` automatically. Remove any conflicting `icons:` entry from `metadata` in `app/layout.tsx` (there is none today). For absolute OG URLs, add `metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000")` to `metadata`.

- [ ] **Step 3: Colours (decision point; confirm with the user before changing)**

The rock's palette is slate `#475569`–`#1e293b` with an amber rim `#f59e0b`, while the app accent is indigo `#6366f1`. The minimal change is the manifest `theme_color` → `#0a0a0f`, so the PWA title bar matches the icon background. Moving the accent colour to amber would be a design-system change across both apps, which is out of scope here and should be raised as a question.

- [ ] **Step 4: Mobile config**

In `apps/mobile/app.json`:
- `"splash": { "image": "./assets/splash.png", "resizeMode": "cover", "backgroundColor": "#0a0a0f" }`: the generated splash is full-screen, so use `cover`.
- `expo-notifications` plugin `"color"`: keep `#6366f1`, or use `#f59e0b` if Step 3's accent change is approved.

Where the mobile app shows a logo (the old login screen used one; in the offline-first plan that screen becomes `app/sync-settings.tsx`), use:
```tsx
<Image source={require("@/assets/rock.png")} style={{ width: 72, height: 72 }} resizeMode="contain" />
```

- [ ] **Step 5: Verify**

```bash
npm run type-check && npm run lint
npm run build --workspace=apps/web   # placeholder env as in CI, or after offline-first Task 10
```
Then run `npm run dev:web` and check:
1. The browser tab shows the rock favicon (hard refresh; clear the favicon cache if needed).
2. The sidebar and auth pages show the rock at 28 px and 56 px, crisp and without a halo in light and dark themes.
3. `curl -s localhost:3000/manifest.webmanifest | grep icon` lists the three icons, and each URL returns 200.
4. `curl -sI localhost:3000/opengraph-image.png` returns 200 `image/png`.

- [ ] **Step 6: Commit**

```bash
git add apps/web/components/ui/logo.tsx apps/web/app/manifest.ts apps/web/app/layout.tsx apps/mobile/app.json
git commit -m "feat(brand): use rock logo in web Logo component, manifest and mobile splash"
```

### Task 3: Native Android resources (prebuilt `android/` folder)

The repo commits `apps/mobile/android/`, so `app.json` icon changes do **not** reach the APK until `res/` is regenerated. Running `expo prebuild --clean` would overwrite committed native edits (the `gradle.properties` JDK pin, the signing config). Generate only the image resources instead.

**Files:**
- Create: `brand/generate-android.sh`
- Generated: `apps/mobile/android/app/src/main/res/mipmap-{mdpi,hdpi,xhdpi,xxhdpi,xxxhdpi}/ic_launcher.webp`, `ic_launcher_round.webp`, `ic_launcher_foreground.webp`; `drawable-{mdpi,…,xxxhdpi}/splashscreen_logo.png`, `notification_icon.png`

- [ ] **Step 1: Script**

`brand/generate-android.sh`:
```bash
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
```
`mipmap-anydpi-v26/ic_launcher.xml` already points at `@color/iconBackground` (`#0a0a0f`) and `@mipmap/ic_launcher_foreground`, so it needs no edit. Confirm with `cat $RES/mipmap-anydpi-v26/ic_launcher.xml`.

- [ ] **Step 2: Run + build**

```bash
chmod +x brand/generate-android.sh && brand/generate-android.sh
cd apps/mobile/android && NODE_PATH=$PWD/../node_modules ./gradlew assembleRelease
```
Expected: `BUILD SUCCESSFUL`. Install `app/build/outputs/apk/release/app-release.apk`, then check:
1. The launcher shows the rock on dark: round, squircle and adaptive masks all keep the rock inside the mask (long-press the icon; try two launcher shapes if available).
2. The splash shows a centered rock on `#0a0a0f`, with no white flash.
3. A test reminder notification shows the white rock silhouette in the status bar.

- [ ] **Step 3: Commit**

```bash
git add brand/generate-android.sh apps/mobile/android/app/src/main/res
git commit -m "feat(brand): regenerate Android launcher, splash and notification icons from rock"
```

## Open questions for the user

1. **Accent colour:** keep indigo `#6366f1`, or move the accent to the rock's amber `#f59e0b`? That would touch the Tailwind theme in both apps and the five themes.
2. **Wordmark on the OG image:** "rock" + "Build habits that stick" in DejaVu Sans, or a brand font? Web typography recommendations in CLAUDE.md point to a modern sans such as Inter.
