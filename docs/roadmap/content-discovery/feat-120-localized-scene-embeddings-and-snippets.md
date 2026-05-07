---
id: "feat-120"
title: "Localized Scene Embeddings + Translated Snippets — true per-locale semantic search"
owner: "nisal"
priority: "P1"
status: "not-started"
start_date: "2026-05-13"
duration: 7
depends_on:
  - "feat-119"
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

Today's R1 indexer (`apps/admin/src/services/scene-embedding.service.ts`) writes per-locale rows in `video_scene_locale`, but every locale row stores the **same source-language scene description** (English, from manager's `scene-analysis.json`) and the **same 1536-d embedding** generated from that English text. The 2,122 distinct locales we embed give us cross-lingual search via `text-embedding-3-small`'s multilingual vector space, but the embedded **content** is always English/source.

Concrete proof from the local DB after a fresh R1 backfill (one scene of one video, 5 Chinese locale variants):

| locale       | description (first 90 chars)                                  | embedding (first 50 chars)                   |
| ------------ | ------------------------------------------------------------- | -------------------------------------------- |
| `en`         | `Themes: identity, grace, redemption, self-worth, freedom...` | `[0.048431396,0.016708374,0.0033664703,...]` |
| `zh`         | `Themes: identity, grace, redemption, self-worth, freedom...` | `[0.048431396,0.016723633,0.0033779144,...]` |
| `zh-hans`    | `Themes: identity, grace, redemption, self-worth, freedom...` | `[0.048431396,0.016708374,0.0033664703,...]` |
| `zh-hant`    | `Themes: identity, grace, redemption, self-worth, freedom...` | `[0.048431396,0.016708374,0.0033664703,...]` |
| `zh-Hant-TW` | `Themes: identity, grace, redemption, self-worth, freedom...` | `[0.048431396,0.016708374,0.0033664703,...]` |

The Chinese rows contain English text. Vectors are functionally identical (sub-1e-5 float drift from API non-determinism). The only thing that differs is the `locale` field.

Two consequences:

1. **Search result UI snippets are always English.** A Spanish-speaking user gets English snippets in their result cards. The locale filter scopes results to videos with a playable dub in their language, but the displayed content is wrong-language.
2. **Search ranking is cross-lingual at best.** `text-embedding-3-small` handles cross-lingual queries reasonably (~0.7–0.85 cosine for parallel text vs ~0.85–0.95 intra-language on academic benchmarks), but loses nuance on idioms, religious terminology variants, and region-specific vocabulary. We have no held-out eval to know the magnitude of the gap on JFP's actual catalog and queries.

## Entry Points — Read These First

1. `apps/admin/src/services/scene-embedding.service.ts` — the indexer that today embeds source text once per locale. Line ~260: `sourceTexts = artifact.scenes.map((s) => s.description.trim())` is where localization needs to land.
2. `apps/manager/src/services/sceneAnalysis.ts` — manager's single-language scene-analysis pipeline. Decides whether localization happens upstream (manager produces a localized artifact per locale) or downstream (admin translates at index time).
3. `apps/admin/src/services/embeddings.service.ts` (`generateExperienceEmbeddings`) — the batched OpenRouter call site. Same call works for translated text; no change needed.
4. `apps/admin/prisma/schema.prisma` — `VideoSceneLocale` model. Decision needed on whether to add a separate `description_localized` column or overwrite `description`.
5. `apps/admin/src/services/hybrid-search.service.ts` + `apps/admin/src/services/hybrid-search-retrievers.ts` — the search query path. Snippet display + ranking changes land here.
6. `docs/solutions/best-practices/per-parent-child-memoization-loadedartifact-pattern-20260505.md` — feat-116's group-level memoization pattern. Translation step needs to slot into this without breaking the artifact-load cascade.
7. `docs/solutions/runtime-errors/aws-s3-nosuchkey-classification-pattern-20260506.md` — feat-119 PR1's classification rule. Translation failures need similar typed-error treatment.

## Grep These

```
grep -rn "scene.description\.trim\|sourceTexts" apps/admin/src/services/scene-embedding.service.ts
grep -rn "createStructuredOpenrouterOutput\|DEFAULT_MODEL" apps/manager/src/services/openrouter.ts
grep -rn "video_scene_locale\|VideoSceneLocale" apps/admin/prisma/schema.prisma
grep -rn "generateExperienceEmbeddings\|EMBEDDING_MODEL" apps/admin/src/services/embeddings.service.ts
grep -rn "locale=\|locale:" apps/admin/src/services/hybrid-search-retrievers.ts
```

## What To Build

A **translation-based** pipeline that produces genuinely localized scene descriptions + embeddings per locale, without re-running multimodal scene-analysis (cost-prohibitive at $106k+ catalog).

### Pipeline shape

For each `(video, edition, locale)` target:

1. Read manager's source-language `scene-analysis.json` (already memoized per `(video, edition)` group from feat-116).
2. **Translate** each `scene.description` from source language to target locale's language.
3. **Embed** the translated text via the existing `generateExperienceEmbeddings(translated[])` batched call.
4. Bulk-INSERT one `video_scene_locale` row per scene with the translated `description` and the translated embedding (existing INSERT path from feat-117 carries the new content unchanged).

### Cost target

**≤ $1,000 one-time for the full catalog.** Anchor: Gemini Flash translation runs at ~$0.0001 per (scene, locale), so 832 videos × ~30 scenes × top-N locales × $0.0001. Top-20 locales coverage: ~$50. All 2,122 locales: ~$500–$1,200 depending on cache hit rate. Re-running multimodal scene-analysis ($106k) is **explicitly out of scope** — see Constraints.

### User-facing changes

- **Search result snippets** display the localized scene description in the user's locale (not English).
- **Search ranking** for queries in non-English locales improves measurably on a held-out eval set (top-K recall ↑ vs English-baseline embeddings).
- API contract is **additive** — existing `description` field stays present; either it becomes localized or a new `descriptionLocalized` field appears alongside (decision deferred to plan).

### Operator surface

- New CLI: `pnpm --filter @forge/admin run-localized-embeds --pipeline=scene` (mirrors `run-embeds`'s shape from PR1)
- Optionally extend feat-119 PR2's `triggerManagerEnrichment` mutation with a `languageCode` parameter so operators can backfill specific (asset, locale) pairs on demand
- Per-target outcome enum: `succeeded | skipped_unchanged | skipped_artifact_missing | skipped_source_language_match | failed_translation | failed_embedding | failed`

## Open Questions / Decisions Deferred to /ce:plan

| #   | Question                                                                                                                                                                                                                     | Default if not decided                                                                                                                 |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | -------------------- | -------------- | -------------- |
| Q1  | **Primary user value** — search ranking quality, localized snippets, or both? Drives eval methodology + whether re-embedding is required at all.                                                                             | Both (snippets cheap once translation lands; ranking improvement is the eval signal)                                                   |
| Q2  | **Translation provider** — Gemini Flash (cheap, broad coverage), Claude Haiku (higher quality, fewer langs), DeepL (high quality, narrow lang set), self-hosted NLLB-200 (free marginal cost, infra to maintain), or tiered. | Gemini Flash via OpenRouter (matches existing infra; no new vendor)                                                                    |
| Q3  | **Translation location** — manager produces localized `scene-analysis-{locale}.json` artifacts (more reusable, larger storage footprint) vs admin translates at index time (more flexible, no manager change).               | Admin index-time (avoids changing manager's pipeline; admin already owns the embedding step)                                           |
| Q4  | **Coverage scope** — top-N locales (top-20 covers ~80% of catalog) vs full 2,122 locales. Cost differential is ~10×.                                                                                                         | Top-20 eager + operator-triggered long-tail                                                                                            |
| Q5  | **Storage shape** — overwrite `video_scene_locale.description` with translated text vs add separate `description_localized text` column (preserves source for debugging).                                                    | Add `description_localized text` column (preserves source; allows side-by-side ranking eval)                                           |
| Q6  | **Backfill strategy** — eager batch (like R1), lazy on-query-miss (cheap upfront, slow first hit), or operator-triggered (selective).                                                                                        | Eager batch for top-20; operator-triggered for long-tail                                                                               |
| Q7  | **Re-embed invalidation** — when source description changes, when translation provider changes, when target language changes. Need a versioned content-hash that includes (sourceText + translationModel + targetLang).      | Content-hash envelope: `${HASH_VERSION}                                                                                                | ${TRANSLATION_MODEL} | ${TARGET_LANG} | ${sourceText}` |
| Q8  | **Search ranking change** — keep current cross-lingual filter behavior (any locale matches if vector is close) vs locale-strict (only match same-locale rows). Need an A/B-able switch.                                      | Locale-strict by default with cross-lingual fallback when no locale-strict matches above threshold                                     |
| Q9  | **Eval methodology** — how do we know localized embeddings beat the cross-lingual baseline? Need a held-out set of (query, language, expected-result) tuples in 5+ languages.                                                | Bootstrap a 100-query held-out set per language using Gemini-generated synthetic queries vs a manual gold standard for top 5 languages |
| Q10 | **Coordination with cross-lingual fallback** — when target-locale row is missing/skipped, fall through to source-language embedding for ranking. Naïve approach is two SELECTs in the retriever.                             | Single SQL with `COALESCE(target_locale_row, source_locale_row)` semantics                                                             |

## Constraints (what NOT to do)

- **No re-running multimodal scene-analysis per locale.** Cost ($106k catalog) is prohibitive. Stick to translation of the existing English description.
- **Per-locale row count stays the same.** ~400k `video_scene_locale` rows; only the per-row content changes. No schema changes that fan out cardinality.
- **`text-embedding-3-small` stays as the embedding model.** It's multilingual at the vector-space level and feat-115/116/117 are tuned to its 1536-d output. Switching to a different model is a separate ticket.
- **GraphQL never exposes embeddings.** Existing `apps/admin/src/graphql/schema.test.ts` `embed|vector|similarit` guard stays in force. Translated text on `video_scene_locale.description_localized` MUST also pass that guard or be exposed via a typed read.
- **Per-locale partial HNSW indexes stay** (`en`, `es`, `fr` partial + global NULL-excluded). No change to indexes unless the storage shape decision (Q5) demands it.
- **Cost budget: ≤ $1,000 one-time for the full catalog.** Translation path stays under this; re-analysis path is out.
- **Don't break feat-119 PR2's trigger surface.** If extending `triggerManagerEnrichment` with a `languageCode` parameter, do it additively with an optional arg (new mutation if shape gets ugly).
- **Translation failures must classify like artifact failures (per feat-119 PR1).** Use typed `error.name` first, regex backstop second. Sync-throw test required.
- **No lock-step deploys.** New columns nullable; backfill happens incrementally; search retriever tolerates rows where `description_localized IS NULL` (falls back to source).

## Verification

After implementation:

1. **Schema**: `apps/admin/prisma/schema.prisma` shows new `description_localized text?` column on `VideoSceneLocale` (per Q5 default).
2. **Database**: `SELECT COUNT(*) FROM video_scene_locale WHERE locale = 'es' AND description_localized IS NOT NULL` is non-zero (specifically: matches the count for `locale='es'` rows after backfill).
3. **Localized text**: pull a row with `locale='es'` and verify `description_localized` is in Spanish (not English). Same for `locale='zh-hans'` (Simplified Chinese), `locale='ar'` (Arabic).
4. **Embedding distinctness**: cosine similarity between `(scene_X, locale='es').embedding` and `(scene_X, locale='en').embedding` is **lower** than the prior baseline (which was ~1.0 because they were identical). Should land in the 0.85–0.95 range — high but not identical.
5. **Search ranking**: a Spanish query like `"vida eterna"` against the held-out eval set scores measurably higher top-K recall than the English-only baseline. Specific threshold determined during plan.
6. **Snippet display**: a search query with `locale=es` returns result cards whose `descriptionLocalized` field contains Spanish text. UI surfaces this field instead of the source-language `description`.
7. **Cost**: total OpenRouter spend for the backfill is ≤ $1,000 (sub-budget). Verified by capturing per-call usage and summing.
8. **Operator workflow**:
   - `pnpm --filter @forge/admin run-localized-embeds --pipeline=scene --core-id=2_0-Crushing` — succeeds for one video, writes ~12 locale-specific descriptions + embeddings
   - `pnpm trigger-enrichment --asset-id=N --core-id=X --kind=scene-analysis --language-code=es` (if Q3 lands manager-side) — produces a localized artifact for one (asset, locale) pair
9. **Cross-lingual fallback**: a query in a locale that has NO localized embeddings (e.g. a long-tail locale not in top-20) still returns results — falls back to source-language embeddings. Not a 0-result page.

## Future Considerations

- **Re-analyze high-priority videos with localized multimodal scene-analysis.** For top-traffic videos, run Gemini multimodal with the localized subtitle + 3 still frames to get genuinely-analyzed-from-source descriptions per locale. Hybrid path: translation by default, multimodal re-analysis as opt-in for the top 100 videos. Out of scope here; revisit if eval shows translation-only is insufficient for high-value content.
- **Lazy translation on query miss.** When a query in locale='es' returns no locale-strict matches, translate-and-embed the top-K source-language matches on-the-fly and cache for future queries. Avoids the upfront translation cost for long-tail locales. Out of scope; revisit when long-tail traffic is observed in production.
- **Per-locale content-hash skip.** Like the dropped feat-118 was supposed to do for the source axis, a content-hash on `(sourceText + translationModel + targetLang)` would make re-runs cheap. Defer to a follow-up ticket once we know the re-run cadence in practice.
- **Translation provider tiering.** Gemini Flash for the bulk; Claude Haiku for the top 5 languages where ranking quality matters most. Worth measuring on the eval set before deciding.
- **Subtitle-grounded translation.** Translate the scene description WITH the localized subtitle as context, so the translation aligns with the dub's actual word choices. Better than naive English→target translation; modest cost increase.
- **Search quality dashboard.** Operator-facing dashboard showing per-locale top-K recall over time. Detects translation-quality regressions when providers update their models.
