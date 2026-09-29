# Devotional look — the agreed design, per aspect

Status: agreed with the owner on 2026-09-24. This file is the source of truth for
how a Daily Bible Pause devotional looks. If a render disagrees with this file,
the render is wrong.

It exists because the same decisions have already been lost once across sessions.
Anything already expressed in code is named with its file, not restated.

## The rule that generates most of the others

**Portrait and landscape are two different designs, not one design scaled.**

A 9:16 cut plays inside a feed. Instagram, TikTok, YouTube Shorts and Facebook all
paint their own chrome — handle, caption, sound pill, action rail — over the top
strip and the bottom third. Anything the composition draws up there is covered, and
looks like a bug when it is half covered.

A 16:9 cut plays in a player with no overlay. The top strip is free, so a persistent
progress element belongs there, and the centre stays clear for the film.

## Vertical, 9:16 (feeds)

- **Stepper: the vertical column, in the middle of the hand-over screen.**
  `StepperStack` with `variant="line"`
  (`packages/shorts-compositions/src/devotional/Stepper.tsx`). The rail draws down
  from the step just finished onto the next one, which then warms to gold, grows
  slightly and comes into focus. That arrival is what starts the new step.
- **The corner progress ring stays.** `StepRingOverlay` with `shape="ring"` —
  it sits clear of the feed's chrome and is how a vertical viewer knows how far
  through the current stage they are. It is the portrait default; do not drop it.
- **Nothing across the top.** No step row, no progress hairlines. The social UI
  owns that strip.
- **No big translucent step word.** That is a 16:9 device.
- Face-aware crop is ON (portrait only — see below).

## Landscape, 16:9 (YouTube)

- **Stepper: the named row across the top.** `StepRowOverlay` →
  `StepProgressLine.tsx`. Three names, the live one gold with a soft pulse,
  finished ones white, still-ahead ones dim, and the hairline between two names
  fills as that stage runs. Width variant B (794px in the owner's Figma).
- **Hand-over screens carry the step's NAME only**, centred, at 15% opacity,
  emerging from blur and dissolving slowly back into it (`BigStepWord.tsx`).
  No stepper in the middle: the top row already says where the viewer is.
- **Opening: three beats, timed to the voice** — the logo slides down under
  "Welcome to Daily Bible Pause"; the second sentence arrives word by word as it
  is spoken; then the step row appears at the top with a large translucent WATCH
  in the middle, under "Let's watch". The film is blurred through the opening and
  the blur lifts as the voice finishes.
- **No face-aware crop.** It re-frames between shots and reads as camera jerk in
  16:9. Gated in `devotional-render.ts` on `aspect !== "wide"`.

## YouTube-only work (16:9), as of 2026-09-25

The owner is focusing on the wide cut: this material suits YouTube better than a
feed. Everything in this section is 16:9 ONLY and must not be added to the
vertical cut without her asking for it.

- **The opening** (`--intro=opening`, revised 2026-09-26): the voice says
  "Welcome to Daily Bible Pause." while the brand mark performs slowly at the
  top and DAILY BIBLE PAUSE settles under it. The title is written word by word
  as the voice reads it, then each under-line the same way, the third replacing
  the second in one slot. Every word arrives gold with a faint glow and cools
  to white. On "Let's watch." the lines leave and WATCH rises across the frame
  at 15%, the same whisper as REFLECT and PRAY, then the film. The welcome and
  "Let's watch" are spoken, never drawn as lines (`frameOpening`). The film
  underneath stays sharp under a light scrim.
- **Film captions**: the whole line stays up in white; the word being spoken
  turns gold (karaoke). Word times come from the film's own audio, in the
  source's `.words.json` next to its cue file.
- **Source marks**: an avatar in a circle (a portrait for a person, a line
  emblem for a reference work), a small caps label, the source in the serif
  below, a hairline under it. Left-aligned at the text box's left edge (x 280
  of 1920), above the tallest sentence it spans. One sweep left to right: the
  hairline draws and the words follow behind a soft edge. At least five
  seconds on screen, at 85% opacity, then a fade. Drawn on their own layer so
  they outlast the one-sentence cards. On the vineyard: HISTORICAL NOTE FROM /
  Society of Biblical Literature (book); GREEK VOCABULARY / the Greek (scroll);
  REFLECTION ADAPTED FROM / J. C. Ryle (1816–1900) (portrait), placed where
  the part built on his text begins. Life dates, never a publication year.
  Scripture is never credited on screen: chapter and verse go inline in the
  text and the translation is not named.
- **No closing credit** when the reflection carries source marks: the credit
  was already given inline.
- **Takeaway card**: bare, no rules above or below it.
- **Pauses**: the verse holds one second after the voice; two seconds of
  silence between the question and the prayer.
- **Voices by section** (being tried): female opens, male reads the historical
  and language notes, female reads the reflection, male closes on the question
  and prayer.

## Shared by both

- **Structure** is clip-first: film → WATCH→REFLECT → reflection cards →
  conclusion → scripture → REFLECT→PRAY → question and prayer.
- **Type**: Literata everywhere, with one deliberate exception — the Bible verse
  stays Source Serif 4, whose italic the owner prefers.
- **Accent**: gold `#f2c46b` — the live step, the strong words in a quote, the
  "LET'S WATCH" invitation and its arrow.
- **Teaser** (14.5s, vertical): the typed quote, two questions, then the call to
  action. `--cta-label=` (empty) names no destination, for feeds where pointing at
  YouTube is wrong; a non-empty label prints under the CTA in gold.
- Motion is gentle by default: about a second, eased, no snap.

## Where this is enforced in code

`DevotionalVideo.tsx` derives both aspect-specific rules from `useVideoConfig()`:

- the hand-over screen renders `BigStepWord` only when `isLine && isLandscape`,
  and `StepperStack` otherwise;
- `StepRowOverlay` renders only when `width > height`.

Both branches carry a comment naming this decision and its date. Do not "unify"
them.
