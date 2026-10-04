#!/usr/bin/env bash
# Encodes the bundled devotional videos (KTD3) from their original files.
# Usage, in apps/mobile: bash scripts/encode-devotionals.sh [originals-folder]

# The default folder is apps/mobile/misc-assets in the main checkout. The
# script writes assets/devotionals/<key>.mp4 and never writes to the originals.
# Git ignores the outputs, and the root .easignore puts them in the EAS upload.
set -euo pipefail

HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
MOBILE=$(cd "$HERE/.." && pwd)
TIMELINE="$MOBILE/src/lib/dailyPause/devotionalTimeline.json"
OUT_DIR="$MOBILE/assets/devotionals"

# Catalog loudness, measured 2026-10-05 with ebur128 on four English Mux HLS
# streams: 1_cl1309-0-0 -21.2, 2_0-FallingPlates -18.8, 1_jf6101-0-0 -23.0,
# and 1_wl604401-0-0 -20.1 LUFS. The target is their mean, rounded.
TARGET_LUFS=-21
TARGET_TRUE_PEAK_DB=-1.5
# The catalog loudness range is 8.5 to 15.4 LU. A wide target keeps the most
# range when loudnorm cannot apply one linear gain under the true-peak limit.
TARGET_LRA=20

# About 2 Mb/s in total, so the two videos come to about 100 MB.
VIDEO_KBPS=1900
AUDIO_KBPS=128

die() {
  echo "encode-devotionals: $*" >&2
  exit 1
}

original_name() {
  case "$1" in
    pharisee) echo "devo_v_pharisee.mp4" ;;
    lamp) echo "devo2_v_lamp.mp4" ;;
    *) return 1 ;;
  esac
}

default_originals_dir() {
  local common_dir
  common_dir=$(git -C "$MOBILE" rev-parse --path-format=absolute --git-common-dir)
  echo "$(dirname "$common_dir")/apps/mobile/misc-assets"
}

for tool in ffmpeg ffprobe node; do
  command -v "$tool" >/dev/null || die "$tool is not installed."
done

ORIGINALS_DIR=${1:-$(default_originals_dir)}
[ -d "$ORIGINALS_DIR" ] || die "no folder at $ORIGINALS_DIR."

# Each key in the timeline, one per line.
KEYS=$(node -e '
  const timeline = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"))
  console.log(Object.keys(timeline).join("\n"))
' "$TIMELINE")

# Every start and end of a part or a skipped range after 0 s, in order.
cut_points() {
  node -e '
    const entry = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"))[process.argv[2]]
    const ranges = [...Object.values(entry.parts), ...entry.skipped]
    const times = ranges.flatMap((range) => [range.startSec, range.endSec])
    console.log([...new Set(times)].filter((t) => t > 0).sort((a, b) => a - b).join(","))
  ' "$TIMELINE" "$1"
}

# The loudnorm measurement, as filter options for the second pass.
measured_loudness() {
  # shellcheck disable=SC2016 # The JavaScript template literal is not shell.
  node -e '
    const log = require("fs").readFileSync(process.argv[1], "utf8")
    const json = log.slice(log.lastIndexOf("{"), log.lastIndexOf("}") + 1)
    const m = JSON.parse(json)
    console.log(
      `measured_I=${m.input_i}:measured_TP=${m.input_tp}:measured_LRA=${m.input_lra}` +
        `:measured_thresh=${m.input_thresh}:offset=${m.target_offset}`,
    )
  ' "$1"
}

WORK_DIR=$(mktemp -d "${TMPDIR:-/tmp}/encode-devotionals.XXXXXX")
trap 'rm -rf "$WORK_DIR"' EXIT
mkdir -p "$OUT_DIR"

LOUDNORM="loudnorm=I=$TARGET_LUFS:TP=$TARGET_TRUE_PEAK_DB:LRA=$TARGET_LRA"
# Level 4.1, the usual level for 1080p, caps the reference frames. Without it,
# x264 marks this frame size level 5.0, which fewer decoders accept.
X264=(-c:v libx264 -preset slow -profile:v high -level:v 4.1
  -b:v "${VIDEO_KBPS}k" -forced-idr 1)

for key in $KEYS; do
  name=$(original_name "$key") || die "no original file is known for '$key'."
  src="$ORIGINALS_DIR/$name"
  [ -f "$src" ] || die "no original at $src."
  out="$OUT_DIR/$key.mp4"
  partial="$OUT_DIR/.$key.partial.mp4"
  cuts=$(cut_points "$key")
  echo "encode-devotionals: $key from $src, keyframes at $cuts"

  ffmpeg -hide_banner -nostats -i "$src" -map 0:a:0 \
    -af "$LOUDNORM:print_format=json" -f null - 2>"$WORK_DIR/$key.loudness.log"
  measured=$(measured_loudness "$WORK_DIR/$key.loudness.log")

  ffmpeg -hide_banner -loglevel error -y -i "$src" -map 0:v:0 -an "${X264[@]}" \
    -force_key_frames "$cuts" -pass 1 -passlogfile "$WORK_DIR/$key" -f null -
  ffmpeg -hide_banner -loglevel error -y -i "$src" -map 0:v:0 -map 0:a:0 \
    "${X264[@]}" -force_key_frames "$cuts" -pass 2 -passlogfile "$WORK_DIR/$key" \
    -af "$LOUDNORM:$measured:linear=true" -ar 48000 -c:a aac -b:a "${AUDIO_KBPS}k" \
    -movflags +faststart "$partial"
  mv -f "$partial" "$out"
  echo "encode-devotionals: wrote $out ($(wc -c <"$out" | tr -d ' ') bytes)"
done
