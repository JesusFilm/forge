# Devotional shorts playbook

How to cut a finished long-form Daily Bible Pause devotional into vertical
(9:16) shorts, as approved by the owner on the Prodigal Son (2026-10-01/02).
This is the reference for every future devotional. Code: feat-573
(`apps/mastra/src/scripts/cut-devotional-shorts.ts`,
`apps/mastra/src/services/devotional/shorts-cutdown.ts`,
`packages/shorts-compositions/src/devotional/ShortFact.tsx`,
`StampLine.tsx`, `ScrollingScripture.tsx`, `DevotionalVideo.tsx`).
Reference set: `~/Desktop/Social Media/Prodigal/shorts/`.

## 1. What a short is for

A short is not a summary. In 15 to 35 seconds it should stop a viewer, let
them see themselves in the story, and leave a reason to watch the full
devotional or send the short to someone.

The formula: **a hook in the first second, one idea, a turn toward the
viewer, an open door.** The reflection short worked first because it has
all four ("Picture the older son...", "Many of us... know exactly where he is
standing", and we leave him at the door).

What each short is for (owner, 2026-10-02):

- **intro** and **film-verse** sell the full devotional: they intrigue and
  send the viewer to the channel;
- **language** and **reflection** are the ones people share: a thought worth
  sending to a friend;
- **history** is an interesting fact that wakes curiosity.

Standing rules:

- No spoken hook or call to action added to shorts 2 to 5. The intro teaser is
  the only one with a CTA (its calm closing line).
- Silent on-screen lines (questions, turns) are allowed and are the main tool:
  they are stamped, never voiced, and cost nothing.
- Never invent content the devotional does not have. No language paragraph:
  no language short. No history paragraph: no history short.
- No em or en dashes in any on-screen text or caption copy.
- Zero new ElevenLabs spend: every voice comes from the long form's cache.

## 2. The set

Default set, in this order (`DEFAULT_SHORT_KINDS`):

| Kind         | Source in the long form                                         | Skipped when                                 |
| ------------ | --------------------------------------------------------------- | -------------------------------------------- |
| `intro`      | the montage opening, as the vertical teaser                     | no montage opening / no shots                |
| `film-verse` | the film window up to the verse the devotional quotes           | the quoted verse is not in the film captions |
| `history`    | the paragraph with role `history` (with its credit)             | no `history` paragraph                       |
| `language`   | the paragraph with role `language` + its verse callout          | no `language` paragraph                      |
| `reflection` | the first run of plain reflection that stands alone, 15 to 45 s | no run fits                                  |

`film-turn` and `question` exist in code but were dropped by the owner ("no
point"); cut them only with `--only=film-turn` / `--only=question`.

## 3. Inputs and the command

1. The long form must have a **source pack** beside its MP4
   (`<video>.source/`: manifest, every staged file, `devotional.json`,
   `render.json`). Every complete render writes one. For a devotional rendered
   before packs existed, re-run its exact long-form command with
   `--pack-only` and `ELEVENLABS_API_KEY=` (no encode, no TTS, ~2 min,
   ~290 MB). Check the log says `synthesised 0`.
2. Cut (run from `apps/mastra`, empty ElevenLabs key):

```bash
ELEVENLABS_API_KEY= pnpm exec tsx --env-file=.env.local src/scripts/cut-devotional-shorts.ts \
  --from="<video>.source" --out="$HOME/Desktop/Social Media/<Story>/shorts" \
  --film-open="<question>" --film-close="<turn>" --film-close-sub="The full story is on our channel." \
  --history-close="<turn>" \
  --intro-shots=<s,s,s,s> --intro-focus=<f,f,f,f,f> --intro-music=<bed.mp3>
```

Flags: `--only=<kinds>`, `--stills` (3 PNGs per short) or `--frames=30,120`
(exact frames) for previews without the encode, `--no-model` (rule-based
picks instead of the model), `--reflection=a-b` (paragraph range override),
`--history-no-hook` (keep the history lead-in), `--history-question` (append
the devotional's recorded personal question: tried, owner did not like it),
`--history-sub=` (quiet line under the history captions: owner said no on
Prodigal), `--allow-tts` (intro only, if its CTA line is not cached).
`--intro-*` flags are only needed for packs made before 2026-10-02; newer packs
carry the opening's shots, focus, kinetic picks and bed in `render.json`.

3. The intro is cut through `render-one-devotional.ts --teaser-intro` (the
   approved teaser recipe, `docs/handoffs/2026-10-02-vertical-intro-design.md`).
   By default it reuses the LONG FORM's opening voice from the narration cache
   (`devo/cache/ch<N>-seq<M>/audio`): the narrated text stays the long form's
   (its "Let's watch." included, so the cached take matches), the audio is cut
   before "Let's watch.", and the CTA is written on screen, silent, for 3.4 s
   (`--cta-text`). No new narration is ever needed. `--intro-voiced-cta`
   narrates the CTA instead (needs that take cached or a key). Intro shots and
   bed for older packs are in the story folder's README ("INTRO SETTINGS").
4. Outputs never overwrite: a taken name becomes `-v2`; move old takes to
   `archive/` (never hard-delete).

## 4. The texts the owner chooses

Three short shorts need a line written for this story. The agent proposes,
the owner picks (she wants to choose):

- **film-verse opening question** (stamped before the scene speaks). Ask the
  viewer to take a side on the verse. Prodigal: "Is this worth celebrating?"
- **film-verse closing turn** (stamped after the scene ends). Put the viewer
  in the shoes of the one the full devotional is about, without answering.
  Prodigal: "But someone had a good reason to stay outside." Under it, small:
  "The full story is on our channel."
- **history closing turn** (stamped after the voice ends). A curiosity twist
  from the low point to what follows, in modern words (not "the best robe":
  modern viewers miss what a robe meant; say "party"). Prodigal: "And this is
  the son who got the party." No small line under it.

Offer about ten options for each, mark two or three favourites, keep them
short (under ~8 words), plain modern English, no dashes.

## 5. Shared look

Frame 1080 x 1920. Figma frames are 900 x 1600, so Figma px are converted by
`f(n) = n * width / 900` (teaser-derived parts use their own units, noted).

**Safe zones (owner, insisted twice).** Every word must stay visible on any
phone under Reels / Facebook / TikTok UI:

- text columns 640 of 900 wide (about 156 px clear each side of 1080);
- nothing in the top ~270 px;
- text above ~1450 px (Meta's guidance is the bottom 35% clear; keep fact
  and reflection text above ~1250 where possible);
- nothing in the right action rail (x > 940, y 880 to 1500).
  Check stills with red zone overlays before delivering (ffmpeg `drawbox`).

**Background.** The long form's own footage under each sentence (bg.mp4 from
the long form's background position at that card, `bgStartOffsetSec`), cover
fit, a slow push 1.04 to 1.10, an even dim black 28%, and the Figma's soft dark
pool (radial black 0.75 centre, 900 x 759, blur 36.65) behind centred text.
The history short darkens behind its caption block instead (see 6.3).

**Fades.** In from black over 0.3 s (fact shorts) / 0.6 s (film short); out to
black over the last 0.6 / 0.9 s. Nothing should start appearing during the
fade-in if it must hit hard (the film question starts at 0.62 s).

**StampLine** (`StampLine.tsx`, the shorts' one treatment for short lines):
Inter 600, 76, caps, tracking 3.2 (fixed: animating tracking re-wrapped lines
mid-stamp and the line jumped), white, shadow 0 2 22 black 60%, centred.

- soft (reflection short lines, closing turns): 0.8 s, bezier(0.4,0,0.2,1),
  opacity 0 to 1, blur 7 to 0, scale x 1.06 to 1 / y 0.96 to 1.
- sharp (the film short's opening question): 0.32 s, bezier(0.2,0.9,0.3,1),
  scale 1.16 to 0.985 at the hit to 1 by 0.45 s, blur 4 to 0.
  Silent cards dim the frame to black 35 to 40% while up.

**Divider** (Figma 413-2480): 323 x 4, two light grey (#D9D9D9) wedges tapering
to the ends with a 4 px gold (#f2c46b) dot between, opacity 0.85; grows from
the centre.

**Credit emblems**: `AnimatedBook` / `AnimatedScroll` line art (pages turn /
scroll rolls once, ~1 s after appearing).

**Music.** Every short except film-verse carries the long form's own bed at
its level (`render.json` `musicVolume`, about 13 dB under the voice), in at
once (0.25 s ease) and out over the last 1.2 s. A bed opens with a fade-in and
a soft lead-in (Martha: full only from 16 s of 75), so a short started at 0
heard the music only in its last seconds (owner, 2026-10-05). The cutter reads
the bed's loudness per second and starts every short inside the stretch where
it is fully playing (within 8 dB of its typical loud level), spread across it
so they never sound the same: reflection at its start, history at 1/3,
language at 2/3 of the room left, the short staying inside the stretch when it
fits (`musicStartSec`, `MUSIC_START_SHARE`). The intro keeps
its own bed (Prodigal: ney). Film-verse: the film's sound only.

**Audio ends.** Never fade a voice or the film on its last words. The film
short's sound runs to the last half second; clips are trimmed through the
outro plus the card's 0.8 s breath so the picture never freezes.

## 6. Each short in detail

### 6.1 intro

The long form's montage opening in 9:16: same shots (one per line), same
voice, the approved kinetic "stack" captions (hero Literata caps, accent gold
italic, plain Inter caps), the Jesus Film mark animating at the top, a calm
centred CTA as the last line ("Watch the full devotional on our YouTube
channel."), and the story's eastern bed. The silent CTA cuts the long form's
take in the real pause before "Let's watch." (the longest silence in the 1.6 s
before the line's word time, 0.15 s in, 60 ms fade): word times can run 0.3 s
late, and cutting by them left "Let's" audible (`ctaCutSec`). Full spec:
`docs/handoffs/2026-10-02-vertical-intro-design.md`. About 20 s.

### 6.2 film-verse

Content: the quoted passage found by verse ADDRESS (every caption line tagged
with a verse in the scripture card's range, e.g. Luke 10:41-42), then whole
lines before it up to ~30 s, ending 0.5 s after the passage's last line.
Word matching (content words only) is the fallback when captions carry no
addresses; it failed on Martha because the devotional quotes BSB and the film
reads NIV. The window never starts inside its first line or takes the tail of
the line before, and widens into the quiet around it for the cards, never into
a neighbouring line.

Sound: the film's own sound only. A clip-first long form speaks its opening
over the film card; that narration is dropped from the short (Martha's first
cut had both voices at once).

Look (Figma 411-2366): film full frame; the film's narration as numbered
scrolling verses centred in a 660 wide block, five lines visible
(window 383), Literata 56 / line 1.25, heading = the verse range ("Luke
15:22-24") in PT Serif italic 32 over a hairline, the spoken word gold with a
1.1 stroke and a small lift, read words white 92%, unread 42%; the list drifts
continuously so the spoken line sits mid-window. Dark pool (peak 0.8) plus an
even dim 0.32 while the verses are up. Daily Bible Pause mark at the top
(book mark 49 wide, "DAILY BIBLE PAUSE" Inter 500 25 tracked 5, top 230), no
film mark.

Cards: opening question stamped SHARP from 0.62 s until 0.55 s before the
scene's first line; it needs 3.75 s of quiet, and when the scene has less the
lead is filled with live footage from the nearest earlier quiet stretch of the
same scene (no line spoken, 0.2 s clear each side), else the first frame is
held (last resort); the quiet before the scene's first line (establishing
shots) counts. Closing turn stamped SOFT 0.6 s after the last line, over the
scene still playing with sound; when the scene ends within ~4.4 s of its last
line (Martha: 1.5 s), the rest of the card's picture is a quiet stretch of the
same scene played live after the window (never footage already in it), and the
outro is lengthened to fit; the small line under it (PT Serif italic
32, 85%) eases in 1.0 to 1.8 s after. On-screen text credit is the film's
translation (LUMO reads NIV).

### 6.3 history

Content: the credited history paragraph alone (one thought, about 12 to 20 s;
extended by the next paragraph only below 10 s, never into another credited
fact; an uncredited paragraph of the SAME role is its continuation and may
join, as Martha's hospitality note runs over two paragraphs),
opening on its first short line (four words or fewer, within its first three
sentences: "Feeding pigs."), the lead-in dropped. Credit kept even when its
sentence is dropped.

Look (Figma 413-2407, revised): credit at the top 240, column gap 20: emblem
96 x 63 rotated -10.15 deg at 85%; "HISTORICAL CONTEXT" Inter 500 18 tracking 2
at 50%; source Literata 34 / 50 at 85%, one line; divider. The credit arrives
as a cascade: emblem 0.1 to 0.7 s (rise 10, scale 0.88 to 1), label 0.35 to
1.05 s (tracking closes from 8 to 2), source a word at a time from 0.55 s
(0.09 s apart, each 0.4 s, rise 10, blur 3), divider 0.95 to 1.75 s
(bezier 0.65,0,0.35,1).

Captions: the approved teaser "stack" style WITHOUT the gold: one line per
sentence (a long one split once, after a comma or before "and/but/so/because/
who/which/while/when", never after a function word, near the middle); each
line a block of hero (Literata 500 caps, 46 x 1.3 teaser units), accent
(Literata italic, 24 x 1.4, white #f4efe8 instead of gold) and plain words
(Inter 600 caps tracked 2.2, 10.5 x 1.6); teaser units are px(n \* 390/360)
on a 390 short side. Each word rises out of a blur with the voice (0.05 s
before to 0.45 s after its start, bezier 0.16,1,0.3,1, rise 18% of its size,
blur 8%). A line fades over its last 0.35 s. Blocks sit left, bottom at 38%
of the frame, never wider than the frame minus the rail, with their own dark
pool behind them (radial 0.62 / 0.38, inset 34 x 40 units, blur 14). A model
picks each line's hero (1 to 3 words, prefer a whole noun phrase) and accents
(0 to 2 words), checked against the line: a pick longer than three words keeps
its weightiest word, and empty words ("something", "thing") or function words
are never the hero; the fallback rule takes the longest content words. Long
sentences break after a comma first (strong preference), then before a
connector.

Ending: captions clear 0.5 s after the last word; the closing turn is
stamped soft over a 35% dim; the outro holds 3.8 s so it can be read. No
small line.

### 6.4 language

Content: the language paragraph and, when it is under 14 s, the next
paragraph so the thought lands ("...celebration is not optional"; Martha:
"Not a woman who refused Jesus, but a woman pulled away from him...").

Look (Figma 425-2722, revised 2026-10-05; no big gold quote marks any more):
"A Moment from the Full Devotional:" on top (the shared full-devotional label,
below); then a centred column at top 424, 640 wide, gap 28: the address
("LUKE 15:32", Inter 500 25 caps tracked 5 at 75%), the divider (grows with
the verse), the verse in PT Serif italic 56 / 1.45 at 85% (colour and
opacity), on screen from the first frame (fade 0.05 to 0.6 s).

The word: dimmed with the verse until the voice says it, then gold at full
strength (0.4 s) with a 1.4 gold stroke, no glow; a hand-drawn ring (an
ellipse overshooting its start, 1.12 turns, gentle wobble; rx = w/2 + 0.42h,
ry = h/2 + 0.24h, rotated -3 deg, stroke 4.6, round caps, soft shadow) draws
over 0.9 s from that moment, then "boils": three near-identical redraws
swapped four times a second. Calm, never jumpy.

Captions: the narration one word at a time on a gold tab (#f2c46b, radius 16,
padding 0 12) at top 1077: Inter Bold 56 / 89, normal case, no tracking, text
#140b05; a short function word rides with the next one ("the father", "to
celebrate"); each token pops in over 0.12 s (scale 0.9 to 1). No source on
screen: the lexicon goes in the caption credits.

### 6.5 reflection

Content: a run of plain reflection paragraphs (reflection / classic, no
credited fact) of 15 to 45 s that never opens on a back-reference ("That is
the picture.", "So her complaint..."). All such runs are candidates and a
model picks the one that stands alone best and would be shared (Martha: "Look
at how Jesus answers... He says her name twice"); `--no-model` takes the first
(usually the opening picture, as on the Prodigal Son).

Look (Figma 415-2610, revised): text centred, top 560 (raised from 614 for
the bottom zone), 640 wide, Inter 61 / 89, #eae6df. One sentence at a time.
Long sentences: the long form's word reveal (the whole sentence laid out,
each word fading in over 0.18 s as it is said, landing gold and cooling to
the body colour over 0.42 s; no rise or blur: the kinetic rise read as
jittery here). Sentences of four words or fewer: StampLine soft.

Label: "From the Full Devotional:" on top (below).

Credit: the devotional's commentary (the long form attributes the whole
reflection to it), even when the run itself holds no credited sentence:
divider, then centred: label (Inter 500 18 tracked 3.5 at 46%), name with life
dates on one line (PT Serif italic 36 / 50 at 85%, "J. C. Ryle (1816–1900)"),
round portrait 89 x 90 at 85%; gaps 30 / 4 / 20; at top 560 + 4 lines + 30,
fading up 0.2 to 0.9 s.

### Full-devotional label (language, reflection)

Says the short is a piece of a longer video (owner, 2026-10-05). PT Serif
italic 36 / 50, white 92% at 85%, centred, top 254 (Figma 249 to 259), soft
shadow; fades up and rises 8 from 0.1 to 0.8 s. Text: language "A Moment from
the Full Devotional:", reflection "From the Full Devotional:".

## 7. Captions (post text)

One simple file per short, as `.txt` (for copying) and a large `.rtf`
(Georgia 20, bold headings, default text colour): three caption options with
one marked "(recommended)", one hashtag set for all platforms, two or three
YouTube titles in the format "<title> | <passage>", and the credits once. No
per-platform variants, no test labels, no cover text (owner, 2026-10-02).

Content rules: build the caption on what THAT short shows; only the last line
turns toward the full devotional, as a hint or a question, never an ad. Do
not repeat a line the video already shows on screen. Credits name the film,
the on-screen translation (LUMO narration is NIV; callout verses BSB), the
source with its year (Easton 1897, Smith 1863, Abbott-Smith 1922, Ryle 1858)
and what AI did (drafted, voiced, assembled; on-screen questions written with
AI help and chosen by the team).

## 8. QA before delivering

- `cut-devotional-shorts.ts` prints length, loudness and black frames per
  short: 15 to 45 s (fact shorts may be ~16 s), about -20 LUFS, black 0.0.
- Stills at chosen frames (`--frames`) of every short, checked by eye, plus
  the red safe-zone overlay.
- Film short: frame differences non-zero at both ends (no frozen frames).
- Intro: the log says "reusing cached audio" and "synthesised 0".
- Compare a new intro with the approved teaser side by side (timing, length).

## 9. Traps already hit

- `render-devotional-video.mjs` forwards only the manifest fields it knows:
  every new composition field (`portraitMarks`, `shortForm`, `shortFact`,
  `shortCards`) had to be added there, or it silently did nothing.
- The narration cache keeps one take per id; a keyless run used to drop a
  missed `hook` (fixed in 938c07cd3: old takes are archived). The long form's
  "Let's watch." hook for Prodigal is gone; re-voice it before re-rendering
  that long form.
- whisper word times glue words across pauses; snap line edges to
  `silencedetect` when timings must be rebuilt from audio.
- Animating letter spacing on wrapping text re-wraps it mid-animation.
- A stamp that lands during the composition's fade from black reads grey.
- Prettier in the commit hook reformats files: re-read before scripted edits.
- `rm -rf` with a relative glob after `cd` is blocked by the safety check; use
  absolute paths.

Second devotional (Martha and Mary, 2026-10-02) confirmed the rules above;
its set is in `~/Desktop/Social Media/Martha/shorts/`.

## 10. Rendering one story, step by step

1. Make or find the source pack; confirm the long form's look flags.
2. Read `devotional.json`: which paragraph roles exist (history? language?),
   the opening lines, the questions card.
3. Propose the three owner texts (section 4), ten options each; get picks.
4. Preview with `--frames` and the safe-zone overlay; fix, then cut for real.
5. Write the caption files (section 7) for every short that was cut.
6. Update `shorts.md` in the output folder (file, length, what it is).
