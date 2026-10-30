---
name: dbp-covers
description: Make Daily Bible Pause YouTube covers (thumbnails) from a film frame without Figma, in the series' three looks (face, bold words, story moment), in any language. Use whenever a team needs covers for a long-form devotional, a thumbnail test (3 covers), or a cover in another language.
---

# Daily Bible Pause: covers

Every long form gets 3 covers for YouTube's "Title and thumbnail" test, one of each look. `scripts/make_cover.py` builds them from a clean film frame (no subtitles or overlays) with the bundled fonts (Literata, Montserrat, Inter; all OFL, with Cyrillic).

| Look     | Frame                                                       | Text                                                                                   |
| -------- | ----------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `face`   | a face in the moment of the story; space on the right       | serif title on the right, last line gold; gold passage label above                     |
| `bold`   | a close, emotional shot; space on the left                  | 2-4 heavy caps words (often a quoted line), orange rule, passage label                 |
| `moment` | the story's object or event (the catch, the roof, the coin) | gold pill with the short passage ("LUKE 5"), sentence-case headline at the bottom left |

```bash
python3 scripts/make_cover.py --type face --frame f.jpg --focus 0.3 --text "Not this|close." --passage "LUKE 5:1–11" --out cover_face_EN.jpg
python3 scripts/make_cover.py --type bold --frame f.jpg --text "Отойди|от|меня" --passage "ОТ ЛУКИ 5:1–11" --out cover_bold_RU.jpg
```

`|` breaks a line. Output is 1600x900 JPG. The layout adapts to the frame:

- `--side left|right` and `--valign top|middle|bottom` put the text where the frame has room (defaults: face right/middle, bold left/top, moment left/bottom). The shading follows the text.
- `--focus` (0-1) moves the crop left or right; `--zoom` crops in.
- Text size fits itself to the space: short phrases come out larger.
- When asked for a different look (colour, size, position), edit `scripts/make_cover.py`; it is plain Pillow code.

## Rules

- **Text**: 2-4 words, for recognition, not search; never a repeat of the video title; literally true to the passage. The passage label stays.
- **Frame**: a clean frame from the film (download the film itself; never grab a frame from our own video, which has titles on it). No text over a face; nothing in the bottom-right corner (YouTube shows the duration there).
- **Rotation**: the cover type that leads the test alternates video to video on each channel, so the grid shows different looks side by side.
- **Each language** gets its own set with the same frames and its own words (Russian: «ОТ ЛУКИ 5:1–11»).
- **Check every cover before showing it (required)**: open the JPG and look at it. If text lies over a face or a key object, is cut at an edge, sits in the bottom-right corner, or is hard to read at phone size (shrink it to 320 px wide), change `--side`, `--valign`, `--focus`, `--zoom`, the line breaks or the frame, and render again. Only then show it. Finally compare all three side by side and with the previous video's cover.

Figma remains fine for anyone who prefers it; this template gives the same look without it.
