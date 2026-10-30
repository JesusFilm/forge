# Kickoff: a new LUMO devotional, from "story + passage" to scripts waiting for approval

For the session that starts a new story (Calendar hands it over as "story name +
passage"). The end state is two scripts, English and Russian, saved in the story
folder and sent to Lyuba for approval. Nothing is voiced or rendered before she
approves. The worked example is The Persistent Widow (Luke 18:1-8, source key
`lumo-luke-18-widow`, index 1006, folder `~/Desktop/Social Media/Widow/`).

Run everything from the worktree `/Users/mac/Forge/.claude/worktrees/devo-lab`
(branch `feat/devotional-video-pipeline-handoff`). Keys live in
`apps/mastra/.env.local`; the corpora, cache and whisper model live in
`~/Desktop/devo-data/` (not in git). Below, `M=apps/mastra`.

Talk to Lyuba in Russian, plain words. Files, notes and commits are in English.

## 0. Name things

- Story folder: `~/Desktop/Social Media/<Story>/` (one word, e.g. `Paralytic`)
  with `work/` and `README.txt`. First README line:
  `<Title> (<Passage>, LUMO "<segment title>"), started <date>`.
- Source key: `lumo-luke-<chapter>-<word>` (e.g. `lumo-luke-5-paralytic`).
- Index: one more than the highest LUMO index in
  `$M/src/services/devotional/video-sources.ts` (1006 is Widow, so 1007 next).
  The cache folders follow from it: `~/Desktop/devo-data/devo/cache/ch<index>-seq0`
  (EN) and `ch<index>-seq0-ru` (RU).

## 1. Find the film segment

LUMO Luke is split into 26 segments, `6_GOLuke2601` to `6_GOLuke2626`
(the list: `media-component-links/GOLukeCollection`). Print their titles:

```bash
for id in $(seq -w 1 26); do curl -s "https://api.arclight.org/v2/media-components/6_GOLuke26$id?apiKey=616db012e9a951.51499299" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['mediaComponentId'], d['title'])"; done
```

Each title names the verses it covers. Example: 2605 is "LUMO - Luke 5:1-39" (the Paralytic, 5:17-26, is inside it);
2617 is "Luke 17:1-18:8".

Download English (language 529) and the Russian dub (3934), 720p:

```bash
for L in 529 3934; do U=$(curl -s "https://api.arclight.org/v2/media-components/6_GOLuke2605/languages/$L?platform=web&apiKey=616db012e9a951.51499299" | python3 -c "import json,sys; print(json.load(sys.stdin)['downloadUrls']['high']['url'])"); curl -sL "$U" -o "$HOME/Desktop/Social Media/Paralytic/work/film-$L.mp4"; done
```

Find the scene's window (film seconds). Transcribe the whole segment once and
read where the passage starts and ends:

```bash
W="$HOME/Desktop/Social Media/Paralytic/work"; ffmpeg -v error -y -i "$W/film-529.mp4" -ar 16000 -ac 1 "$W/film-529.wav" && whisper-cli -m ~/Desktop/devo-data/whisper/ggml-small.bin -f "$W/film-529.wav" -l en -osrt -of "$W/film-529"
```

Rules for the window: start on the first sentence of the passage, end after
its last word plus a short breath, never mid-sentence. The Russian dub drifts
by up to a second, so do the same for `film-3934` with `-l ru` and give the RU
window separately (`windowByLang.ru`). If the scene's last word is also the end
of the segment, set `endPadSec: 3` (holds the last frame so the word is not cut).

## 2. Add the source

Copy the `lumo-luke-18-widow` entry at the end of `SOURCES` in
`$M/src/services/devotional/video-sources.ts` and change: `key`, `index`,
`mediaComponentId`, `title`, `passage` (`reference` and `osisRef`), `window`,
`windowByLang.ru`, `maxVideoCardSec` (speech length / 1.05 plus 2 s), the two
caption paths, and `endPadSec` only when step 1 says so. Keep `film: "lumo"`,
`videoSpeed: 1.05`, `filmCaptionStyle: "scroll"`, `filmMark: "lumo"`,
`style: "clean"`. Add a comment for anything unusual about the window.

## 3. Make the cue files (EN and RU)

Write the cue text by hand, one spoken line (about a breath) per cue, each with
the verse it starts in. English is the NIV as LUMO reads it (quotation marks
dropped). Russian is what the dub actually says (from the RU transcript,
spelling fixed), not the Synodal text. Save as
`work/cues.en.json` / `work/cues.ru.json`:

```json
{
  "key": "lumo-luke-5-paralytic",
  "lang": "en",
  "book": "Luke",
  "chapter": 5,
  "film": "LUMO, The Gospel of Luke 5:1-39 (Arclight 6_GOLuke2605)",
  "cues": [
    [17, "One day Jesus was teaching,"],
    [17, "..."]
  ]
}
```

The Russian file has `"lang": "ru"` and `"book": "От Луки"` (without the RU
verses sidecar the long form shows "Luke 18" in English on a Russian video).

```bash
W="$HOME/Desktop/Social Media/Paralytic/work"; python3 -I apps/mastra/scripts/make-film-cues.py "$W/film-529.mp4" <startSec> <endSec> "$W/cues.en.json" apps/mastra/src/services/devotional/video-sources
```

and the same with `film-3934.mp4`, the RU window and `cues.ru.json`. It writes
`<key>.<lang>.vtt`, `.words.json` and `.verses.json`. Read its printout: every
cue should start where its burst starts; "interpolated:" lines are words
whisper missed. Delete the `.work-*` scratch folder it names. The real gate,
`apps/mastra/scripts/check-film-sync.py`, runs on the first render (after
approval), not now.

## 4. Add the story

Add an entry to `STORIES` in `$M/src/scripts/compose-storyteller.ts`, keyed by
the source key (copy `lumo-luke-18-widow`):

- `terms`: the index words to pull history and language notes from the public
  domain corpora (people, places, objects, practices in the scene; for
  Edersheim the exact chapter title).
- `out`: the folder name (`"Paralytic"`).
- `setting` only if the verses just before the scene are visible in the card;
  otherwise leave it out (the viewer never saw them, owner 2026-10-12).

## 5. Pick the closing verse

Pick ONE closing verse from elsewhere in the Bible that answers the scene, checked
against the BSB corpus (no options to choose from since 2026-10-30; Lyuba asks
separately when she wants another):

```bash
pnpm --filter @forge/mastra exec tsx src/scripts/bsb-verse.ts "Psalm 103:3" "Isaiah 53:5" "Mark 2:17"
```

Only use a verse that prints text (NOT FOUND cannot be used).

## 6. Write the English script

Voices alternate per episode. Read the previous episode's
`devo.json` `voice` field (Widow: main `female-d`), and give this one the other:

```bash
pnpm --filter @forge/mastra exec tsx --env-file=.env.local src/scripts/compose-storyteller.ts --source=lumo-luke-5-paralytic --voices=male-e,female-d --verse="Psalm 103:3"
```

Optional `--insight-hint="history: ..."` when Lyuba leans to one insight.
It takes several minutes (big models) and writes:

- `~/Desktop/Social Media/<Story>/script_<story>.txt`: the script to read;
- `~/Desktop/Social Media/<Story>/work/storyteller_notes.md`: the brief, the
  checks in order, what was dropped and "Facts still open";
- `~/Desktop/devo-data/devo/cache/ch<index>-seq0/devo.json`: what the render
  will use.

Then read it yourself before Lyuba does:

- "Facts still open" must be empty. If not, apply the suggested replacements
  in `devo.json` and the script file (both), or re-run.
- The opening is nerve, story, then "In this devotional, we..." last; the
  reflection opens on a hook, uses ONE insight in one block, never names a
  source or a Greek/Hebrew word aloud; the takeaway is a conclusion; no worn
  moves (the code checks most; read for the rest). No em or en dashes.
- If the notes show a check failed and was rewritten, read that part twice.
- The writer does NOT enforce the rules Lyuba set in the Lepers and Widow
  sessions. Fix these by hand in `devo.json` and the sheet before she reads
  it (Paralytic v1 went out without them, 2026-10-16):
  - the opening's nerve line hooks as hard as the reflection's best line;
  - one line of thought, no paragraphs that retell the scene;
  - ONE commentary point (`message.classicPoints`), unfolded over two or
    more paragraphs, not a line from each point;
  - `pauses` on weighty sentences (‖ in the sheet), `direction` tags on
    paragraphs, `voiceDirections`;
  - a verse card (`callout`, highlight ≤24 chars) wherever the reflection
    points at a verse, and the card shows its address (`callout.reference`)
    on screen (owner, 2026-10-16; the overlay must draw it);
  - no soft or quiet direction tag on the first reflection paragraph: it
    opens the reflection and must sound plain and calm, not whispered;
  - the question is personal and not yes/no.
    The Widow cache (`ch1006-seq0/devo.json`) is the worked example of every
    field.

## 7. Make the Russian script

Follow `docs/devotional-russian-playbook.md` (section 1 is the text). Then:

```bash
pnpm --filter @forge/mastra exec tsx --env-file=.env.local src/scripts/devo-localize-text.ts --chapter=1007 --seq=0 --lang=ru
```

It writes `ch1007-seq0-ru/devo.json` and a readable
`~/Desktop/Devos/devotional-video/text/ch1007-seq0-ru.md`. Edit the
`devo.json` to the playbook: Synodal for Scripture except where the
reflection quotes the dub (then the dub's words), «В этом видео мы…» as the
preview line, every line to the viewer gender-neutral («больше не
приходишь», never «перестал»), plain words, no dashes. Save the reading sheet
as `~/Desktop/Social Media/<Story>/script_<story>_ru_read.txt` (the same
order as the English script: opening, reflection, takeaway, verse, question,
prayer).

## 8. Hand over for approval

- README.txt: add `SCRIPTS WAITING FOR APPROVAL (<date>): script_<story>.txt,
script_<story>_ru_read.txt; closing verse <ref>; voices <main>/<depth>`.
- Commit the source entry, cue files and STORIES entry
  (`feat(devotional): <story> source, cues and story entry`), and push the
  branch to the fork (`lyubavasilierrra/forge`). Never push `origin`.
- Send Lyuba both scripts (paths, plus the text in the message) and stop.
- The review doc is a Claude Doc split BY LANGUAGE (Lyuba, 2026-10-30), because each
  language curator gets their own script: tabs Intro, Русский, English, Review. Each
  language tab holds the long-form script, then a divider and the 3-4 proposed Shorts
  (per Short: the exact spoken or on-screen words, then one "visual" line; the film Short
  as question card / what the clip shows / ending card; dividers between Shorts), then a
  divider and Captions (YouTube titles, description, credits, hashtags, pinned comment,
  Shorts titles). No Verses tab and no verse options: pick the closing verse yourself;
  she asks separately for another. Any edit to the long form is carried into that
  language's Shorts and Captions (and the other language) in the same pass. She approves
  the Shorts together with the scripts.

## Do not, before she approves

- Do not record any voice, call ElevenLabs, or render, even a draft. If you
  must try a render for a technical reason, unset `ELEVENLABS_API_KEY` and
  make sure the log says it is reusing cached audio.
- Do not invent Scripture wording. Film lines are what the film says; the
  closing verse is the corpus text.
- Do not kill processes by name; other sessions render in this worktree. Use
  the PID.
