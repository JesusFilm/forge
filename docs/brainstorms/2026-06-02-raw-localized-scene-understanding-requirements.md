---
date: 2026-06-02
topic: raw-localized-scene-understanding
---

# Raw Localized Scene Understanding Requirements

## Summary

Build localized scene embeddings from the actual localized media context: the target-language dub/video asset, target-language subtitle or transcript, and localized scene analysis output. Do not translate an English scene-analysis artifact and treat it as localized enrichment.

## Problem Frame

The previous feat-120 framing allowed a cheap translation path: take the English scene-analysis artifact, translate its descriptions, and embed the translated text. That improves snippet language, but it does not prove the system understands the localized video. It can miss dub-specific phrasing, culturally localized wording, altered audio timing, subtitle differences, and visual/audio context from the target-language asset.

For this feature, authenticity is the core product requirement. A Spanish scene embedding should come from the Spanish dub/subtitle context. An Arabic scene embedding should come from the Arabic dub/subtitle context. If that localized media context is unavailable, the system should report missing raw localized inputs rather than fabricating a target-locale row from English.

## Key Decisions

- **Raw localized input is mandatory.** The source for a target-locale scene artifact is the target-language media context, not a translated English artifact.
- **Manager remains the scene-understanding producer.** Manager already owns scene-analysis artifact generation; feat-120 should extend that producer to accept a requested target language and produce locale-specific scene-analysis artifacts.
- **Admin remains the target selector and storage owner.** Admin already syncs languages, dubs, subtitles, video locales, and editions. It should select the localized dub/subtitle inputs and later store localized scene rows and vectors.
- **Mastra embeds, but does not spoof localization.** Mastra can remain the embedding workflow owner, but it should embed a locale-specific Manager scene-analysis artifact. It should not translate scene descriptions as a substitute for localized scene understanding.
- **No silent fallback.** Source-language scene vectors may remain useful as a separate fallback product behavior, but they must not populate target-locale scene rows or count as feat-120 success.

## Actors

- A1. **Operator** - chooses a language or locale cohort to enrich and needs clear reports when raw localized inputs are missing.
- A2. **Admin** - owns Core-synced content, localized dubs/subtitles, target enumeration, storage, search contracts, and operator trigger surfaces.
- A3. **Manager** - runs localized scene understanding against the requested localized media context and writes artifacts.
- A4. **Mastra** - embeds completed scene-analysis artifacts and writes vectors back through Admin ingest.
- A5. **Search user** - submits a query in their locale and expects localized scene snippets and ranking grounded in that locale's media.

## Requirements

**Localized media selection**

- R1. Admin must prove it imports the data needed to choose localized source media: video primary language, localized video metadata, subtitles, dubs, editions, and Mux metadata.
- R2. Admin must support selecting dispatch fields for a requested target language or locale, not only the video's primary language.
- R3. A localized scene-analysis dispatch target must resolve to a target-language Mux asset or playback source and a target-language subtitle/transcript source when available.
- R4. If no target-language subtitle exists, the system may transcribe the target-language dub audio, but it must not use an English transcript as the target-language transcript.

**Raw localized scene analysis**

- R5. Manager must accept a requested target language for scene analysis and pass that language through the full pipeline.
- R6. Manager must analyze scenes using the localized media context for that target language: target-language video/audio plus target-language subtitle or transcript.
- R7. Manager's scene-analysis prompt/output must produce user-facing scene descriptions in the target language.
- R8. Manager must write locale-specific scene-analysis artifacts so source and target artifacts do not overwrite each other.
- R9. Locale-specific artifacts must carry provenance that makes their input language, media source, subtitle/transcript source, and generation mode auditable.

**Embedding and storage**

- R10. Admin/Mastra must embed the locale-specific scene-analysis artifact exactly as produced by Manager, without translating an English artifact during embedding.
- R11. Admin must store localized scene text and vectors under the requested locale only when the source artifact was generated from that locale's raw media context.
- R12. Search snippets for localized scene results must come from the localized scene-analysis description, not from an English description or translated English fallback.

**Operator and failure behavior**

- R13. Operator reports must distinguish missing localized dub, missing localized subtitle/transcript, scene-analysis generation failure, artifact missing, embedding failure, and storage failure.
- R14. A target locale with missing raw localized inputs should be skipped or reported as blocked; it should not receive a spoofed translated-English scene row.
- R15. The trigger surface must let operators request one or more target languages/locales for scene analysis and embedding.

**Quality and authenticity**

- R16. Verification must include at least one non-English video target where the chosen Mux/source asset and transcript/subtitle language are the requested language.
- R17. Verification must compare localized artifacts against the English source artifact and prove they were generated independently, not translated from the English description.
- R18. Evaluation must include native-language queries and inspect both ranking and displayed snippets.

## Key Flows

- F1. Localized scene-analysis generation
  - **Trigger:** Operator requests scene analysis for `(assetId, coreId, targetLocale)`.
  - **Actors:** A1, A2, A3.
  - **Steps:** Admin selects target-language dispatch fields; Manager receives target language, target Mux source, and target subtitle/transcript source; Manager runs scene understanding; Manager writes a locale-specific scene-analysis artifact with provenance.
  - **Outcome:** The target locale has its own scene-analysis artifact derived from localized media context.

- F2. Localized embedding backfill
  - **Trigger:** Operator runs scene embedding backfill for a target locale.
  - **Actors:** A1, A2, A4.
  - **Steps:** Admin loads the locale-specific Manager artifact; Mastra embeds the localized scene descriptions; Admin ingest stores localized `VideoSceneLocale` rows and vectors.
  - **Outcome:** Search has target-locale scene vectors whose text came from raw localized scene understanding.

- F3. Missing localized inputs
  - **Trigger:** Operator requests a target locale that lacks a localized dub or usable localized subtitle/transcript.
  - **Actors:** A1, A2, A3.
  - **Steps:** Admin/Manager classifies the missing input; report captures the stable reason; no target-locale scene-analysis artifact or vector row is written from English.
  - **Outcome:** Operators see what source data must be fixed before localized scene understanding can run.

## Acceptance Examples

- AE1. Covers R2, R3, R5, R6. Given a video with English and Spanish dubs, when an operator requests Spanish scene analysis, Admin dispatches the Spanish Mux source and Spanish subtitle/transcript to Manager. Manager does not dispatch the English primary-language source.
- AE2. Covers R8, R9, R10. Given both English and Spanish scene-analysis artifacts exist, when Admin runs the Spanish embedding backfill, Mastra embeds the Spanish artifact and Admin provenance identifies the Spanish source artifact.
- AE3. Covers R4, R14. Given a video has a Spanish dub but no Spanish subtitle, when the pipeline can transcribe the Spanish dub, it may create a Spanish transcript and proceed. If it cannot transcribe the Spanish dub, it reports missing localized transcript and does not use English transcript text.
- AE4. Covers R12, R17. Given a Spanish search result shows a scene snippet, the snippet text is from the Spanish scene-analysis artifact. It is not a translated copy of the English scene-analysis description.

## Scope Boundaries

- Translation of English scene-analysis descriptions is outside this feature.
- Reusing English scene vectors as target-locale rows is outside this feature.
- Re-running scene understanding for every locale in the catalog is not automatically in scope; v1 may target a prioritized locale cohort, but each processed locale must use raw localized inputs.
- Moving live user search orchestration into Mastra is outside this feature.
- Changing the embedding model is outside this feature unless planning proves the current model cannot support the localized artifact quality target.

## Dependencies / Assumptions

- Admin core sync already has coverage for non-English video metadata, dubs, subtitles, and language references; the current branch includes a preflight proof for that direction.
- Manager's current scene-analysis pipeline consumes a subtitle/transcript and visual context and writes `scene-analysis.json`; it needs locale-aware dispatch and locale-specific artifact keys.
- Admin's current `videosByCoreIds` dispatch projection selects primary-language media only; feat-120 needs a target-language dispatch projection or an additive parameter.
- Manager artifact storage currently uses `{assetId}/{artifactType}.json`; locale-specific artifacts need a safe naming convention.
- Some locales may lack localized dubs or subtitles. Those are data coverage blockers, not reasons to synthesize localized scene understanding from English.

## Outstanding Questions

### Resolve Before Planning

- OQ1. What is the first target cohort: one proof video and one locale, top 5 locales, top 20 locales, or another operator-selected slice?
- OQ2. Must v1 send actual video segments to the model, or is target-language Mux thumbnail frames plus target-language audio transcript acceptable as the first raw localized media implementation?
- OQ3. Should the public search path suppress source-language scene fallback for localized queries, or may it show fallback results with explicit non-localized provenance?

### Deferred to Planning

- OQ4. What locale-specific artifact key shape should Manager and Admin share?
- OQ5. Should localized scene-analysis artifacts include side-by-side source media metadata for audit, or only compact provenance fields?
- OQ6. How should operator reports roll up missing dub versus missing subtitle versus generated-transcript timeout?

## Sources / Research

- `docs/roadmap/content-discovery/feat-120-localized-scene-embeddings-and-snippets.md`
- `docs/roadmap/content-discovery/feat-040-multimodal-scene-descriptions.md`
- `docs/roadmap/content-discovery/feat-128-enrichment-backfill-failure-resilience.md`
- `apps/admin/src/services/core-sync/phases/sync-videos.test.ts`
- `apps/admin/src/services/core-sync/phases/sync-dubs.test.ts`
- `apps/admin/src/services/core-sync/phases/sync-video-subtitles.test.ts`
- `apps/admin/src/services/video.service.ts`
- `apps/admin/src/graphql/mutations/manager-enrichment.ts`
- `apps/admin/src/services/manager-trigger.service.ts`
- `apps/manager/src/lib/admin-trigger-route.ts`
- `apps/manager/src/workflows/sceneAnalysisPipeline.ts`
- `apps/manager/src/services/sceneAnalysis.ts`
- `apps/admin/src/services/manager-artifacts.service.ts`
