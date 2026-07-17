# Video-first daily-devotional pipeline (Mastra)

Status: in-progress. Foundation built + tested; Mastra orchestration + generation
rework outstanding. Branch `feat/daily-devotional-generator`.

## Problem / goal

Restructure the daily-devotional generator so it is **video-first** and built
from **swappable sub-workflows**, per the owner's decisions:

- **Video-first order** — pick an UNUSED JESUS-film clip first (never repeat a
  clip), then derive scripture from the clip's Bible passage, then hook, then
  write. Avoids two devotionals landing on the same clip.
- **Swappable sub-workflows** — Source / Content / Produce / Publish as separate
  Mastra workflows composed into one parent, so a piece can change without
  touching the others. "As much as possible written in Mastra, not code."
- **Localization seams now, English-only content** — language is a parameter;
  localizing later swaps Content + re-runs Produce; the clip (Source) is untouched.
- **Audio = ElevenLabs** — voiceover (TTS) + music (library). Voice **rotates
  D → E → C**. Music is a **20-track pre-generated library** (mood-matched, reused).
- **Human approval on the FINISHED video** — pipeline renders the MP4, then
  suspends for approval **in the Mastra playground** (`localhost:4111`), then
  publishes. Auto safety-check on the text still runs BEFORE render so we don't
  render clearly-bad content.

## Already built + tested (this session)

- `services/devotional/elevenlabs-voiceover.ts` (+test) — ElevenLabs TTS,
  best-effort typed result mirroring the old Azure `voiceover.ts`. Voice registry
  `DEVOTIONAL_VOICES` (male-d / male-e / female-c). Expressive settings.
- `services/devotional/elevenlabs-music.ts` (+test) — ElevenLabs Music,
  `MUSIC_MOODS` presets (peace/hope/lament/awe).
- `services/devotional/voice-rotation.ts` (+test) — `rotateVoice(sequence)` → D/E/C.
- `services/devotional/used-clips-ledger.ts` (+test) — `chooseChapter` (prefer
  never-used by index, else least-recently-used) + persisted atomic store at
  `<artifactRoot>/used-clips.json`.
- `services/devotional/music-library.ts` (+test) — manifest type + `pickTrack(manifest, mood, sequence)`.
- `apps/shorts-worker/scripts/generate-music-library.mjs` — generates the 20-track
  library to `devo/assets/music/` + `manifest.json`. (Run once; already run.)
- `config/env.ts` — `ELEVENLABS_API_KEY` (optional), `ELEVENLABS_VOICE_ID`,
  `ELEVENLABS_TTS_MODEL`, `ELEVENLABS_MUSIC_MODEL`; `getElevenLabsConfig()`,
  `getDevotionalElevenVoiceId()`.

## Entry points — read these first

1. `apps/mastra/src/mastra/workflows/daily-devotional.ts` — the CURRENT pipeline.
   `runDailyDevotional()` is a pure, injectable-deps core wrapped by a single thin
   Mastra `runStep`. Mirror this style: keep a pure core + thin Mastra wrapper.
2. `apps/mastra/src/services/devotional/types.ts` — `Devotional`, `Hook`,
   `ScriptureRef`, `VideoClip`, `DevotionalReport`, `VoiceoverInfo`.
3. `apps/mastra/src/services/devotional/scripture-selector.ts` — currently
   `selectScripture({ hook, llm })`. Video-first needs a passage-anchored mode.
4. `apps/mastra/src/services/devotional/jesus-film-catalog.ts` — 61 chapters
   `{ index, id, title, start }`. **No Bible passage field yet** — add one.
5. `apps/mastra/src/services/devotional/artifacts.ts` — store (`writeReport`,
   `readReport`, `writeAudio`). Add `writeVideo` / music staging as needed.
6. `apps/shorts-worker/scripts/render-devotional-video.mjs` — the Remotion render
   (spawned by the Produce workflow's render step).

## What to build

### 1. Catalog passage mapping (`jesus-film-passages.ts`) — DOCTRINALLY SENSITIVE

Map each of the 61 chapters → its canonical Gospel passage, e.g.
`{ index: 19, book: "Luke", passage: "Luke 8:22-25", also: ["Mark 4:35-41"] }`
("Jesus Calms the Storm"). All 61 are Gospel scenes (NT), so all pass the
NT/Gospels/Acts constraint. **Author carefully and have the owner review** — this
feeds scripture selection, which must not be wrong. Provide `passageForChapter(index)`.
Test: full coverage (61 entries), every ref well-formed per
`scripture-selector` `isWellFormedReference`.

### 2. Passage-anchored scripture (`scripture-selector.ts`)

Add `selectScriptureForPassage({ chapterTitle, passage, book, llm })`: ask the LLM
to choose a specific verse WITHIN the clip's passage and quote it. Keep the
existing hook-anchored `selectScripture` for back-compat. `needsCanonicalSource`
stays true until a canonical Bible source is wired (A5).

### 3. Hook, reordered + theme-constrained

Hook becomes the timely framing that connects the clip's passage to today. Reuse
`hook-picker` but pass the chapter theme + scripture so the news/holiday/question
angle resonates with the clip (don't drift to an unrelated topic). Order:
clip → scripture → hook → write.

### 4. Produce workflow — audio + render

- **Voiceover**: `rotateVoice(sequence)` → `generateElevenVoiceover({ devotional, voice })`.
  `sequence` = count of published devotionals (from the report store) so rotation
  is stable. Persist via `artifactStore.writeAudio`.
- **Music**: load `devo/assets/music/manifest.json`; `pickTrack(manifest, mood, sequence)`;
  stage the chosen mp3 beside the render manifest. Mood from the devotional tone
  (writer can emit a `mood: MusicMood`, default "peace").
- **Render**: spawn `render-devotional-video.mjs` with the assembled manifest +
  audio → MP4 to a Desktop-visible output dir. Bytes/heavy work stays in the
  worker (smart-crop worker law). Deterministic failure → surface, don't hang.

### 5. Human approval — Mastra suspend/resume (PIONEERING)

No suspend/resume exists in the repo yet (@mastra/core 1.36.0). Add an approval
step that `suspend()`s with the rendered MP4 path + a preview, and resumes on
`{ approved: boolean, notes?: string }` from the playground. Publish only on
`approved`. VERIFY the 1.36 suspend/resume API against @mastra/core types before
writing (resumeSchema on the step; `run.resume({ stepId, resumeData })`).

### 6. Publish

Reuse `publishDevotional` (best-effort). Record the finished video path +
voiceover + music track in the report. Then `usedClipsStore.record(chapterId)`
AFTER a successful run so a failed run doesn't burn a clip.

### 7. Compose the parent workflow + register

Parent `videoFirstDevotionalWorkflow` = Source → Content → Produce → Publish
sub-workflows, `.then()`-chained. Register in `apps/mastra/src/mastra/index.ts`
alongside `dailyDevotionalWorkflow` (keep the old one until this replaces it).

## Open decisions to confirm with owner

- **Passage mapping review** — owner reviews the 61-passage table before it ships
  (scripture accuracy).
- **Mood source** — does the writer LLM pick the music mood, or default "peace"?
- **Render output location** — Desktop folder (visible) vs artifact store.
- **Keep or retire Azure `voiceover.ts`** once ElevenLabs is wired in.
- **`sequence` source** — published-report count vs a dedicated counter in the ledger.

## Constraints

- Pure core + thin Mastra wrapper (match `runDailyDevotional`).
- Best-effort audio/publish: a missing `ELEVENLABS_API_KEY` or publish failure is
  "skipped", never a failed run.
- No clip reuse until the pool is exhausted (ledger policy).
- English-only content; language stays a parameter (no hardcoded "en" scattered).
- Never render before the text safety gate passes.

## Verification

- `pnpm --filter @forge/mastra exec vitest run src/services/devotional` green.
- `pnpm --filter @forge/mastra exec tsc --noEmit` clean.
- Playground (`pnpm --filter @forge/mastra dev` → localhost:4111): run the parent
  workflow, confirm it suspends on approval with the MP4, resume approved → publishes.
- End-to-end: produced MP4 uses the rotated voice + a library music track; the
  used-clips ledger advances; a second run picks a different clip.
