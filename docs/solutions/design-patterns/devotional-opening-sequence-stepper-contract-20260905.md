---
title: "The devotional opening-sequence contract: cover, stepper, scripture"
date: "2026-09-05"
category: design-patterns
module: packages/shorts-compositions/src/devotional
problem_type: design_pattern
component: service_object
severity: medium
applies_when:
  - Adding, reordering or restyling a screen in the devotional's opening sequence
  - Moving a spoken connector between narration segments or onto its own card
  - Aligning on-screen text to ElevenLabs word timings, especially on a step card
  - Choosing how to review a devotional before paying for a full render
  - Localising the devotional's spoken connectors
resolution_type: tooling_addition
related_components:
  - tooling
  - development_workflow
tags:
  - devotional-pipeline
  - remotion
  - opening-sequence
  - stepper
  - narration-timing
  - review-workflow
---

# The devotional opening-sequence contract: cover, stepper, scripture

## Context

The daily devotional is a ~3:20 vertical video: Mastra writes the text,
ElevenLabs narrates one MP3 per card, and the Remotion `devotional` composition
renders a manifest of cards. The owner is not an engineer; she reviews by
watching. Over several rounds of animated tests she settled a set of decisions
about the first ~25 seconds — the part that decides whether anyone keeps
watching — and asked that they apply to every future devotional rather than be
re-litigated per video.

Most of these decisions already live as doc comments in the code
(`Stepper.tsx`'s header, `CoverIntro`, the `step` and `scripture` branches of
`renderCardBody`). This document is the contract those comments imply, plus the
two mechanical traps that let you break it with no error anywhere.

## Guidance

### 1. Three screens, in this order: cover → stepper → scripture

The stepper exists because viewers did not understand the structure of the
videos. The four stages — `DEVOTIONAL_STEPS = ["READ", "WATCH", "REFLECT",
"PRAY"]` in `schema.ts` — are shown explicitly, not implied. A `step` card
appears before each stage; `stepIndex` (0 = READ) says where the light lands,
everything before it is gold, everything after is dim.

**The stepper is a flag, not a fork.** `buildNarrationSegments(..., { steps:
true })` emits the `step-*` segments; `buildDevotionalManifest` emits a `step`
card only when the matching segment exists (`stepCard()` returns `null`
otherwise), so with the flag off the running order is what it always was. The
locale composes both paths from the _same_ `connectors.steps` strings, so the
flag changes **where** a phrase is spoken, never **whether** it is.

```ts
// apps/mastra/src/services/devotional/devotional-locale.ts (EN)
steps: {
  intro:   () => `Let’s pause and let Scripture speak`, // no full stop: also shown
  read:    (ref) => `Here's where we're reading today.${ref ? ` ${ref}.` : ""}`,
  watch:   () => `Let's watch.`,
  reflect: () => `Reflect on this.`,
  pray:    () => `Let's bring this to God.`, // owner's pick over "Here's something to sit with."
}
```

The flag must reach **every** call to `buildNarrationSegments` in a run —
production, the staleness check and the approval fingerprint each rebuild the
list. A flag that reaches one but not the others produces a manifest with step
cards and no step audio, or the reverse, silently. (This has already happened
once; it was caught by arithmetic in the log — "reused 15, synthesised 1" was
the old segment count, not the new one.)

### 2. Cover

- **The title types in with the voice from frame 0.** With `titleWords` present
  the block-level rise/fade is suppressed and `WordReveal` drives it.
- **The logo stamps at a fixed 2 seconds** (`LOGO_DELAY_SEC`), not after the
  spoken hook. Waiting for the voice put the mark in the last second of a short
  cover, with the credit behind it.
- **The date slot is empty** — no date, and no "Today's Devotional" label filling
  its place. `devotional-render.ts` passes `hideCoverDate: true` unless an
  explicit `coverDateLabel` overrides it. The reason is a beat, not a
  preference: the label used to wipe open _after_ the mark had settled, and the
  owner wants the opening animation to end when the logo becomes the small
  symbol. **This supersedes the older rule "never a date — always TODAY'S
  DEVOTIONAL"**, which is still quoted in `DEVOTIONAL-HANDOFF.md`.
- **The reflection credit renders inline**, in the slot the settle line used to
  hold — directly under the title, uppercase, `rgba(255,255,255,0.5)`, regular
  weight ("just text": the author's name is not emphasised over the rest of the
  line). Pinned to the bottom edge it was so faint and so far from everything
  else that the owner read it as missing. It starts **0.6s after the logo**
  (`delaySec={(logoDelay + 0.6 * fps) / fps}`) because it belongs to the lockup.
- **The card ends as soon as the hook is spoken.** No `holdSec`: the logo and
  credit now land _inside_ the hook rather than after it.
- **Never show a line the voice does not say.** With the stepper on, the settle
  line's job moves to the stepper's opening line, so `connectors.cover(...,
omitSettle)` drops it from the narration and the manifest omits `settleLine`.

### 3. Stepper

**One card, two spoken beats, one narration segment.** A card plays exactly one
audio file, and the owner wanted one screen rather than a crossfade between two
near-identical stepper frames. So `step-read` is narrated as a single segment
carrying both beats:

```ts
const intro = c.steps.intro()
segments.push({
  id: "step-read",
  text: `${ensureTerminal(intro)} ${c.steps.read()}`, // spoken: both beats
  display: intro, // on screen: the line only
})
```

The composition finds the hand-over point in the word alignment, not at a fixed
time:

```ts
const headlineTimings =
  card.headline && card.words
    ? alignWordsToText(card.headline, card.words)
    : null
const lineEndsSec = headlineTimings
  ? headlineTimings[headlineTimings.length - 1].endSec + leadSec
  : null
const lightStart = lineEndsSec != null ? lineEndsSec + 0.15 : 0
```

**The line is on screen from the start, faint, and the voice fills it in.**
`WordReveal` with `preOpacity={0.32}` and `restColor="#ffffff"`: each word warms
to the accent as the voice reaches it and settles to white behind it. This is
the opposite of the reveal used elsewhere (`preOpacity` 0, where the sentence
builds word by word) — here the line must be readable before it is read.

**The light does not exist until the line is finished.** `lightOpacity` ramps
0 → 1 over `[lightStart, lightStart + 0.35]` and `StepperStack` skips the glow
layers at 0. Lighting a stage while all four are still ahead says something
untrue about where the viewer is.

**The line belongs to the READ screen only.** By WATCH the viewer has been in
the passage for a minute and it has nothing left to introduce, so the later step
cards carry no `headline`.

Earlier owner decisions, preserved in `Stepper.tsx`'s header comment and still
binding:

- No step label pinned at the top of the frame, and nothing entering or leaving:
  **only the light moves**, so there is one thing to track.
- Type is a **label (600 weight), not a headline** — round one read as too big
  and too heavy.
- **Upcoming steps sit at 22% opacity**; at 40% they competed with the active
  one. They are a promise, not the subject.
- **The outer pool of light is constant**; only the inner, more opaque element
  thins in transit, because that element is what read as a bead sliding across
  the frame. Driven by distance to the nearest step, so it needs no phase
  tracking and cannot fall out of step with the movement.
- **The word fills with the light** — a glow on the glyphs rather than merely a
  colour change. This was the detail the owner singled out.
- Both light layers are `mixBlendMode: "screen"` so the pool _adds_ light; in
  normal blend it vanished wherever the background clip was bright.
- The active step grows a little as the light arrives, not a lot (`scale(1 +
0.06 * near)`).
- The headline sits above the stack with a clear gap, serif italic 300 at
  `px(22)` — light, like the verse it introduces, and trimmed by 4 units after
  the owner saw it on screen.

### 4. The lead-offset trap

`STEP_LEAD_SEC = 0.9` is the silent head of a step card's narration. The
animation runs in that window so the light lands before the voice names the
step: when the move and the voice started together, the steps read as
"blinking" — neither had a moment of its own.

The lead is **baked into the audio as real silence after synthesis**
(`slowAndPad(bytes, 1, 0, STEP_LEAD_SEC)` in `audio-concat.ts`), not applied as
a playback delay in the composition, so the card's length and the delay stay one
number. The manifest reports the same constant back as `stepLeadSec`, imported
from `devotional-audio.ts` so the silence and the reported delay cannot drift.

**The consequence: ElevenLabs word times are relative to the pre-lead audio.**
Anything aligning text to those words on a step card must add the lead:

```tsx
<WordReveal timings={headlineTimings} audioDelaySec={leadSec} … />
const lineEndsSec = headlineTimings[headlineTimings.length - 1].endSec + leadSec
```

Get it wrong and every reveal shifts by 0.9s with no error: the render succeeds
and the words are simply out of step with the voice.

The same "times describe the audio as synthesised" rule governs every other
post-synthesis re-timing. `mergeUnitWords` stitches per-unit alignments into one
timeline, shifting each unit by the previous units' spoken length plus the
inserted silence and stretching by `1 / tempo` for any unit slowed with
`atempo`. It returns `undefined` if **any** unit lacks alignment — a card gets a
whole trustworthy timeline or none, because a caption revealed against stale
timings is worse than one revealed at a steady pace.

### 5. Scripture

**The verse leads, the citation closes** — even though the voice says the
reference first. The owner asked the text not to wait: the verse unfolds
straight away and the citation appears under it at the end, once there is
something to attribute. Voice and text drift apart by a couple of seconds, which
she accepted explicitly. Do not "fix" this drift.

**The reveal pace is derived from the card's own duration, not fixed**, so a
two-line verse and a six-line one both read as unhurried instead of one racing
and the other stalling:

```ts
const VERSE_START_SEC = 0.3
const versePerChar = Math.min(
  0.06,
  Math.max(
    0.022,
    ((durationInFrames / fps) * 0.74 - VERSE_START_SEC) /
      Math.max(1, verseChars),
  ),
)
```

The card also hands over to the film: `watchStart` scans **backwards** through
the segment's word times for the "let's watch" tokens (the phrase is the tail of
the spoken scripture segment), fades the verse out 0.15s before it, and zooms
the label in centred at the moment the narration says it. With no word times the
card simply holds the verse.

### 6. `WordReveal`'s colour formulation: warm-from-rest, not cool-from-accent

```ts
const warm = restColor
  ? Math.min(
      interpolate(t, [w.startSec - 0.06, w.startSec + 0.06], [0, 1], clampBoth),
      interpolate(
        t,
        [w.startSec + 0.06, w.startSec + 0.06 + ACCENT_SETTLE_SEC],
        [1, 0],
        clampBoth,
      ),
    )
  : 0
```

The accent amount is a rise-then-fall envelope _around_ the moment the word is
spoken, starting and ending at the rest colour. The old form expressed it the
other way round — the word started in the accent and cooled towards rest — which
was fine while words appeared only when spoken. It broke the moment words had to
be visible _before_ being spoken (`preOpacity > 0`): every unspoken word sat
there in dim gold, because "not yet cooled" and "not yet spoken" are the same
state under that formulation.

### 7. Review affordances, and which question each one answers

| Flag / tool                                  | Costs                      | Proves                                                                                                                             |
| -------------------------------------------- | -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `--review`                                   | LLM calls only, **no TTS** | the words. Stops before any synthesis.                                                                                             |
| `--silent-preview`                           | nothing external           | pacing and structure with a synthetic voice. **Never persisted** — `saveCachedAudio` rejects `synthetic` segments at the boundary. |
| `--stop-before-render` + `preview-audio.mjs` | real TTS (cached after)    | the **soundtrack on the render's real clock**, in seconds. Narration + clip dialogue + music on the same timeline. No picture.     |
| `--stills=N` / `--stills-frames=a,b,c`       | one browser pass           | **layout**: type, colour, composition at chosen frames. No MP4.                                                                    |
| `--frame-range=START-END`                    | ~1/12 of a full encode     | **motion, with audio** — a real MP4 slice. 18s vs 3:22 for the opening.                                                            |

The rule the owner arrived at herself: **stills prove layout; only a rendered
slice proves motion.** The whole opening is motion — the logo stamp, the
travelling light, a verse unfolding — so preview it with `--frame-range` before
paying for the full encode.

Two guards worth keeping, both there because the pipeline shipped the failure
once:

- `--frame-range` and `--stills-frames` are parsed **only when the flag is
  actually present**. `"".split(",")` is `[""]` and `Number("")` is `0`, a valid
  non-negative finite number — so parsing an unset flag the same way as a set
  one produced a phantom `[0]` on every normal render, replacing the MP4 with a
  single frame-0 PNG while still logging DONE and exiting 0.
- In stills mode the CLI does not name an MP4 in its success line, and
  `nextFreePath` is skipped so a preview does not burn the next version number.

## Why This Matters

The opening is the retention decision: a viewer either understands what the next
three minutes hold or leaves. The stepper exists because they did not
understand, and the cover's timing exists because a hook waiting behind a logo
or a date is a hook nobody hears.

These are also decisions that cost real money and real hours to re-derive. Every
line above is the surviving end of a review round — three rounds for the stepper
alone. Re-litigating "should upcoming steps be at 40%?" or "shouldn't the
citation lead, since the voice says it first?" burns a render cycle to arrive
back where the code already is.

And two of these items have no failure signal at all. Getting `audioDelaySec`
wrong on a step card, or omitting `steps: true` from one of the three
`buildNarrationSegments` call sites, produces a clean render, a green exit and a
video that is subtly wrong — the same silent-wrong-output class as the narration
reuse bug. The only detector is someone watching, which is exactly why the cheap
review affordances matter: `--frame-range` turns "someone watches the opening"
from a 3:22 encode into an 18-second one, which is the difference between a
check you run and one you skip.

## When to Apply

- Adding, reordering or restyling any of the three opening screens.
- Changing what the voice says on a cover or step card, or moving a spoken
  connector between cards (see the companion bug doc — moving a connector is
  exactly what broke narration reuse).
- Writing composition code that aligns on-screen text to ElevenLabs word
  timings, especially on a `step` card.
- Localising: the `connectors.steps` block must exist for the locale. The
  Russian wording is a first draft awaiting a native speaker, and RU
  deliberately still opens with the date — the English "hook first, no date"
  change was made for the English series only.
- Deciding which preview answers the question you actually have.

## Examples

**Adding a spoken beat to a step card** — extend the segment's `text` (spoken),
leave `display` as the on-screen line, do not add a second card:

```ts
segments.push({
  id: "step-read",
  text: `${ensureTerminal(intro)} ${c.steps.read()}`,
  display: intro,
})
```

Then read the hand-over point off the alignment and add the lead. Wrong, and
silently 0.9s early on every reveal:

```tsx
<WordReveal timings={headlineTimings} audioDelaySec={0} … />
```

**Making a line readable before it is spoken:**

```tsx
<WordReveal
  timings={headlineTimings}
  audioDelaySec={leadSec}
  restColor="#ffffff"
  preOpacity={0.32}
  style={style}
/>
```

**Reviewing cheaply — text, then sound, then motion, then the full encode:**

```
--review                              # words only, no TTS spend
--silent-preview                      # pacing, no external calls, never cached
--stop-before-render                  # then preview-audio.mjs on the stage dir
--stills-frames=0,60,150,420          # layout at chosen beats
--frame-range=0-540                   # ~18s of real motion, with audio
```

**Adding a cover element** — anchor it to a beat that already exists rather than
to the end of the cover animation. The credit follows the logo
(`logoDelay + 0.6s`); the logo is a fixed 2s from frame 0. At 96% of a short
card there is no time left for anything to finish animating.

## Related

- `packages/shorts-compositions/src/devotional/DevotionalVideo.tsx` —
  `CoverIntro`, `AttributionCredit`, `WordReveal`, `alignWordsToText`, the
  `step` and `scripture` branches of `renderCardBody`.
- `packages/shorts-compositions/src/devotional/Stepper.tsx` — `StepperStack` and
  the owner-decision header comment. `StepperTest.tsx` shares the component, so
  what was approved in the design tests is literally what ships.
- `packages/shorts-compositions/src/devotional/schema.ts` — `DEVOTIONAL_STEPS`,
  `stepIndex`, `headline`, `stepLeadSec`, `settleLine`, `words`.
- `apps/mastra/src/services/devotional/` — `devotional-audio.ts`
  (`STEP_LEAD_SEC`, `mergeUnitWords`, `buildNarrationSegments`),
  `devotional-locale.ts` (`connectors.steps`, `omitSettle`),
  `devotional-manifest.ts` (`stepCard`), `audio-concat.ts` (`slowAndPad`).
- `apps/shorts-worker/scripts/render-devotional-video.mjs` (`--frame-range`,
  `--stills-frames`) and `preview-audio.mjs`.
- `docs/solutions/logic-errors/narration-cache-keyed-on-display-instead-of-spoken-text-20260905.md`
  — the bug this change exposed.
- `docs/solutions/developer-experience/measurement-driven-layout-iteration-chrome-mcp-20260505.md`
  — the same "cheap measurable proxy instead of eyeballing" idea, for web layout.
- This render is a **local script path**
  (`apps/shorts-worker/scripts/render-devotional-video.mjs`), not the HTTP job
  service described in
  `docs/solutions/architecture-patterns/smart-crop-three-app-decomposition-20260610.md`
  — the manager JobRecord contract does not apply here.
