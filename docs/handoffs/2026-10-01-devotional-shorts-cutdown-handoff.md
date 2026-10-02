# Handoff: devotional shorts cut-down (feat-573)

> **Done 2026-10-01.** The tool exists and the Prodigal set is cut; see
> "Built" in the ticket for the commands. The rest of this file is the
> original handoff, kept for its reasoning.

Written 2026-10-01 at the end of the Prodigal Son session, for a fresh session
that has none of that conversation. Read this, then `docs/roadmap/media-generation/feat-573-devotional-shorts-cutdown.md`.

## Goal

The owner (Lyuba) finishes a long-form devotional (16:9, 3 to 8 min: video +
script). She hands it to an agent, and the agent cuts up to SIX vertical
(9:16) shorts from it, each 15 to 45 seconds, to post on social media and
send people to the full video on YouTube.

| #   | Short         | Source in the long-form                                             |
| --- | ------------- | ------------------------------------------------------------------- |
| 1   | Intro teaser  | the montage opening (ALREADY BUILT, see below)                      |
| 2   | Film moment   | a passage of the `video` card (the LUMO / JESUS film scene)         |
| 3   | History fact  | a reflection paragraph with role `history` + its source mark        |
| 4   | Language fact | a paragraph with role `language` (only when the devotional has one) |
| 5   | Reflection    | a run of `reflection` / `classic` paragraphs that stands on its own |
| 6   | Question      | the `questions` card (question + prayer)                            |

## Owner decisions (2026-10-01)

- **No hook line** added to a short. The short itself is the hook; at 15 to
  45 seconds there is no room for one.
- **No spoken or on-screen call to action** in shorts 2 to 6. A CTA on every
  short sounds like an ad. The owner writes "full devotional on our channel"
  in the post caption herself. Only the intro teaser (#1) ends on its calm CTA.
- Fully automatic is the goal: devotional in, shorts out. The owner picks
  and posts.

## What already exists (reuse it)

- **Intro teaser**, `apps/mastra/src/scripts/render-one-devotional.ts` with
  `--teaser-intro --aspect=portrait --intro=montage`. Rules are in memory
  `devotional-vertical-intro-teaser.md`: large kinetic captions that may
  overlap the picture, calm centred CTA (default; `--cta-style=kinetic` for
  the other look), no LUMO mark, optional `--music-file` bed (Prodigal used
  a ney bed; next teaser tries duduk, kept out of minor). The Prodigal
  teaser (`~/Desktop/Social Media/Prodigal/teaser_prodigal_vertical.mp4`)
  was rendered from `apps/mastra` with:

  ```bash
  HOOK="A faithful son stands outside his father's party.

  His brother squandered it all and wears the best robe.

  In this devotional, one word in the father's reply about the feast.

  The father steps out to him.

  Watch the full devotional on our YouTube channel."
  ELEVENLABS_API_KEY= pnpm exec tsx --env-file=.env.local src/scripts/render-one-devotional.ts \
    --source=lumo-luke-15 --seq=0 --aspect=portrait --structure=clip-first \
    --intro=montage --teaser-intro --no-step-ring --hook="$HOOK" \
    --intro-shots=172.4,194.9,199.3,181.6 --intro-focus=0.5,0.34,0.16,0.62,0.55 \
    "--intro-kinetic=0=outside/faithful/left;1=the best robe/squandered/right;2=one word/feast/right;3=steps out/father/left;4=full devotional/YouTube/left" \
    --hook-gap=0.15 --steps --text-font=serif --word-timings --approve \
    --music-file="$HOME/Desktop/Social Media/Prodigal/work/music-east/2-ney.mp3" \
    --out="$HOME/Desktop/Devos/Devotionals/teasers"
  ```

  The output is named `<slug>-seq<n>-clipfirst.mp4`; when that name is taken
  the render writes `-v2`, `-v3`, so rename the take you keep.

- **The render already knows the structure.** `devotional-render.ts` builds a
  manifest (`packages/shorts-compositions/src/devotional/schema.ts`): cards of
  kind `video`, `step`, `reflection-full` / `reflection-focus`, `conclusion`,
  `questions`, each with `durationSec`, `audioFile`, word timings, and for
  reflection cards a `sourceMark` (`label`, `source`) when the sentence is a
  credited fact. Paragraph roles (`history`, `language`, `classic`,
  `reflection`) are in the cached text, `devo/cache/ch<chapter>-seq<n>/devo.json`
  (`reflection.paragraphs[]`), produced by `storyteller-writer.ts`.
- **The composition renders both aspects.** `DevotionalVideo.tsx` lays a
  card out in 9:16 or 16:9; 9:16 keeps the vertical stepper and the corner
  ring (memory `devotional-look-per-aspect.md`).
- **Audio is cached per segment** (`devo/cache/.../audio/index.json`, keyed by
  text + voice + take). A short re-uses the long-form's readings: it must cost
  zero ElevenLabs credits. Run with `ELEVENLABS_API_KEY=` and require the log
  line "reusing cached audio".

## Manifest is now kept (done 2026-10-01)

The stage dir (`$TMPDIR/devo-render-*`) is deleted after a successful render,
so the manifest used to be lost. Since commit "keep the manifest beside the
video", `devotional-render.ts` copies it to `<video>.manifest.json` next to
every rendered MP4. Martha and Mary has one
(`~/Desktop/Social Media/Martha/work/devo_h_martha.manifest.json`); Prodigal
predates it: re-run its render with `--stop-before-render` and
`ELEVENLABS_API_KEY=` to get one at zero cost.

The manifest alone is not enough to cut from: it points at staged files
(`clip.mp4`, `bg.mp4`, per-segment audio, music) that die with the stage. So
every complete render (not stills, `--frame-range` or `--draft`) also writes a
**source pack**, `<video>.source/` (`source-pack.ts`): `manifest.json`, every
file the manifest references, `devotional.json` (the text with paragraph
roles) and `render.json` (comp, style, layout, levels, render options). The
render script resolves files next to the manifest, so
`render-devotional-video.mjs --manifest=<video>.source/manifest.json` renders
straight from it (checked 2026-10-01 on the Prodigal teaser stage). Videos are
re-encoded (film CRF 20, background CRF 23); measured saving is about 25% /
44%, so a pack is roughly 180 to 280 MB, not small. Packing adds about 50 s
to a render; a failure only logs a warning, the MP4 is kept. An existing pack
of the same name moves to `archive/`.

Before rendering portrait shorts, rebuild the OpenCV venv and pass
`DEVO_FACE_PYTHON` (memory `devotional-local-setup-outside-repo.md`): on
2026-10-01 the stage logged `opencv_missing` and centre-cropped.

## Intro settings per story (not stored in the manifest)

The montage opening's shots, crops and kinetic specs are passed to the render
on the command line and baked into `clip.mp4`; the manifest does not record
them, and the opening voice lives in the audio cache
(`devo/cache/ch<chapter>-seq<n>/audio/hook.mp3`), not in the shorts source.
Until the render saves them, take them from here (and from each story's
`README.txt`):

| Story           | source / cache            | --intro-shots           | --intro-focus (9:16)                                 | --intro-kinetic                                                                                                                          |
| --------------- | ------------------------- | ----------------------- | ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Prodigal        | lumo-luke-15, ch1002-seq0 | 172.4,194.9,199.3,181.6 | 0.5,0.34,0.16,0.62,0.55                              | `0=outside/faithful/left;1=the best robe/squandered/right;2=one word/feast/right;3=steps out/father/left;4=full devotional/YouTube/left` |
| Martha and Mary | lumo-luke-10, ch1003-seq0 | 433.4,426.3,438.4,447.7 | not chosen yet (start at 0.5 each, check the frames) | `0=everything right/lost/left;1=at his feet/worked/left;2=distracted/Luke/left;3=still answers/fair/right`                               |

Martha's opening is read by female-d (take `hx+v4`, expressive); music
`~/Desktop/Social Media/Martha/work/music-duduk/3-duduk-oud.mp3`.

## Suggested shape (not decided; brainstorm against the ticket first)

One command, e.g. `src/scripts/cut-devotional-shorts.ts --from=<manifest>`:

1. Read the persisted manifest + `devo.json`.
2. Pick candidates deterministically from roles and timings: the `history`
   paragraph with its mark, the `language` paragraph, the strongest
   `reflection` run under 45 s, the `questions` card, a film window.
3. Use a model ONLY where taste is needed: which reflection run stands alone,
   which film window (the scene's turn, not the opening). Everything else is
   deterministic: cheap and repeatable.
4. Re-render each short in 9:16 as its own small manifest through the same
   composition (not by cropping the 16:9 MP4): text, captions and marks are
   laid out for portrait properly.
5. QA every short the way the long-form is checked: duration 15 to 45 s,
   loudness about -20 LUFS, no black frames, stills of each, word captions in
   sync. Do not say it is done before checking the frames.

## Owner answers to the open questions (2026-10-01)

- Film moment (#2): cut BOTH, as an A/B pair: `film-turn` (the turn of the
  scene, chosen by a model) and `film-verse` (the passage the reflection is
  about). The owner picks which one to post.
- Film shorts keep the scrolling Scripture captions (LUMO style), for
  sound-off viewers.
- Music: only under the intro teaser. Shorts 2 to 6 keep the long-form's own
  audio (voice, film sound), no added bed.
- Languages: English only for now. Spanish / Russian come later as a
  separate step.
- Output folder: `~/Desktop/Social Media/<Story>/shorts/` (default, not
  objected to).

## Working rules (from memory; they apply here too)

- Two sessions may work in `devo-lab` and render at the same time (checked
  2026-10-01): every render stages into its own temp dirs
  (`devo-render-*`, `devo-remotion-*`), the output never overwrites (a taken
  name becomes `-v2`), and the audio cache is per devotional
  (`devo/cache/ch<chapter>-seq<n>`). Limits: do not render the SAME
  devotional from two sessions while either one synthesises new audio (both
  would write that cache); find a render's manifest by its own stage dir from
  the log, not "the newest manifest"; parallel renders run slower; and a
  change to the shared composition reaches a render only if it was saved
  before that render started its bundle, so commit composition changes
  before starting a render.
- Keys, caches, corpora and the face venv live outside git: see memory
  `devotional-local-setup-outside-repo.md`. They are already set up in
  `devo-lab`; `apps/mastra/.env.local` holds the keys (never print them).

- Talk to Lyuba in Russian; code, commits, docs in English.
- Work in the `devo-lab` worktree (branch `feat/devotional-video-pipeline-handoff`).
  Push and deploy are Vlad's.
- Never overwrite outputs: move old files to `archive/`.
- No em or en dashes in any generated copy. No source names or Greek words
  spoken aloud.
- Downloads need the owner's approval. Never print API keys.
- Preview a new animation on a few seconds (`--frame-range`) before a full
  render.
- Commits: lowercase conventional subject plus the Co-Authored-By trailer;
  never skip hooks.
