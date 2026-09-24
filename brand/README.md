# Brand assets

`rock.png` is the master logo. Every icon, favicon and splash in `apps/web` and
`apps/mobile` is generated from it. Never edit the generated files by hand.

    brand/generate.sh            # web + Expo assets
    brand/generate-android.sh    # native Android res/ (prebuilt android/ folder)

Requires ImageMagick 7 (`magick`). Commit the outputs.
