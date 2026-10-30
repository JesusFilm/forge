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

`|` breaks a line. `--focus` (0-1) moves the crop left or right; `--zoom` crops in. Output is 1600x900 JPG.

## Rules

- **Text**: 2-4 words, for recognition, not search; never a repeat of the video title; literally true to the passage. The passage label stays.
- **Frame**: a clean frame from the film (download the film itself; never grab a frame from our own video, which has titles on it). No text over a face; nothing in the bottom-right corner (YouTube shows the duration there).
- **Rotation**: the cover type that leads the test alternates video to video on each channel, so the grid shows different looks side by side.
- **Each language** gets its own set with the same frames and its own words (Russian: «ОТ ЛУКИ 5:1–11»).
- **Check before sending**: look at all three side by side at small size (as on a phone) and with the previous video's cover; words readable, nothing cut at the edge.

Figma remains fine for anyone who prefers it; this template gives the same look without it.
