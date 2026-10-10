---
title: "feat: Subtitle translation gold-standard evaluation harness"
type: feat
status: active
date: 2026-08-20
roadmap: docs/roadmap/media-generation/feat-049-alternative-transcription-and-translation-models.md
---

# Subtitle translation gold-standard evaluation harness

## Scope

Build an offline, repository-owned evaluator for the existing Mastra subtitle
translation and retiming runtime. The evaluator will compare generated target
VTT subtitles with human-produced Core subtitle tracks for a fixed set of
representative videos and languages. It must remain outside the production
request path and must not change the production model or prompt.

This plan covers the benchmark foundation only. It does not run or recommend a
DeepL/provider migration, add a Manager review UI, publish generated subtitles,
or treat LUMO as reference-backed while Core has no LUMO subtitle rows.

## Reference corpus

Use a versioned manifest with these initial Core video identities:

1. `1_jf-0-0` — JESUS, long-form scripture and dialogue.
2. `1_wl60-0-0` — Magdalena, long-form narrative and dialogue.
3. `2_0-FallingPlates` — short-form poetic language.
4. `2_0-WhereYouBelong` — contemporary sports short.
5. `8_NBC01` — compact teaching content.

The initial shared target-language set is German, Spanish, French, and Russian.
Every source/target pair must resolve to the same video edition. The committed
manifest stores identities and selection rules, not raw subtitle bodies. A
local prepare command downloads the current VTTs, records resolved subtitle
IDs and SHA-256 checksums, and refuses incomplete or ambiguous pairs.

## Evaluation contract

1. Parse the human English VTT as the source transcript so translation quality
   is isolated from automatic speech-recognition quality.
2. Invoke the same translator and retimer implementation used by the production
   subtitle-enrichment runtime, with model calls dependency-injected for tests.
3. Compare generated and human target VTTs with deterministic structural and
   reference metrics. Do not require cue-for-cue equality because valid
   translations may use different segmentation.
4. Write a versioned JSON report plus a reviewer-oriented Markdown report to a
   gitignored output directory. Stamp the corpus lock hash, code revision,
   model route, prompt/runtime policy, language configuration, and timings.
5. Keep human adequacy/theology review explicit and unresolved until a reviewer
   supplies a verdict. Automatic scores are diagnostics, not publication
   authority.

## Metrics and gates

Hard structural checks:

- parseable WebVTT;
- non-empty cues with finite `start < end` timings;
- monotonic, non-overlapping cue order;
- generated time-window coverage relative to the source;
- no empty or duplicated generated text.

Deterministic diagnostics:

- normalized character n-gram F-score over complete text and bounded time
  windows;
- token/character length ratio against the human reference;
- cue-boundary mean absolute error and time-overlap coverage;
- characters per second and line-length summaries;
- workflow success, elapsed time, and per-language failure reason.

Human review records meaning preservation, naturalness, terminology/scripture
accuracy, omissions, additions, and a terminal accept/reject verdict. Any
critical scripture error or fabricated content is a hard failure regardless of
aggregate automatic score.

## Files

- `apps/mastra/evals/subtitle-translation/` — corpus manifest and operator docs.
- `apps/mastra/src/evals/subtitle-translation/` — schemas, Core client, corpus
  preparation, VTT scoring, report writer, and CLI.
- `apps/mastra/package.json` — offline prepare/evaluate scripts.
- `apps/mastra/.gitignore` or repository ignore rules — local corpus and report
  bytes.

## Verification

- Manifest and corpus-lock schemas reject unknown fields, duplicate cases,
  ambiguous editions, missing language pairs, and checksum mismatches.
- VTT metrics have focused tests for segmentation differences, timing gaps,
  overlaps, normalization, and deterministic output.
- The evaluator has a fixture-backed test that executes without network or
  model credentials.
- `pnpm --filter @forge/mastra test`
- `pnpm --filter @forge/mastra typecheck`
- `pnpm --filter @forge/mastra lint`
- A real corpus preparation or model run is attempted only when its external
  endpoint and provider credentials are available.

## Boundaries

- No raw production subtitle bodies are committed.
- No Admin or Manager app imports from Mastra.
- No production route, schedule, workflow registration, model-default change,
  publication, deployment, PR, or merge.
- LUMO remains a separately labeled challenge set until human subtitle
  references exist.
