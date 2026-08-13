# Devotional: what ties the pipeline to one machine

Written 2026-08-12 for the goal in `DEVOTIONAL-HANDOFF.md` §6a: keep the files off
one laptop so someone other than the owner can run the pipeline. Last reconciled
against `main`: 2026-08-13.

This is an inventory, not a plan. The owner makes the calls.

## How to read this document

It holds two kinds of content, and they age differently.

**Location facts** (sections 1–4, 6, 9) — what sits where, who reads it, at which
addresses. These go stale only when the files themselves change. Section 9 is the
same kind of fact but about `main` rather than this branch, so it carries its own
reconciliation date.

**Conclusions and recommendations** (sections 5, 7, 8) — what to do about all
that. These go stale the moment the work is done, including when someone else
does it upstream.

So superseded conclusions here get a dated note pointing at whatever closed them,
rather than being deleted. A deleted conclusion reads as "nobody considered this",
and the next reader implements it again. That already happened with section 5: it
recommended an approach that `main` had already solved a different way.

Four categories:

- **IRREPLACEABLE** — cannot be recreated, either because it cost money or because
  it is approved work
- **ORIGIN UNKNOWN** — no code in the repo creates or downloads it. Treated as
  irreplaceable until the origin is established
- **REPRODUCIBLE** — no need to move it, code recreates it
- **DELETE** — exists only to work around running locally, or as residue from
  experiments

---

## 1. Files: `devo/` = 3.0 GB

The whole directory is gitignored (line 67), so it exists on exactly one machine.

### IRREPLACEABLE: ~60 MB

| Path | Size | Why it cannot be lost |
|---|---|---|
| `devo/cache/` | 27 MB | Approved texts (`devo.json`) and paid ElevenLabs narration. 9 populated directories, including the approved `ch33-seq0`. Re-synthesizing narration costs money. |
| `devo/assets/music/` (20 tracks + manifest) | ~10 MB | `awe-1..5`, `hope-1..5`, `lament-1..5`, `peace-1..5`, and `manifest.json`. Produced by `apps/shorts-worker/scripts/generate-music-library.mjs` through the paid ElevenLabs Music API. The generator exists, but its own comment is explicit: the library was built once so a music credit is not spent on every run. Owner-confirmed 2026-08-12 as paid. |
| `devo/assets/symbol.svg`, `symbol-red.svg` | 8 KB | Vector of the brand mark. Runtime never reads it (see "Files nobody reads"), but the path baked into the code was taken from it. This is the source of a value, not a runtime asset. |
| `devo/corpus/` | 8 MB | Technically reproducible (see below), but moving it is cheaper. |

### ORIGIN UNKNOWN: ~105 MB. Needs checking

**No code** in the repo creates or downloads these files. Scripts only read them
and expect them to be in place already. Treated as irreplaceable until the origin
is established.

| Path | Size | What is known |
|---|---|---|
| `devo/assets/jfp-storm.mp4` | 58 MB | Read by `build-refuge-devotional.ts:232` and `build-weary-devotional.ts:221` |
| `devo/assets/jfp-resurrection.mp4` | 29 MB | Read by `build-hope-devotional.ts:220` |
| `devo/assets/ambient.mp4` | 12 MB | No consumer found in code |
| `devo/assets/ambient-pad.m4a` | 2.1 MB | No consumer found in code |
| `devo/assets/ambient-calm.m4a` | 2.1 MB | Read by `build-weary-devotional.ts:222`, `build-design-devotional.ts:170` |
| `devo/assets/bg-boj.mp4` | 1.6 MB | No consumer found in code |
| `devo/assets/jesus.png` | 2.3 MB | No consumer found in code |
| `devo/assets/manger.png` | 224 KB | No consumer found in code |
| `devo/assets/music/`: `calm-soundore.mp3`, `nature.mp3`, `spring.m4a`, `piano-ambient.m4a` | ~11 MB | NOT outputs of `generate-music-library.mjs` (that writes only `<mood>-<n>.mp3`). Placed by hand. `nature.mp3` and `spring.m4a` are read by `build-refuge-devotional.ts:234` and `build-hope-devotional.ts:223` |

**Why this is not Arclight, despite what the comments say.** In
`build-refuge-*.ts` and `build-hope-*.ts` the paths carry "(Arclight)" comments.
That is prose, not code: no line anywhere in the repo fetches these files. Arclight
content is also addressed by media ids shaped like `1_jf6133-0-0`, and what gets
downloaded lands in `devo/artifacts`, not `devo/assets`. The names here are
different. The comment most likely records where the owner got the material by
hand, not what the code does.

**On `corpus` specifically.** It is technically reproducible:
`apps/mastra/src/scripts/` holds `ingest-ryle-luke.mjs`,
`ingest-ryle-matthew.mjs`, `ingest-spurgeon-morning-evening.mjs`,
`ingest-matthew-henry-gospels.mjs`, and `ingest-web-bible.mjs`. But recreating it
depends on the external sources still being reachable and still serving the same
text. At 8 MB there is nothing to argue about: move it.

### Files nobody reads

Called out separately because it changes understanding rather than size. Eight
files in `devo/assets` are never named anywhere in the code, neither in `apps` nor
in `packages`.

```
ambient.mp4  ambient-pad.m4a  bg-boj.mp4
jesus.png    manger.png
symbol.svg   symbol-red.svg
```

For the brand graphics the reason is established: the composition never opens a
file, it draws the mark as an inline SVG path. All of it is in
`packages/shorts-compositions/src/devotional/DevotionalVideo.tsx`: `BRAND_PATH` at
line 39, `BRAND_RED` at 345, rendered at 338 and 383 (the second inside
`BrandSymbol`, line 369). So `symbol.svg` is not a runtime asset but the source
that path was once extracted from by hand.

Careful with those addresses: in other worktrees of this repo the devotional
composition is split across several files (`visual-primitives.tsx`,
`card-body.tsx`, `card-chrome.tsx`) that do not exist here. If a line number does
not match, the likely cause is the wrong worktree rather than moved code.

Hence a distinction worth keeping through the migration: **"not read by code" is
not the same as "not needed"**. `symbol.svg` has no consumer, but if the mark ever
changes there is nothing to edit `BRAND_PATH` from without the vector. So the
vectors stay under irreplaceable, while `jesus.png`, `manger.png`, and three
unnamed background files sit under unknown origin: they have neither a consumer
nor a known source, and they are most likely just experiment residue. But "most
likely" is not grounds for deleting.

### REPRODUCIBLE: ~2.8 GB

| Path | Size | What recreates it |
|---|---|---|
| `devo/artifacts/` | 2.8 GB | Renders and intermediate files. Inside: `video` 2.3 GB, `teasers` 177 MB, `cover-tests` 122 MB, then smaller items. All of it is pipeline output. Clips downloaded from Arclight by media id also land here. |
| `devo/transcripts/` | 32 KB | 8 files, whisper output per chapter. |

### DELETE

| Path | Size | Why |
|---|---|---|
| `devo/baseline/` | 36 KB | Written only by one-off scripts (`agent-parity.ts`, `agent-parity-2.ts`, `safety-negative-test.ts`). No test reads it (verified). Goes when those scripts go. |

---

## 2. Code: where a path is pinned to the machine

### The shared root: `repoRoot()`

`apps/mastra/src/services/devotional/repo-root.ts` walks up the tree looking for
`pnpm-workspace.yaml`. Every path below it is therefore repo-relative and local.
This is the core of the coupling, with 7 consumers:

| File | What it points at | Category |
|---|---|---|
| `devotional-cache.ts:33` | `devo/cache/ch{N}-seq{M}` | irreplaceable, belongs in storage |
| `reflection-corpus.ts:294` | `devo/corpus` | irreplaceable, belongs in storage |
| `web-bible.ts:74` | `devo/corpus` | same |
| `accent-cache.ts:20` | `devo/cache/ru-accent-cache.json` | irreplaceable (RU, currently inactive) |
| `artifacts.ts:152` | reports under the storage directory | already accepts an absolute path via `DEVOTIONAL_ARTIFACT_DIR` |
| `devotional-render.ts:69` | root plus the path to the render script | reproducible |
| `transcribe-window.ts:88` | one-off script | delete |

`artifacts.ts` is the only one already done right: it has an env var and takes an
absolute path as-is. It is the working model for the rest.

### Output directories: `homedir()`

9 places write straight to the owner's Desktop. Only two of them are in the
pipeline:

- `render-one-devotional.ts:33` → `~/Desktop/Devos/Devotionals`
- `render-daily-devotional.ts:49` → `~/Desktop/Devos/Devotionals`

The other 7 (`elevenlabs-*`, `ru-*`, `devo-audio-track`, `devo-localize-text`)
belong to experiments, see section 4.

### Personal paths committed to the repo

`apps/mastra/src/scripts/build-design-devotional.ts`, lines 155 and 161:
`/Users/mac/Desktop/Devos/Birth of Jesus.mp4` and `… - detected.mp4`. On anyone
else's machine the script fails immediately.

---

## 3. Programs: what a Workspace does not solve

The pipeline shells out to binaries installed on the owner's Mac:

| Program | Where it is invoked | What for |
|---|---|---|
| `ffmpeg` | `devotional-render.ts:284`, `video-assembler.ts:359` | trimming, concatenation, audio |
| `ffprobe` | `devotional-render.ts:177`, `video-assembler.ts:245` | measuring duration |
| `node` + Remotion + Chromium | `devotional-render.ts:411` spawns `apps/shorts-worker/scripts/render-devotional-video.mjs` | the video render itself |
| whisper + models | `.cache/`, also gitignored | verifying spoken lines against clips |

**This is the main obstacle.** None of these programs travel with the files. It
needs a container, and the pattern already exists in this repo:
`apps/shorts-worker` has a `Dockerfile` where the Remotion bundle, the whisper
model, and chrome-headless-shell are baked into build layers rather than installed
at runtime.

A telling detail: devotional already invokes a script **inside**
`apps/shorts-worker`. Half the path has been walked by accident; the call just goes
through a local `spawn` instead of HTTP to a deployed service.

---

## 4. One-off experiments committed as part of the feature

These are voice auditions and color-grade trials that ended up inside the feature.
Many write to `~/Desktop`. The owner's call, but the default is: delete.

```
agent-parity.ts            agent-parity-2.ts          safety-negative-test.ts
elevenlabs-smoke.mjs       elevenlabs-service-smoke.ts
elevenlabs-voice-audition.mjs                         voice-samples.ts
build-design-devotional.ts build-hope-devotional.ts
build-refuge-devotional.ts build-weary-devotional.ts
ru-voice-audition.ts       ru-cover-sample.ts         transcribe-window.ts
```

The corpus ingest scripts (`ingest-*.mjs`) are NOT in this list: they reproduce
`devo/corpus` and should stay.

---

## 5. The hardcoded JESUS catalog: ALREADY DONE in `main`

**Status: closed upstream.** PR
[#1796](https://github.com/JesusFilm/forge/pull/1796), 2026-08-01, "add devotional
Workspace data plane". Reconciled against `origin/main` 2026-08-13.

In `main`, `apps/mastra/src/services/devotional/jesus-film-catalog.ts` is 54 lines
of zod schema that VALIDATES a catalog read from the Workspace. The hardcoded
61-chapter list is gone. The catalog itself lives at the contract path
`/inputs/video/jesus-film-catalog.json`.

The schema checks that chapter indices are contiguous and ordered, that indices and
ids are unique, and that `start` matches `H:MM:SS`; it throws
`<path>: invalid JESUS-film catalog`. It exports
`parseJesusFilmCatalogDocument`.

### Do not implement the admin search API approach

The first revision of this inventory recommended removing the workaround like this:
the list exists to avoid the admin search API that is "unreachable in local dev",
therefore a shared environment should call admin. **That recommendation is
superseded and must not be carried out.** A different path was chosen: the catalog
became data in the Workspace, and the code became a validator of that data. That
solves both local reachability and editing the catalog without a deploy.

The recommendation is deliberately left here, struck through. Deleting it would
erase the record that the option was considered and rejected, and the next reader
would propose it again.

On the `feat/daily-devotional-generator` branch the file is still the old
100-line version with the hardcoded list, with
`devo/jesus-film-chapter-titles.txt` beside it. Reconciling with `main` removes
both, as a merge outcome rather than a task of its own.

---

## 6. Secrets

Already done right, nothing to move. `apps/mastra/src/config/env.ts` reads
`ELEVENLABS_API_KEY` and `OPENROUTER_API_PAID_KEY` / `OPENROUTER_API_KEY` from the
environment, all `.optional()`. Keys are never written to files. In a shared
environment these are just Railway variables.

---

## 7. What follows from all this

By category, roughly **160 MB of the 3 GB** has to move: 60 MB irreplaceable plus
105 MB of unknown origin. The rest is either recreated or deleted. Volume was never
the problem.

There are three real obstacles, and only two of them are technical:

1. ~~**Files.** Seven places where `repoRoot()` yields a local path and two where
   `homedir()` yields the Desktop. Shared storage fixes this.~~
   **CLOSED upstream**, PR
   [#1796](https://github.com/JesusFilm/forge/pull/1796), 2026-08-01. Details in
   section 9. What is left for us is reconciliation, not implementation.

2. **Programs.** ffmpeg, whisper, Chromium. Storage does not help here at all. A
   container on the `apps/shorts-worker` pattern does, all the more so because
   devotional already invokes a script from that app.

3. **Knowledge of where the material came from.** Ten files were placed by hand and
   how to obtain them again is written down nowhere. Neither storage nor a container
   fixes this: what exists can be moved, but not the means of getting the next one.
   Section 8.

One of the three is closed. The second is work. The third is a question for the
owner, and without it the migration removes the tie to a machine while leaving the
tie to a person.

**A judgment in the first revision that needs correcting.** It claimed: "Mastra
workspaces close none of these directly, they only give an agent hands." That
turned out to be wrong about what was actually built. In `main` the Workspace is
used not as hands for an agent but as a **data plane**: authoritative S3-backed
storage for inputs and state, validated on read. That is precisely what closed
obstacle one.

The mistake was deriving the mechanism's purpose from its description in the
upstream documentation rather than from how it was applied in this repo.

---

## 8. Provenance: the main open question

This is not a footnote to the files section but a separate form of coupling, and it
matters more than volume.

Ten files in `devo/assets` (six video/audio, four music, ~105 MB) are not created
or downloaded by any line of code in the repo. Scripts expect them to be in place.
So a person put them there, and only that person knows how.

**Why this is not about 105 MB.** Storage costs nothing. The real question is what
to do when an eleventh such file is needed. While the answer is "ask the owner",
the pipeline is tied to her exactly as it was tied to her laptop, except the tie is
not technical and neither storage nor a container removes it. A new person can run
everything that already exists and then stop at the first new background.

**Three possible outcomes, each with its own consequence:**

1. The material came from Arclight or another of our sources at a known address.
   Then it needs a download script, like `ingest-*` for the corpus, and the files
   move to reproducible.
2. The material was bought or downloaded from a third-party service. Then it needs a
   record of where and under what terms, or in a year the license is unknown. The
   name `calm-soundore.mp3` hints at a third-party service.
3. The material was made by hand and cannot be repeated. Then it is genuinely
   irreplaceable, and that just needs recording so nobody deletes it as an
   "unexplained file with no consumers".

Separating these three cases by filename is pointless; only the owner has the
answer. So this is a question for her, not a research task.

**Until it is answered, all ten count as irreplaceable.** The cost of being wrong
is asymmetric: 105 MB of spare bytes in storage costs nothing, while a lost source
nobody knows how to fetch again stops the pipeline.

The work in `main` (section 9) does not remove this coupling: the Workspace keeps
text manifests in `media/` that reference approved source media, and automatic
binary ingestion is excluded from v1. So a manifest can point at a file, but "where
does the next one come from" is still answered only by the owner.

---

## 9. What already shipped in `main`: the Workspace as a data plane

Reconciled against `origin/main` 2026-08-13. PR
[#1796](https://github.com/JesusFilm/forge/pull/1796), 2026-08-01, "add devotional
Workspace data plane". Alongside it: #1800 (credential isolation) and
[#1901](https://github.com/JesusFilm/forge/issues/1901) (migration readiness).

The wording matters. The direction was not dropped and not deferred: it **shipped
upstream**, and what is left for this branch is reconciliation, not development.
"Dropped" reads as "the idea was bad" and "deferred" reads as "plan it later", and
either reading sends the next reader to do the wrong thing.

### What exists in `main`

```
apps/mastra/devotional-workspace/
  README.md
  inputs/{scripture,reflections,video,prompts,safety,calendar,voices,music,render,brand,media}/
apps/mastra/src/services/devotional/workspace/     (35 files)
  config, database, postgres-catalog, media-store, audited-filesystem,
  authority-boundary, inventory, reconciler, provenance, publication,
  state, attempt-data, verified-read, source-verification, …
apps/mastra/src/scripts/migrate-devotional-workspace.ts
```

Plus a separate `@forge/devotional-workspace` package holding the schemas.

The `README.md` states authority directly: in Railway the writable S3-backed
Workspace is authoritative, and the checked-in files are migration inputs and
contract fixtures, **not** a runtime fallback. Ten singleton paths
(`/inputs/prompts/generation.json`, `/inputs/safety/rubric.json`,
`/inputs/video/jesus-film-catalog.json`, and the rest) are part of the runtime
contract: renaming one without deploying matching logic makes readiness fail.

### The boundary: what is closed and what is not

This is the part worth holding onto, or "obstacle one is closed" will be read more
broadly than it is true.

**Closed — text and state.** Texts, corpus, prompts, catalog, calendar, voices,
music prompts, render tokens, brand metadata. All read from the Workspace with
validation. Binary video *outputs* too: `media-store.ts` puts them in S3 with
sha256 verification and signed URLs, artifact types
`devotional-output-portrait-v1` and `devotional-output-wide-v1`.

**Not closed — binary *source* media.** Explicitly outside v1: "Binary
auto-ingestion is outside v1", and `inputs/media/` contains one README and no
files. So the following still have no home:

- the six background video/audio files from the unknown-origin section
- the paid music library, 20 tracks plus the 4 placed by hand
- the brand raster and vectors
- the paid narration in `devo/cache/*/audio/`

On narration specifically: in the Workspace contract `narration` is the *policy*
(templates), not the bytes. `media-store` has no audio artifact types at all, only
the two video ones. So cached paid narration does not fall under the current
contract.

This narrows section 1 without invalidating it: of the ~160 MB that has to move,
the data plane takes the text portion and the binary portion stays open.

### What this branch should do

Reconcile rather than rebuild. `feat/daily-devotional-generator` diverged from
`main` before #1796, so it still carries the old catalog with the hardcoded list
and seven local paths through `repoRoot()`. A sensible order: first work out which
of the branch's work is already superseded by the data plane, and only then merge,
otherwise conflicts get resolved in favor of the stale side.
