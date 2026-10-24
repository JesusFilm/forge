---
id: "feat-120"
title: "Raw Localized Scene Understanding + Embeddings"
owner: "nisal"
priority: "P1"
status: "complete"
start_date: "2026-05-13"
duration: 7
depends_on:
  - "feat-119"
  - "feat-154"
blocks: []
tags:
  - "admin"
  - "manager"
  - "ai-pipeline"
  - "search"
  - "i18n"
  - "embeddings"
---

## Problem

`feat-154` must capture a production seed-only search-eval baseline before this
ticket changes multilingual semantic search behavior. That baseline is the
pre-change quality artifact used to compare raw localized scene understanding,
localized snippets, and ranking behavior against the current production search
workflow.

Today's scene embedding path writes per-locale rows in `video_scene_locale`, but
the source scene analysis is still the same Manager artifact:
`{assetId}/scene-analysis.json`. That artifact is currently produced from one
selected source media context, usually the primary-language path. Embedding that
same artifact for every locale does not prove localized understanding.

Do **not** solve this by translating the English scene-analysis description and
embedding the translated text. That is not raw localized scene understanding.
For this ticket, a target-locale scene embedding must come from a target-locale
scene-analysis artifact generated from the target-language media context: the
localized dub/video source, localized subtitle or transcript, and localized
scene-analysis output.

## Requirements Origin

- `docs/brainstorms/2026-06-02-raw-localized-scene-understanding-requirements.md`

## Entry Points - Read These First

1. `apps/admin/src/services/core-sync/phases/sync-videos.test.ts` -
   current proof that Core sync imports non-English primary-language metadata.
2. `apps/admin/src/services/core-sync/phases/sync-dubs.test.ts` -
   current proof that Core sync imports non-English dub language and Mux
   linkage.
3. `apps/admin/src/services/core-sync/phases/sync-video-subtitles.test.ts` -
   current proof that Core sync imports non-English subtitle rows and VTT/SRT
   sources.
4. `apps/admin/src/services/video.service.ts` - `getByCoreIds` currently
   selects primary-language dispatch fields only. This needs a target-language
   dispatch variant or additive parameter.
5. `apps/admin/src/graphql/mutations/manager-enrichment.ts` +
   `apps/admin/src/services/manager-trigger.service.ts` - Admin's
   operator-facing trigger to Manager. Current body carries `assetId`, `coreId`,
   and `kind`, but no target locale/language.
6. `apps/manager/src/lib/admin-trigger-route.ts` -
   Manager's admin-trigger receiver. Current `AdminTriggerItemSchema` has no
   target locale/language, and dispatch keys are keyed by kind + assetId only.
7. `apps/manager/src/workflows/sceneAnalysisPipeline.ts` -
   scene-analysis workflow. It accepts `languageCode`, uses a subtitle URL when
   present, otherwise transcribes with that language code.
8. `apps/manager/src/services/sceneAnalysis.ts` - scene understanding service.
   It analyzes visual context plus transcript chunks and writes the scene
   artifact.
9. `apps/admin/src/services/manager-artifacts.service.ts` +
   `apps/admin/src/workflows/_steps/load-manager-artifact.ts` - Admin artifact
   reader. It currently reads only `{assetId}/scene-analysis.json`.
10. `apps/admin/src/workflows/sceneEmbeddingBackfill.ts` +
    `apps/admin/src/services/mastra-scene-embedding-client.ts` +
    `apps/mastra/src/mastra/workflows/scene-embedding.ts` - embedding launch
    and Mastra scene embedding path. These should consume locale-specific
    Manager artifacts, not translate source artifacts.

## Grep These

```bash
rg -n "VideoForEnrichment|getByCoreIds|primaryLanguageBcp47|muxAssetId|subtitleUrl" apps/admin/src apps/manager/src
rg -n "AdminTriggerItemSchema|AdminTriggerDispatchInput|inFlightKey|languageBcp47" apps/manager/src/lib/admin-trigger-route.ts
rg -n "runSceneAnalysisPipeline|languageCode|subtitleUrl|transcribe" apps/manager/src/workflows/sceneAnalysisPipeline.ts
rg -n "writeArtifact|scene-analysis|readSceneAnalysisArtifact|artifactKey" apps/manager/src/services apps/admin/src/services apps/admin/src/workflows
rg -n "launchMastraSceneEmbedding|sceneAnalysis|artifactVersion" apps/admin/src apps/mastra/src
```

## What To Build

A **raw localized scene-understanding** pipeline:

1. Admin enumerates `(video, edition, targetLocale)` targets from real data:
   primary language, localized dubs, localized subtitles, and Mux metadata.
2. Admin resolves target-language dispatch fields for each target, selecting
   the target-language Mux source and target-language subtitle when available.
3. Admin sends Manager a scene-analysis trigger that includes the requested
   target locale/language.
4. Manager runs scene analysis using the target-language media context:
   localized dub/video source plus localized subtitle/transcript. If a target
   subtitle is missing, Manager may transcribe the target-language dub audio; it
   must not substitute an English transcript.
5. Manager writes a locale-specific scene-analysis artifact with provenance
   describing the input language, Mux/source media, subtitle/transcript source,
   and generation mode.
6. Admin/Mastra embeds that locale-specific artifact exactly as produced. Mastra
   does not translate an English artifact during embedding.
7. Admin stores localized scene text and vectors for the requested locale only
   when the source artifact was generated from that locale's raw media context.

## Explicit Non-Goal

The following path is not acceptable for feat-120:

1. Read English/source `scene-analysis.json`.
2. Translate the English scene descriptions.
3. Embed the translated descriptions.
4. Store the translated descriptions as if they were raw localized scene
   understanding.

That shortcut may be cheap, but it is not authentic localized media
understanding and should not be implemented in this ticket.

## Operator Surface

- Extend the existing manager-enrichment trigger shape so operators can request
  scene analysis for specific target locales/languages.
- Extend the scene embedding backfill flow so it can require locale-specific
  scene-analysis artifacts before launching Mastra.
- Reports must distinguish:
  - missing localized dub
  - missing localized subtitle/transcript
  - localized scene-analysis generation failure
  - localized artifact missing
  - embedding failure
  - storage failure

## Open Questions / Decisions Deferred to /ce:plan

| #   | Question                                                                                                                                               | Default if not decided                                                                                     |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| Q1  | First cohort - one proof video and one locale, top 5 locales, top 20 locales, or operator-selected slice?                                              | Start with one proof video + Spanish, then one additional non-Latin-script locale before broader backfill. |
| Q2  | Raw video input - must v1 send actual video segments to the model, or are target-language Mux frames plus target-language transcript acceptable?       | Treat actual localized Mux video/audio as required; frames-only needs explicit approval during planning.   |
| Q3  | Locale-specific artifact key shape - `{assetId}/scene-analysis-{locale}.json`, nested path, or versioned artifact envelope?                            | Use an additive locale-specific artifact key and keep `{assetId}/scene-analysis.json` as source artifact.  |
| Q4  | Search fallback - should requested-locale scene search suppress source-language scene fallback, or show fallback with explicit non-localized metadata? | Do not count fallback as feat-120 success; default to locale-strict scene evidence for validation.         |
| Q5  | Output language - should Manager emit all scene descriptions/facets in the target language, or keep canonical facets in English?                       | Descriptions/snippets in target language; canonical facet handling decided in planning.                    |

## Constraints

- Do not translate English scene-analysis descriptions as the localization
  mechanism.
- Do not write target-locale `VideoSceneLocale` rows from source-language scene
  artifacts.
- Do not let source-language fallback hide missing localized media inputs.
- Do not infer source media language from `Video.primaryLanguage` alone when a
  target locale was requested; select the target-language dub/subtitle rows.
- Do not move live user search orchestration into Mastra.
- Do not expose embeddings through GraphQL.
- Keep deploys additive: existing source scene-analysis artifacts and current
  source-locale embedding paths should continue to work while localized artifact
  support rolls out.

## Verification

1. **Core sync proof:** targeted tests prove Admin imports non-English video
   metadata, dubs, subtitles, language ids, and Mux links.
2. **Dispatch selection:** an Admin test proves a Spanish scene-analysis request
   resolves Spanish Mux/subtitle inputs, not primary-language English inputs.
3. **Manager trigger shape:** a Manager route test proves `targetLocale` or
   equivalent target language field is accepted, participates in idempotency,
   and is passed to `runSceneAnalysisPipeline`.
4. **Raw localized pipeline:** a Manager workflow test proves a target-language
   subtitle URL or target-language dub transcription path is used for the scene
   analysis transcript.
5. **Artifact separation:** Manager writes a locale-specific scene-analysis
   artifact and does not overwrite `{assetId}/scene-analysis.json`.
6. **Embedding source:** Admin/Mastra tests prove the scene embedding workflow
   loads the locale-specific artifact and does not translate descriptions.
7. **Database:** after a proof run, `video_scene_locale` rows for `locale='es'`
   have descriptions sourced from the Spanish scene-analysis artifact.
8. **Authenticity audit:** compare the Spanish artifact against the English
   artifact and verify it was generated independently from Spanish media
   context, not by translating English scene descriptions.
9. **Search behavior:** a Spanish query returns scene evidence/snippets from
   Spanish raw-localized scene rows. If fallback is allowed, it is explicit and
   not counted as localized-scene success.

## Future Considerations

- Subtitle-grounded refinements for locales where the dub and subtitle diverge.
- Tiered raw localized analysis for high-traffic videos before full-catalog
  rollout.
- Search quality dashboard that tracks native-language query performance by
  artifact provenance.
- Optional comparison of raw localized artifacts versus translated-English
  artifacts as an evaluation baseline, not as the production implementation.
