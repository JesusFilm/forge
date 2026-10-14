#!/usr/bin/env bash
# Bakes each devotional's still for the Home card and the iOS widget: graded
# to muted pastel, blurred, then given grain, dust, and scratches. Usage, in
# apps/mobile: bash scripts/build-pause-card-art.sh

# Reads assets/devotionals/<key>.mp4 (encode-devotionals.sh) and the leaks of
# build-pause-light-leaks.sh. Writes assets/dailyPause/<key>-card.jpg and
# <key>-widget.jpg, which git tracks.
set -euo pipefail

HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
MOBILE=$(cd "$HERE/.." && pwd)
IN_DIR="$MOBILE/assets/devotionals"
OUT_DIR="$MOBILE/assets/dailyPause"

# The clean area of each frame (width:height:x:y in 1080x1920): everything
# above the burned-in captions. Lamp's timer ring sits inside it, so delogo
# paints the ring out first.
still_time() {
  case "$1" in
    pharisee) echo 36 ;;
    lamp) echo 74 ;;
    *) return 1 ;;
  esac
}
still_area() {
  case "$1" in
    pharisee) echo "1080:920:0:0" ;;
    lamp) echo "1080:870:0:0" ;;
    *) return 1 ;;
  esac
}
still_fix() {
  case "$1" in
    lamp) echo "delogo=x=805:y=180:w=150:h=170," ;;
    *) echo "" ;;
  esac
}

# The clean area's height on the 1280x720 card. A smaller value zooms out;
# a blurred copy of the frame fills the rest, mostly under the card's scrim.
AREA_HEIGHT=560

# Gaussian blur at 1280 px wide. The widget is a still glance, so it is sharper.
CARD_BLUR=12
WIDGET_BLUR=5

# A widget cannot animate, so it holds one moment of a filmed leak, mirrored
# for Lamp so the two days differ.
widget_leak() {
  case "$1" in
    pharisee) echo "sweep-b.jpg|null" ;;
    lamp) echo "band-a.jpg|hflip" ;;
    *) return 1 ;;
  esac
}
# 896x504 stays under WidgetKit's image size limit for both widget sizes.
WIDGET_SIZE="896:504"
# Dark under the label and the question, and lightest at 42 % of the height.
# A smoothstep on both sides removes the ridge at the lightest line.
SCRIM="color=c=0x0c0b0a:s=896x504,format=rgba,geq=r=12:g=11:b=10:a='255*("
SCRIM+="if(lt(Y/H,0.42),0.25+0.65*(1-(Y/H/0.42)^2*(3-2*Y/H/0.42)),"
SCRIM+="0.25+0.67*((Y/H-0.42)/0.58)^2*(3-2*(Y/H-0.42)/0.58)))'"

GRADE="eq=saturation=0.78:contrast=0.84:brightness=0.05"
GRADE+=",curves=all='0/0.09 0.5/0.56 1/0.96'"
GRADE+=",colorbalance=rs=-0.02:gs=0.02:bs=0.08:rm=0.05:bm=0.03:rh=0.08:gh=0.03:bh=0.02"
# Fixed seeds, so a rebuild gives the same file.
WASH="gradients=s=1280x720:c0=0xffc4ae:c1=0xaec6ea:x0=0:y0=0:x1=1280:y1=720:nb_colors=2:seed=1"
GRAIN="color=c=0x808080:s=640x360,format=gray,noise=alls=70:allf=u:all_seed=7"
# Dust: cells where two seeded noise layers both run high (161 of 57,600),
# scaled up into soft specks.
NOISE="color=c=0x808080:s=320x180,format=gray,noise=alls=100:allf=u"
HIGH=",lut=y='if(gte(val,173),255,0)',format=gray"
DUST="$NOISE:all_seed=11$HIGH[a];$NOISE:all_seed=23$HIGH[b];[a][b]blend=all_mode=multiply"
DUST+=",scale=1280:720:flags=neighbor,gblur=sigma=1.2"
DUST+=",drawbox=x=318:y=0:w=1:h=720:color=white@0.35:t=fill"
DUST+=",drawbox=x=902:y=0:w=2:h=720:color=white@0.18:t=fill"
DUST+=",drawbox=x=1061:y=0:w=1:h=720:color=white@0.25:t=fill[out0]"

die() {
  echo "build-pause-card-art: $*" >&2
  exit 1
}

command -v ffmpeg >/dev/null || die "ffmpeg is not installed."
mkdir -p "$OUT_DIR"

# The still as a filter graph that ends at [still]: inputs 0 to 3 are the
# video, the wash, the grain, and the dust.
still_graph() {
  local key=$1 blur=$2
  echo "[0]$(still_fix "$key")crop=$(still_area "$key"),split[x][y];[x]scale=1280:-2,crop=1280:720,gblur=sigma=40[fill];[y]scale=-2:$AREA_HEIGHT,format=rgba,geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='255*min(1,min(min(X,W-1-X),H-1-Y)/140)'[area];[fill][area]overlay=(W-w)/2:0,$GRADE,format=gbrp[g];[1]format=gbrp[w];[g][w]blend=all_mode=screen:all_opacity=0.2,gblur=sigma=$blur[b];[2]scale=1280:720:flags=bicubic,format=gbrp[n];[b][n]blend=all_mode=overlay:all_opacity=0.32[bg];[3]format=gbrp[d];[bg][d]blend=all_mode=screen:all_opacity=0.55[still]"
}

for key in pharisee lamp; do
  video="$IN_DIR/$key.mp4"
  [ -f "$video" ] || die "no $video. Run scripts/encode-devotionals.sh first."
  leak=$(widget_leak "$key")
  plate="$OUT_DIR/leaks/${leak%%|*}"
  [ -f "$plate" ] || die "no $plate. Run scripts/build-pause-light-leaks.sh first."
  inputs=(-ss "$(still_time "$key")" -i "$video" -f lavfi -i "$WASH"
    -f lavfi -i "$GRAIN" -f lavfi -i "$DUST")

  ffmpeg -v error -y "${inputs[@]}" \
    -filter_complex "$(still_graph "$key" "$CARD_BLUR");[still]format=yuvj420p" \
    -frames:v 1 -q:v 5 "$OUT_DIR/$key-card.jpg"
  echo "wrote assets/dailyPause/$key-card.jpg"

  ffmpeg -v error -y "${inputs[@]}" -i "$plate" -f lavfi -i "$SCRIM" \
    -filter_complex "$(still_graph "$key" "$WIDGET_BLUR");[still]scale=$WIDGET_SIZE[s];[4]${leak##*|},scale=$WIDGET_SIZE,format=gbrp[l];[s][l]blend=all_mode=screen:all_opacity=0.8,format=rgba[lit];[lit][5]overlay,format=yuvj420p" \
    -frames:v 1 -q:v 4 "$OUT_DIR/$key-widget.jpg"
  echo "wrote assets/dailyPause/$key-widget.jpg"
done
