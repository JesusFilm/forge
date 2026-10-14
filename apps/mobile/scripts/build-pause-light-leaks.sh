#!/usr/bin/env bash
# Cuts the Home Pause card's light-leak images from a filmed light leak.
# Usage, in apps/mobile: bash scripts/build-pause-light-leaks.sh <clip.mp4>

# The clip is "Flashing Yellow Lights" (Pexels video 12987889, the 1920x1080
# file), https://www.pexels.com/video/flashing-yellow-lights-12987889/. The
# Pexels License allows free use and changes, with no attribution.
set -euo pipefail

HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
MOBILE=$(cd "$HERE/.." && pwd)
OUT_DIR="$MOBILE/assets/dailyPause/leaks"

# Two leaks, each a pair of frames half a second apart, so the app can
# cross-fade one into the other. Red and orange frames only: yellow turns
# lime over the card's cool still.
FRAMES="sweep-a:7.0 sweep-b:7.5 band-a:12.0 band-b:12.5"

# Black out the dim glow so only the bright light remains. Warm the red toward
# orange, which a screen blend turns peach, not pink.
LOOK="scale=640:360,curves=all='0/0 0.42/0 0.78/0.55 1/0.95'"
LOOK+=",colorchannelmixer=rr=1:gr=0.32:gg=1:bb=0.7,gblur=sigma=2"

die() {
  echo "build-pause-light-leaks: $*" >&2
  exit 1
}

command -v ffmpeg >/dev/null || die "ffmpeg is not installed."
CLIP=${1:-}
[ -f "$CLIP" ] || die "give the path of the Pexels 12987889 clip."
mkdir -p "$OUT_DIR"

for frame in $FRAMES; do
  name=${frame%%:*}
  time=${frame##*:}
  ffmpeg -v error -y -ss "$time" -i "$CLIP" -frames:v 1 -vf "$LOOK" \
    -q:v 4 "$OUT_DIR/$name.jpg"
  echo "wrote assets/dailyPause/leaks/$name.jpg"
done
