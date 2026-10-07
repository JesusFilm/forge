# Devotional look: Shorts Studio components

Sources of the custom components our devotional shorts use in Shorts Studio
(manager.jesusfilm.org/dashboard/shorts). Studio keeps the uploaded code; this
folder keeps what it was built from, so a component can be changed and
re-uploaded from any machine.

| Source | Studio version id | What it draws |
| --- | --- | --- |
| `film-look.tsx` | `film-look-v1` | Dim, grade, grain, vignette and the fade from/to black over the clips |
| `kinetic-question.tsx` | `kinetic-question-v2` | Voice-synced caption lines (hero word, accents, `wordTimes`) |
| `history-credit.tsx` | `history-credit-v1` | Book icon, "Historical Context", "SOURCE: …" |
| `serif-line.tsx` | `serif-line-v1` | One PT Serif italic line ("From Full Devotional") |
| `close-question.tsx` | `close-question-v1` | The silent closing line |
| `brand-mark.tsx` | `brand-mark-v1` | The Jesus Film mark of the vertical teaser |

Build (embeds the fonts and the lockup, writes `dist/`, compares each build
with the version uploaded to Studio):

```bash
node apps/mastra/studio-components/build.mjs
```

Rules Studio sets for component code: one default-exported React function,
imports only `react` and `remotion` (AbsoluteFill, useCurrentFrame,
useVideoConfig, interpolate, spring, Sequence, Easing), no files, at most
32768 bytes. Fonts are subset WOFF2 (Literata, Inter, PT Serif, all SIL Open
Font License) embedded as base64 and registered with `FontFace`.

Not here: `kinetic-question-v1` (superseded by v2).
