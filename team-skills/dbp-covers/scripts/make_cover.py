#!/usr/bin/env python3
"""Make a Daily Bible Pause YouTube cover from a film frame.

Three looks, matching the series covers made in Figma:
  face    - a face shot; serif title on the right, last line gold, gold passage label above
  bold    - 2-4 heavy caps words on the left, orange rule, passage label under it
  moment  - the story moment; gold pill label and a sans headline at the bottom left

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


def face(img, text, passage):
    img = Image.alpha_composite(img.convert("RGBA"), gradient("right", 0.42, 1.0, 175))
    d = ImageDraw.Draw(img)
    right, max_w = W - 96, 700
    f, lines, size = fit(text, "Literata-ExtraBold.ttf", max_w, 420, 190, d, 1.02)
    block_h = len(lines) * size * 1.02
    top = H * 0.56 - block_h / 2 + 40
    label = font("Inter-SemiBold.ttf", 44)
    tracked(d, (right, top - 82), passage.upper(), label, GOLD, 3, anchor_right=True)
    for i, line in enumerate(lines):
        color = GOLD if i == len(lines) - 1 and len(lines) > 1 else WHITE
        d.text((right, top + i * size * 1.02), line, font=f, fill=color, anchor="ra")
    return img


def bold(img, text, passage):
    soft = img.filter(ImageFilter.GaussianBlur(10))
    mask = gradient("left", 0.45, 0.9, 255).getchannel("A")
    img = Image.composite(soft, img, mask)
    img = Image.alpha_composite(
        img.convert("RGBA"), gradient("left", 0.38, 1.0, 150, tint=(120, 62, 22))
    )
    img = Image.alpha_composite(img, gradient("left", 0.45, 1.0, 90))
    d = ImageDraw.Draw(img)
    left = 76
    f, lines, size = fit(text, "Montserrat-ExtraBold.ttf", 640, 560, 168, d, 1.0, upper=True)
    top = 80
    for i, line in enumerate(lines):
        d.text((left, top + i * size * 1.0), line, font=f, fill=WHITE)
    y = top + len(lines) * size * 1.0 + 26
    d.rectangle([left, y, left + 270, y + 14], fill=ORANGE)
    label = font("Inter-SemiBold.ttf", 42)
    tracked(d, (left, y + 40), passage.upper(), label, WHITE, 2)
    return img


def moment(img, text, passage):
    img = Image.alpha_composite(img.convert("RGBA"), gradient("bottom", 0.4, 1.0, 200))
    d = ImageDraw.Draw(img)
    left = 76
    f, lines, size = fit(text, "Inter-ExtraBold.ttf", 960, 320, 144, d, 1.06)
    bottom = H - 70
    top = bottom - len(lines) * size * 1.06
    for i, line in enumerate(lines):
        d.text((left, top + i * size * 1.06), line, font=f, fill=WHITE)
    label = font("Inter-Bold.ttf", 46)
    cap = passage.upper()
    tw = d.textlength(cap, font=label) + 3 * (len(cap) - 1)
    py = top - 112
    d.rounded_rectangle([left, py, left + tw + 56, py + 82], radius=10, fill=PILL)
    tracked(d, (left + 28, py + 14), cap, label, INK, 3)
    return img


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--type", choices=["face", "bold", "moment"], required=True)
    p.add_argument("--frame", required=True, help="a clean film frame, 16:9")
    p.add_argument("--text", required=True, help="2-4 words; | breaks a line")
    p.add_argument("--passage", required=True, help='e.g. "LUKE 5:1–11" / "ОТ ЛУКИ 5:1–11"')
    p.add_argument("--focus", type=float, default=0.5, help="horizontal crop focus 0-1")
    p.add_argument("--zoom", type=float, default=1.0, help="crop in, e.g. 1.25")
    p.add_argument("--out", required=True)
    a = p.parse_args()
    img = load_frame(a.frame, a.focus, a.zoom)
    img = {"face": face, "bold": bold, "moment": moment}[a.type](img, a.text, a.passage)
    img.convert("RGB").save(a.out, quality=92)
    print(a.out)


if __name__ == "__main__":
    main()
