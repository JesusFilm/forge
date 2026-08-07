---
title: "Watch Localized Subtitle Search - Plan"
type: fix
date: "2026-08-07"
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
product_contract_source: ce-plan-bootstrap
execution: code
---

# Watch Localized Subtitle Search

## Goal Capsule

Fix FGE-3 at the shared indexing boundary so a public, playable video's
localized subtitle transcript can contribute semantic Watch search evidence
even when the video has no title or `VideoLocale` row in that language. Keep
Romanian title recovery and bounded cross-language fallback for inventory that
has no localized searchable text, and preserve target-language watchability
before pagination.

The implementation is complete when the seven reported Romanian queries have
regression coverage, subtitle-backed transcripts use exact persisted
provenance for public visibility in every language, unrelated/private evidence
stays private, Romanian recovery copy stays localized, and the operational
rollout explicitly rebuilds the transcript projection without regenerating
valid embeddings.

## Product Contract

### Problem

Watch already exposes localized subtitle tracks as playable inventory, and the
transcript backfill already prefers those timed-text tracks as localized
semantic source material. The Typesense transcript projection nevertheless
marks a transcript public only when a published `VideoLocale` has the same
BCP-47 tag. A Romanian subtitle transcript can therefore exist, be embedded,
and be playable while remaining permanently excluded from public search merely
because its display title falls back to English.

The existing FGE-3 branch adds Romanian title normalization plus bounded English
evidence fallback. That remains useful for title-only and dub-only gaps, but it
cannot recover localized transcript evidence that the index has already marked
private.

### Requirements

- **R1 — Localized subtitle evidence:** A transcript sourced from a currently
  available localized `VideoSubtitle` may be public without a same-language
  title row. Availability uses the same live edition, dub-to-video, language,
  and timed-text conditions as the Watch availability projection.
- **R2 — Exact source proof:** Subtitle visibility must be proven from the
  persisted source subtitle ID, Forge language ID, edition, and matching
  transcript language; a BCP-47 comparison alone is not language identity.
- **R3 — Public catalog baseline:** The video must remain non-deleted,
  indexable, and have at least one published display locale so the result is
  public and renderable.
- **R4 — Broad corpus contract:** Ineligible transcript chunks remain in the
  broad Typesense corpus with `publiclyVisible: false`; public search continues
  to filter on `publiclyVisible:=true`.
- **R5 — Playability before paging:** Broader or fallback evidence must not
  admit an English-only or otherwise non-target-playable result. Eligibility is
  applied before `offset` and `limit`.
- **R6 — Separate fallback role:** Keep language-scoped `Isus`/`Iisus` title
  normalization and one bounded English evidence lane for every non-English
  target. It is candidate-level recovery when native evidence does not match;
  native evidence remains preferred when both roles find the same video.
- **R7 — Original report:** Cover `JESUS`, `Isus`, `Iisus`, `fiul risipitor`,
  `anxietate`, `iertare`, and `Crăciun`, with title queries resolving the
  Romanian-playable JESUS inventory and topic queries able to use Romanian
  subtitle text.
- **R8 — Localized recovery UI:** Romanian no-results and recovery guidance may
  not fall back to English.
- **R9 — Safe rollout:** Existing vectors are reused for the projection change.
  A transcript projection rebuild is required; embedding repair is separately
  restricted by audited core ID, language, and repair category so it does not
  become a language-wide force run.

### Acceptance Examples

1. A video has a published English title, a live Romanian timed subtitle, a
   Romanian transcript with exact subtitle provenance, and Romanian subtitle
   availability. Its Romanian chunks index as public and a Romanian topic
   query can return the video with `target_subtitle` watchability.
2. The same transcript remains private if its source subtitle is deleted or no
   longer has timed text, its edition/language/dub link is unavailable, it
   belongs to another edition or language, has mismatched language provenance,
   or the video is deleted, `noIndex`, or lacks every published display locale.
3. A Manager/legacy transcript keeps the existing same-language published
   locale behavior; merely carrying a source language ID does not grant the new
   subtitle exception.
4. A stronger English-only result is rejected before both first-page and
   non-zero-offset slicing, allowing a later Romanian-playable result to fill
   the page.
5. English targets do not add an English fallback lane, while another
   non-English language proves the fallback is not Romanian-specific.

## Planning Contract

### Scope

In scope:

- Typesense transcript public-visibility projection.
- Indexer and serving regressions for localized subtitle evidence.
- The current branch's bounded English evidence fallback, Romanian title
  normalization, eligibility-before-pagination behavior, and Romanian copy
  gate.
- Roadmap, operational rebuild instructions, and durable search learning.

Out of scope:

- Mutating production catalog metadata to invent localized titles.
- Treating every internal transcript as public or removing the public search
  filter.
- Fetching subtitle URLs during an index build or comparing remote source text
  on every projection rebuild.
- Unbounded all-language embedding regeneration.
- Changing the public GraphQL response shape or Web request construction.

### Settled Decisions

- **KTD1 — Subtitle tracks are public search evidence independently of title
  localization.** A same-language title is presentation metadata, not proof
  that a localized timed-text track may be searched. _(session-settled; governs
  R1, R3)_
- **KTD2 — Exact stored provenance plus current availability grants the
  exception.** Require `source_kind = 'subtitle'`, exact source subtitle and
  language IDs, the same live edition, a live dub linking that edition to the
  video, a live language, current VTT or SRT timed text, and a matching
  source-language BCP-47. Do not infer identity from BCP-47 alone.
  _(session-settled; governs R1, R2)_
- **KTD3 — Keep the original public baseline and broad corpus.** Use correlated
  `EXISTS` predicates so the query remains one row per chunk and keyset
  pagination remains stable. _(research-settled; governs R3, R4)_
- **KTD4 — Preserve bounded English fallback as a separate recovery path.** It
  remains necessary for catalog titles, dub-only inventory, and missing
  localized transcript sources; target audio/subtitle proof stays mandatory
  for fallback-only candidates. _(session-settled; governs R5, R6, R7)_
- **KTD5 — Rebuild the serving projection before considering embeddings.** The
  visibility policy is derived data and does not invalidate correct stored
  vectors. _(research-settled; governs R9)_

### Research Basis

- `apps/admin/src/services/typesense-watch-search-indexer.ts` currently grants
  `publiclyVisible` only through a same-language published `video_locale`.
- `apps/admin/src/services/transcript-source-resolver.service.ts` resolves a
  target's exact subtitle before Manager fallback and emits subtitle ID,
  language ID/slug, format, URL, and content hash.
- `apps/admin/src/services/transcript-embedding-ingest.service.ts` persists
  those fields on `VideoTranscript`; Prisma already models
  `sourceSubtitleId`, `sourceLanguageId`, and `sourceLanguageSlug`.
- `apps/admin/src/services/typesense-watch-search.service.ts` applies the
  Typesense public-language filter and the current branch applies fallback
  target-watchability before paging.
- `CONCEPTS.md` separates corpus membership, public evidence visibility, and
  target result eligibility, and requires unique Forge identity for entity
  matching while reserving BCP-47 for locale execution.
- Relevant learnings: precomputed hybrid serving indexes, language identity on
  slug/ID, visible candidate windows, resumable transcript backfills, and the
  branch's cross-language playable-evidence controls.
- External research is intentionally omitted: the defect and required policy
  are internal data-model and serving-index contracts with direct repository
  evidence.

## High-Level Technical Design

```text
VideoSubtitle (exact ID + language ID + edition, live)
        + current Watch availability (live edition/dub/language + VTT/SRT)
        |
        v
VideoTranscript provenance ------------------------+
        |                                           |
        v                                           v
VideoTranscriptChunk -- Typesense rebuild --> publiclyVisible
                                              = public video/catalog
                                                AND (
                                                  same-language published locale
                                                  OR exact live subtitle source
                                                )
                                                        |
                                                        v
Watch semantic lane: public + evidence locale
                                                        |
                                                        v
target audio/subtitle eligibility before pagination
```

The subtitle exception is evaluated in Postgres while building transcript
documents. It does not remove private documents from the broad corpus and does
not change the vector. Serving continues to use the transcript's BCP-47 facet
for locale execution; the exception itself is proven by exact Forge IDs.

## Implementation Units

### U1 — Project exact subtitle provenance into public visibility

**Requirements:** R1, R2, R3, R4

**Files:**

- `apps/admin/src/services/typesense-watch-search-indexer.ts`
- `apps/admin/src/services/typesense-watch-search-indexer.test.ts`

**Approach:**

1. Refactor `loadTranscriptBatch`'s boolean expression so video-level public
   eligibility includes an `EXISTS` for at least one live published display
   locale, independent from evidence language.
2. Preserve the legacy same-language published-locale path.
3. Add a subtitle-only alternative requiring the exact source kind, subtitle
   ID, language ID, edition, live subtitle row, matching joined Language
   BCP-47, live edition/dub link, and current VTT or SRT source. Reuse the
   eligibility conditions in `loadSubtitleRows`; bind through
   `videoEditionId` because `VideoSubtitle.videoId` is nullable.
4. Use correlated `EXISTS`, not a row-multiplying join. Require only that a
   current VTT or SRT source is present; do not fetch remote subtitle content
   during projection. Source edits still require re-embedding and an unavailable
   or deleted track becomes private on the next transcript rebuild.
5. Extend the broad-corpus indexer fixture with an English-display/Romanian-
   subtitle positive and negatives for missing publication, deleted/no-index
   video, deleted/mismatched subtitle, missing timed text, unavailable
   edition/dub/language, wrong edition/language, missing subtitle provenance,
   and unchanged Manager/legacy behavior.

**Test scenarios:**

- The positive Romanian chunk is imported with `publiclyVisible: true` despite
  no Romanian `VideoLocale`.
- Every invalid-provenance and private-video variant is still imported but
  carries `publiclyVisible: false`.
- The generated SQL retains one ordered/keyset-paginated chunk stream and exact
  provenance predicates.

### U2 — Preserve and prove the two serving paths

**Requirements:** R5, R6, R7

**Files:**

- `apps/admin/src/services/typesense-watch-search.service.ts`
- `apps/admin/src/services/typesense-watch-search.service.test.ts`
- `apps/admin/src/services/watch-search-query-normalization.ts`
- `apps/admin/src/services/watch-search-query-normalization.test.ts`

**Approach:**

1. Reconcile the current dirty implementation around two explicit evidence
   roles: native localized evidence and bounded English fallback evidence.
2. Keep native evidence preferred when the same video appears in both roles;
   do not overwrite its localized snippet/language provenance with fallback.
3. Keep one English fallback for non-English targets within the existing
   evidence-locale and multi-search caps. English targets add no redundant
   fallback.
4. Preserve fallback-only target audio/subtitle hydration and eligibility
   before page slicing, including degraded legacy lexical projection behavior.
5. Retain Romanian-only `Isus`/`Iisus` expansion to canonical `JESUS`; do not
   map queries directly to catalog/video IDs.
6. Add a native Romanian subtitle semantic fixture with only an English display
   title, Romanian availability, and Romanian evidence, alongside a stronger
   non-target-watchable negative.
7. Make eligibility-before-pagination true across Typesense page boundaries:
   retrieve every lexical lane's bounded prefix through `offset + limit + 1`
   from page 1 in multi-search batches, fuse/deduplicate it, apply target
   watchability, and only then slice. Keep the existing candidate cap explicit;
   fail validation outside the supported eligible-result window instead of
   silently paging a raw, pre-eligibility window.

**Test scenarios:**

- All seven FGE-3 queries are represented; title variants use the bounded title
  path and topic queries can use native Romanian transcript evidence.
- Native evidence wins over duplicate fallback lanes without double-counting.
- English-only candidates are excluded before page 1 and non-zero offsets.
- A regression crossing the 250-group Typesense page boundary proves rejected
  fallback candidates on earlier pages do not create skips or duplicates.
- Subtitle-only target inventory qualifies; English native search and at least
  one other non-English target retain their controls.

### U3 — Localized recovery copy and repository contracts

**Requirements:** R8

**Files:**

- `apps/web/src/i18n/__tests__/messages-parity.test.ts`
- `apps/web/messages/ro.json` only if the audit finds missing or English copy
- `docs/roadmap/content-discovery/feat-339-watch-romanian-playable-search-inventory.md`
- `docs/roadmap/platform/feat-254-watch-universal-multilingual-search.md`
- `docs/roadmap/README.md`

**Approach:**

1. Keep the suite-wide structural, translation, and ICU message-catalog
   contracts as the source of truth. Romanian is non-provisional, so those
   generic contracts already prove its recovery messages exist, preserve ICU
   placeholders, and are not identical to English.
2. Update the ticket diagnosis from “missing English fallback” to the two-path
   model: exact localized subtitle evidence first, bounded playable fallback for
   gaps.
3. Regenerate roadmap output with the repository's normal generator rather
   than retaining line-ending or formatting-only churn.

**Test scenarios:**

- Romanian no-results heading and retry guidance stay localized.
- Generated roadmap artifacts pass drift checks with no unrelated rewrite.

### U4 — Operational projection repair and durable learning

**Requirements:** R9

**Files:**

- `apps/admin/src/scripts/index-typesense-watch-search.ts` tests/docs if needed
- `docs/operations/typesense-watch-search-production-readiness.md`
- `docs/solutions/logic-errors/watch-search-cross-language-playable-evidence-fallback.md`
- A focused operations/solution note if the existing learning cannot accurately
  capture subtitle visibility and rebuild sequencing

**Approach:**

1. Document a pre-rebuild audit for localized subtitle rows, exact transcript
   provenance, gateway/model/dimension stamps, vector presence, and typed source
   gaps.
2. Make the required rollout command explicit:
   `index-typesense-watch-search --rebuild-transcripts`, followed by alias,
   public-document-count, and representative no-localized-title verification.
3. Require the audit to emit `(coreId, language, repair category)` command
   scopes and enumerate every matching edition. Document repeated `--core-id`
   plus `--language` invocations: idempotent for missing rows, repair for
   matching-provenance unhealthy chunks, and force only when every edition in
   that CLI scope is audited as stale or provenance-less. A projection policy
   change alone must not call an embedding provider or trigger a language-wide
   force run.
4. Record that routine metadata runs reuse transcript aliases, so subtitle
   provenance/deletion and public-visibility changes require a transcript
   projection rebuild until a separate incremental visibility refresh exists.
5. Update the canonical production-readiness runbook with the provenance audit,
   projection-only rebuild wording, stats/alias verification, targeted repair,
   capacity prerequisites, and the existing immediate traffic rollback:
   `WATCH_SEARCH_PRIMARY_MODE=DEFAULT`. Do not promise post-success alias
   rollback; the capacity-constrained service retires the prior vector
   generation after publication and recovers it from a snapshot or rebuild.

**Test scenarios:**

- CLI help/argument coverage continues to distinguish metadata reuse from
  explicit transcript rebuild.
- Documentation separates projection rebuild from optional embedding repair and
  uses the established PostgreSQL `DEFAULT` traffic switch for immediate
  rollback, with snapshot/rebuild recovery for the Typesense projection.

## System-Wide Impact

- **Data:** No schema migration. Existing `VideoTranscript` provenance becomes
  an enforced serving eligibility input.
- **Search:** More localized semantic evidence becomes publicly retrievable;
  the target-watchability gate prevents broader evidence from changing result
  eligibility.
- **Performance:** Correlated indexed `EXISTS` checks add work only during an
  explicit transcript rebuild. They avoid row multiplication and preserve
  chunk keyset pagination. Validate with representative query planning if a
  production-sized snapshot is available.
- **Operations:** Deploying code alone does not change the active transcript
  alias. A controlled rebuild is a release step; embedding backfill is
  conditional data repair.
- **Security/privacy:** `publiclyVisible` remains mandatory. Exact live source
  provenance narrows the new exception and no raw vectors or source URLs enter
  public response shapes.

## Verification Contract

### Automated gates

- Focused Admin tests:
  `pnpm --filter @forge/admin test -- typesense-watch-search-indexer.test.ts typesense-watch-search.service.test.ts watch-search-query-normalization.test.ts`
- Subtitle provenance source tests if touched:
  `pnpm --filter @forge/admin test -- transcript-source-resolver.service.test.ts transcriptEmbeddingBackfill.test.ts`
- Web locale tests:
  `pnpm --filter @forge/web test -- src/i18n/__tests__/messages-parity.test.ts`
- Type checks:
  `pnpm --filter @forge/admin typecheck` and
  `pnpm --filter @forge/web typecheck`.
- Touched-scope lint and formatting plus repository diff checks.
- Roadmap generation/drift check for `docs/roadmap/README.md`.

### Manual/operational gates

1. Audit a Romanian video with an English-only display locale for live Romanian
   subtitle provenance and valid transcript chunks.
2. Rebuild a non-production transcript collection, verify public/private counts,
   inspect the generated document, and exercise the seven FGE-3 queries.
3. Confirm the returned video is Romanian playable and topic results expose a
   Romanian transcript snippet when native evidence wins.
4. Verify an English-only negative and a private/deleted source negative.
5. Run affected `/watch` browser tests, open/close Search, check console errors,
   and confirm loading/hydration behavior is unchanged.
6. For production rollout, confirm the capacity prerequisite before an explicit
   transcript rebuild and verify the `DEFAULT` traffic rollback remains ready;
   do not retain a second broad vector generation on the 16 GiB service.

## Risks and Dependencies

- Existing Romanian rows may lack subtitle provenance or vectors. The index
  change cannot create missing searchable text; the pre-rebuild audit decides
  whether a scoped backfill is needed.
- A live subtitle can change after embedding. The persisted content hash makes
  drift auditable, but only re-embedding updates stale semantic content.
- Routine index builds reuse transcript visibility. The rollout must not claim
  success until the transcript alias points at the rebuilt collection.
- Production data and Typesense access are external operational dependencies;
  local completion proves behavior and supplies the exact controlled rollout,
  but does not authorize a direct production deploy.

## Definition of Done

- U1–U4 are implemented and their test scenarios pass.
- Public subtitle-backed transcript visibility works for any language without a
  same-language title and remains tied to exact live provenance.
- The original Romanian regression matrix, bounded fallback controls,
  eligibility-before-pagination behavior, and localized copy all pass.
- No public GraphQL schema or generated GraphQL type changes are introduced.
- Admin/Web typecheck, focused tests, lint/format, roadmap drift, and affected
  browser checks pass without unrelated performance or hydration regressions.
- The roadmap ticket is `complete`, the durable learning describes both native
  subtitle evidence and fallback evidence, and the PR documents the required
  transcript rebuild plus conditional backfill audit.
