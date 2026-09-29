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

## YouTube-only work (16:9), as of 2026-09-29

The owner is focusing on the wide cut: this material suits YouTube better than a
feed. Everything in this section is 16:9 ONLY and must not be added to the
vertical cut without her asking for it. The vineyard (`devo_h_vineyard.mp4`,
Matthew 20:1-16, LUMO) is the reference cut.

### Opening: the montage (`--intro=montage`, current)

- The narration is a short scripted question, one line per shot, male voice
  (`voices.hook`). No welcome, no logo: the film's own shots carry it.
- One shot of the film per spoken line (`--intro-shots`, source seconds), cut
  on the line's first word from the narration's word times. Each shot pushes
  in slowly (1 → 1.045, eased) and restarts on the cut. A shot must not cross a
  cut in the source: check the frames, not the timestamp.
- The narration is set in the middle of the frame, Literata, small (half the
  big caption size), the spoken word lit gold. On the lines that carry the
  contrast, a big caption sits under the small words (`--intro-captions
"2=The others worked|One hour"`: small part before the bar, big after); a
  line whose caption is the whole line shows only the big caption. The big
  caption comes in out of a slight blur, letters drawing in from wider
  tracking, and fades out. No answer is given in the opening.
- Pauses between lines: `--hook-gap=0.15` (the take's own 0.6s is too slow);
  0.4s before a lower-case continuation line; 0.9s before the last line.
- The last line is "Let's watch.": WATCH rises across the frame at 15% (the
  same whisper as REFLECT and PRAY) with the passage reference over it
  ("Matthew 20:1-16", Literata 48px on 1920, slow zoom), dissolving a little
  after WATCH. The scene starts on that line, over its first quiet seconds.
- Joining a new opening onto a finished video without a full render: cut right
  after "Let's watch" with a 0.5s crossfade. Past that point both videos show
  the same film frames at a fixed offset (find it by matching frames), and the
  film captions have not started yet. Never cut on a caption: the two renders
  may wrap it differently.
- The earlier `--intro=opening` (spoken welcome, title written word by word in
  gold, DAILY BIBLE PAUSE kicker after the logo collapses) still works and is
  the fallback.

### Vertical teaser from the montage (`--intro=montage --teaser-intro`)

- Same shots and voice; the last line is a call to action ("Watch the full
  devotional on our YouTube channel.") instead of "Let's watch", over the
  scene's first frames. Only the film card is kept, no film captions.
- Captions: the compact phrase style (mixed sizes, content words large,
  function words small, uppercase, newest word gold cooling to white); the big
  caption's words are the ones set large and gold. Long lines split into
  phrases of at most seven words.
- `--intro-focus` gives the horizontal crop per shot (a 9:16 window keeps a
  third of the frame; aim it at the face). `--voice-level=0` mutes the film;
  no music (owner). `--no-step-ring`.

### Reflection and captions

- **Film captions**: the whole line stays up in white; the spoken word turns
  gold with a faint glow and grows ~4% (a transform, so the line never
  reflows; constant 0.05em side margins keep the gap). Word times come from the
  film's own audio, in the source's `.words.json` next to its cue file.
- **Reflection text** sits 128px off the bottom (px(46.2)); film captions 118px.
- **Source marks** (owner's Figma "Attribution", 2026-09-28): centred over the
  text. Avatar on top (a portrait in a 70px ring for a person; a line emblem,
  scroll or book, for a reference work), a divider of two tapering rules with a
  gold dot, then the label (Inter 500 caps, section name only, no "from") and
  the source (Literata). Opens from the middle: dot, rules drawing outward,
  then avatar, label and source fading in. At least 5s on screen at 85%, on
  its own layer above the one-sentence cards, above the tallest sentence it
  spans. Labels: HISTORICAL CONTEXT, ORIGINAL LANGUAGE, COMMENTARY. A person is
  credited with life dates, never a publication year ("J. C. Ryle
  (1816–1900)"); "adapted from" and the full citation go in the description.
  Scripture is never credited on screen: chapter and verse go inline in the
  text.
- Images need clean provenance: public-domain scans (Internet Archive,
  Wikimedia, CC0 museums), never a stock copy of an old engraving.
- **No closing credit** when the reflection carries source marks.
- **Takeaway card**: bare, no rules above or below it.
- **Pauses**: the verse holds one second after the voice; two seconds of
  silence between the question and the prayer (widened in the take).
- **Progress ring**: on the question card only, under the prayer, left-aligned
  with the text, appearing when the voice has finished.
- **Voices by section**: female for the reflection, conclusion and verse; male
  for the opening, historical and language notes, the step into PRAY and the
  question.

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
