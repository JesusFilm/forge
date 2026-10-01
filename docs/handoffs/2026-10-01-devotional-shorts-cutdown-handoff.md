# Handoff: devotional shorts cut-down (feat-573)

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

## Gap found while writing this

The manifest is written only to a temp stage dir
(`$TMPDIR/devo-render-*/manifest.json`) and is lost after the render. Step 1
of the work is to persist it (and the staged audio list) next to the output
video, e.g. `<out>/<name>.manifest.json`, so a cut-down can run later from the
finished devotional alone.

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

## Open questions for the owner

- Film moment (#2): with or without the scrolling Scripture captions? Which
  moment: the turn of the scene, or the verse the reflection is about?
- Music under shorts 2 to 6, or only the intro teaser?
- Spanish / Russian shorts from localized devotionals: same set?
- Output folder: `~/Desktop/Social Media/<Story>/shorts/`?

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
