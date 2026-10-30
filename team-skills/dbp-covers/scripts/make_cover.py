#!/usr/bin/env python3
"""Make a Daily Bible Pause YouTube cover from a film frame.

Three looks, matching the series covers made in Figma:
  face    - a face shot; serif title on the right, last line gold, gold passage label above
  bold    - 2-4 heavy caps words on the left, orange rule, passage label under it
  moment  - the story moment; gold pill label and a sans headline at the bottom left

--side left|right and --valign top|middle|bottom move the text to where the
frame has room (faces stay clear). Look at the result before using it.

Usage:
  python3 make_cover.py --type face --frame frame.jpg --text "Not this|close." --passage "LUKE 5:1–11" --out cover.jpg
  python3 make_cover.py --type bold --frame f.jpg --text "Отойди|от|меня" --passage "ОТ ЛУКИ 5:1–11" --out c.jpg

`|` forces a line break; otherwise lines wrap to fit. Needs Pillow.
"""

import argparse
import os

from PIL import Image, ImageDraw, ImageFilter, ImageFont, ImageOps

FONTS = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "fonts")
W, H = 1600, 900
WHITE = (255, 255, 255)
GOLD = (242, 207, 138)
PILL = (242, 196, 107)
INK = (34, 24, 16)
ORANGE = (241, 116, 43)


def font(name, size):
    return ImageFont.truetype(os.path.join(FONTS, name), size)


def load_frame(path, focus_x, zoom=1.0):
    img = Image.open(path).convert("RGB")
    if zoom > 1.0:
        w, h = img.size
        cw, ch = w / zoom, h / zoom
        left = max(0, min(w - cw, focus_x * w - cw / 2))
        top = (h - ch) / 2
        img = img.crop((int(left), int(top), int(left + cw), int(top + ch)))
    return ImageOps.fit(img, (W, H), Image.LANCZOS, centering=(focus_x, 0.5))


def gradient(direction, start, end, alpha_max, tint=(0, 0, 0)):
    """An RGBA overlay that darkens (or tints) from `start` to `end` (0-1 of the axis)."""
    horizontal = direction in ("left", "right")
    size = W if horizontal else H
    strip = Image.new("RGBA", (size, 1) if horizontal else (1, size))
    for i in range(size):
        t = i / (size - 1)
        if direction in ("left", "top"):
            t = 1 - t
        a = 0 if t <= start else min(1.0, (t - start) / max(end - start, 1e-6))
        a = int(alpha_max * (a * a * (3 - 2 * a)))
        strip.putpixel((i, 0) if horizontal else (0, i), tint + (a,))
    return strip.resize((W, H))


def wrap(text, fnt, max_w, draw):
    lines = []
    for part in text.split("|"):
        words, cur = part.split(), ""
        for w in words:
            trial = (cur + " " + w).strip()
            if cur and draw.textlength(trial, font=fnt) > max_w:
                lines.append(cur)
                cur = w
            else:
                cur = trial
        if cur:
            lines.append(cur)
    return lines


def fit(text, name, max_w, max_h, start, draw, leading, upper=False):
    if upper:
        text = text.upper()
    size = start
    while size > 24:
        f = font(name, size)
        lines = wrap(text, f, max_w, draw)
        if len(lines) * size * leading <= max_h and all(
            draw.textlength(l, font=f) <= max_w for l in lines
        ):
            return f, lines, size
        size -= 4
    f = font(name, size)
    return f, wrap(text, f, max_w, draw), size


def tracked(draw, xy, text, fnt, fill, tracking, anchor_right=False):
    """Draw caps with letter spacing; returns the drawn width."""
    widths = [draw.textlength(c, font=fnt) for c in text]
    total = sum(widths) + tracking * (len(text) - 1)
    x, y = xy
    if anchor_right:
        x -= total
    for c, w in zip(text, widths):
        draw.text((x, y), c, font=fnt, fill=fill)
        x += w + tracking
    return total


MARGIN_X, MARGIN_TOP, MARGIN_BOTTOM = 76, 80, 70
# YouTube draws the duration over the bottom-right corner: keep text above it there.
DURATION_CLEAR = 70


def block_top(valign, block_h, side):
    if valign == "top":
        return MARGIN_TOP
    if valign == "middle":
        return (H - block_h) / 2
    bottom = H - MARGIN_BOTTOM - (DURATION_CLEAR if side == "right" else 0)
    return bottom - block_h


def line_x(side):
    return (W - MARGIN_X, "ra") if side == "right" else (MARGIN_X, "la")


def shade(img, side, valign, alpha, tint=(0, 0, 0)):
    """Darken the side and height where the text sits."""
    img = Image.alpha_composite(img.convert("RGBA"), gradient(side, 0.42, 1.0, alpha, tint))
    if valign in ("top", "bottom"):
        img = Image.alpha_composite(img, gradient(valign, 0.55, 1.0, alpha // 2))
    return img


def face(img, text, passage, side="right", valign="middle"):
    img = shade(img, side, valign, 175)
    d = ImageDraw.Draw(img)
    f, lines, size = fit(text, "Literata-ExtraBold.ttf", 700, 420, 190, d, 1.02)
    label = font("Inter-SemiBold.ttf", 44)
    block_h = 82 + len(lines) * size * 1.02
    top = block_top(valign, block_h, side) + 82
    x, anchor = line_x(side)
    tracked(d, (x, top - 82), passage.upper(), label, GOLD, 3, anchor_right=side == "right")
    for i, line in enumerate(lines):
        color = GOLD if i == len(lines) - 1 and len(lines) > 1 else WHITE
        d.text((x, top + i * size * 1.02), line, font=f, fill=color, anchor=anchor)
    return img


def bold(img, text, passage, side="left", valign="top"):
    soft = img.filter(ImageFilter.GaussianBlur(10))
    mask = gradient(side, 0.45, 0.9, 255).getchannel("A")
    img = Image.composite(soft, img, mask)
    img = shade(img, side, valign, 150, tint=(120, 62, 22))
    img = Image.alpha_composite(img, gradient(side, 0.45, 1.0, 90))
    d = ImageDraw.Draw(img)
    f, lines, size = fit(text, "Montserrat-ExtraBold.ttf", 640, 560, 168, d, 1.0, upper=True)
    label = font("Inter-SemiBold.ttf", 42)
    block_h = len(lines) * size + 26 + 14 + 40 + 50
    top = block_top(valign, block_h, side)
    x, anchor = line_x(side)
    for i, line in enumerate(lines):
        d.text((x, top + i * size), line, font=f, fill=WHITE, anchor=anchor)
    y = top + len(lines) * size + 26
    bar = [x, y, x + 270, y + 14] if side == "left" else [x - 270, y, x, y + 14]
    d.rectangle(bar, fill=ORANGE)
    tracked(d, (x, y + 40), passage.upper(), label, WHITE, 2, anchor_right=side == "right")
    return img


def moment(img, text, passage, side="left", valign="bottom"):
    img = Image.alpha_composite(img.convert("RGBA"), gradient(valign if valign != "middle" else "bottom", 0.4, 1.0, 200))
    if valign == "middle":
        img = Image.alpha_composite(img, gradient(side, 0.4, 1.0, 150))
    d = ImageDraw.Draw(img)
    f, lines, size = fit(text, "Inter-ExtraBold.ttf", 960, 320, 144, d, 1.06)
    label = font("Inter-Bold.ttf", 46)
    cap = passage.upper()
    tw = d.textlength(cap, font=label) + 3 * (len(cap) - 1)
    block_h = 112 + len(lines) * size * 1.06
    top = block_top(valign, block_h, side) + 112
    x, anchor = line_x(side)
    for i, line in enumerate(lines):
        d.text((x, top + i * size * 1.06), line, font=f, fill=WHITE, anchor=anchor)
    py = top - 112
    px0 = x if side == "left" else x - tw - 56
    d.rounded_rectangle([px0, py, px0 + tw + 56, py + 82], radius=10, fill=PILL)
    tracked(d, (px0 + 28, py + 14), cap, label, INK, 3)
    return img


DEFAULTS = {"face": ("right", "middle"), "bold": ("left", "top"), "moment": ("left", "bottom")}


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--type", choices=["face", "bold", "moment"], required=True)
    p.add_argument("--frame", required=True, help="a clean film frame, 16:9")
    p.add_argument("--text", required=True, help="2-4 words; | breaks a line")
    p.add_argument("--passage", required=True, help='e.g. "LUKE 5:1–11" / "ОТ ЛУКИ 5:1–11"')
    p.add_argument("--focus", type=float, default=0.5, help="horizontal crop focus 0-1")
    p.add_argument("--zoom", type=float, default=1.0, help="crop in, e.g. 1.25")
    p.add_argument("--side", choices=["left", "right"], help="where the text sits (default per type)")
    p.add_argument("--valign", choices=["top", "middle", "bottom"], help="text height (default per type)")
    p.add_argument("--out", required=True)
    a = p.parse_args()
    side, valign = DEFAULTS[a.type]
    img = load_frame(a.frame, a.focus, a.zoom)
    img = {"face": face, "bold": bold, "moment": moment}[a.type](
        img, a.text, a.passage, a.side or side, a.valign or valign
    )
    img.convert("RGB").save(a.out, quality=92)
    print(a.out)


if __name__ == "__main__":
    main()
