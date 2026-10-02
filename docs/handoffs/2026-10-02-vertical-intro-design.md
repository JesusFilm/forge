# Design spec: the vertical intro teaser and its kinetic captions

The owner's approved look for a 9:16 short (Prodigal teaser, variant B,
2026-09-30/10-01). Use it as THE reference style for the other shorts.

- **Reference video:** `~/Desktop/Social Media/Prodigal/teaser_prodigal_vertical.mp4`
  (calm CTA + ney bed). Variants she compared: `Prodigal/archive/tests/teaser-variants/`.
- **Memory rule:** `devotional-vertical-intro-teaser.md`.
- **Code:** `packages/shorts-compositions/src/devotional/KineticCaption.tsx`
  (`KineticCaption` layout "stack", `portrait`, `sizes`; `CalmCallToAction`) and
  the teaser branch of `ClipIntro` in `DevotionalVideo.tsx`
  (`if (cta && !wide && kinetic.length)`).

## The picture

- Full-bleed 9:16 film shots, one shot per spoken line (`--intro-shots`, source
  seconds), cut on the line starts; horizontal crop per shot with `--intro-focus`.
- One even dim over everything: black at 25%. Under each line, a bottom
  gradient (black 55% at the bottom → 12% at 45% height → clear at 70%).
- **Jesus Film mark** animates at the top centre (top 9%, the opening's stamp →
  morph over 3.6s) and fades out just before the last line (0.8s → 0.1s
  before it).
- **No film/LUMO mark** in the corner, no step ring, no stepper.

## The kinetic captions ("stack" layout)

Each spoken line is shown whole, as a poster block of words of different sizes,
left- or right-aligned to the frame's open side (`side` per line). The block
sits in the lower half: `bottom: 27%`, inset 28 units from the edge, never wider
than the frame minus both insets. It may overlap the picture (owner: "не бойся,
чтобы он перекрывал картинку").

Three roles per line, set with `--intro-kinetic="idx=hero/accent1,accent2/side;..."`:

| Role                                                              | Face                             | Size (units) | Style                                                                                   |
| ----------------------------------------------------------------- | -------------------------------- | ------------ | --------------------------------------------------------------------------------------- |
| **hero** (the phrase that carries the line, e.g. "THE BEST ROBE") | Literata 500, CAPS, tracking 1.2 | 46 × 1.3     | white #ffffff; shrinks only if it would not fit the width (measured with the real font) |
| **accent** (1–2 words, e.g. "squandered")                         | Literata 400 _italic_            | 24 × 1.4     | gold #f2c46b                                                                            |
| **plain** (the connective words)                                  | Inter 600, CAPS, tracking 2.2    | 10.5 × 1.6   | warm white #f4efe8                                                                      |

Units: `px(n)` keyed to the frame's short side (390 reference), × 390/360 in
the teaser. Words are grouped into lines: the hero run on its own line; other
words in runs of at most three, a run closing after a content word or an
accent (so no line ends on "the"). Lines stack with a 7-unit gap. Every word
has a soft shadow (0 2px 18px black 55%).

**Motion:** each word arrives WITH the voice (word timings from ElevenLabs):
from 0.05s before its spoken start to 0.45s after, eased (cubic-bezier 0.16, 1,
0.3, 1): opacity 0 → 1, rises 18% of its size, blur 8% of its size → 0. A line
fades out over its last 0.35s; the next line's block replaces it.

## The ending (calm CTA, the approved default)

The last line ("Watch the full devotional on our YouTube channel.") is NOT
another kinetic stack. It is one centred sentence, sentence case, Literata
400 at 30 units, line-height 1.25, max 80% of the frame width, at `bottom:
30%`, under a short gold hairline (34 units wide, grows in 0.3–1.6s). It fades
up as a whole over 1.3s with a 6-unit rise (cubic-bezier 0.33, 0, 0.2, 1) and
holds to the end (1.6s after the voice). Its own gradient: black 50% → 15% at
half height → clear at 75%. `--cta-style=kinetic` gives the older loud ending.

Shorts other than the intro teaser carry NO CTA (owner, 2026-10-01): the post
caption says where the full devotional is.

## Sound

- Voice: the opening lines as in the long-form (Eleven v4 hook). Pauses between
  lines 0.15s (`--hook-gap=0.15`).
- Music: an eastern bed under the voice, chosen per story by the owner
  (Prodigal: ney; Martha: duduk + oud, warm, never minor).

## The exact command (Prodigal)

See `docs/handoffs/2026-10-01-devotional-shorts-cutdown-handoff.md`, section
"What already exists", for the full `render-one-devotional.ts` call with
`--aspect=portrait --teaser-intro --intro=montage --intro-shots --intro-focus
--intro-kinetic --music-file`.
