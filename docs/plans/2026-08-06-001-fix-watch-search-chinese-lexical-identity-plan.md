---
title: "Watch Search Chinese Lexical Identity - Plan"
type: fix
date: 2026-08-06
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
product_contract_source: ce-plan-bootstrap
execution: code
---

# Watch Search Chinese Lexical Identity - Plan

## Goal Capsule

- **Outcome:** Modern Watch Search retrieves the canonical JESUS film when an anonymous English-display user searches `耶稣` or `耶穌`, while hydration still selects playable `mandarin-china` audio.
- **Approach:** Represent query-script lexical routing separately from playback targeting. Han queries use the Typesense `zh` tokenizer and exact Chinese localization slugs; playback continues to use the existing resolved target language.
- **Success signal:** A production-shaped service fixture, where the localized title slug is `chinese-simplified` or `chinese-traditional` and the playable audio slug is `mandarin-china`, returns JESUS through the title lane with target audio.
- **Stop conditions:** Stop if the fix would require broad BCP-47 identity matching, a public GraphQL contract change, a lexical index rebuild, production deployment, or changes outside Admin search ownership.
- **Tail ownership:** Complete focused tests, Admin typecheck/lint/format checks, formal code review, the roadmap completion update, and a durable solution note. Production rollout remains a separate operator action.

## Product Contract

### Summary

Modern Watch Search currently conflates two distinct language concepts for Han queries: the language of localized searchable text and the desired playback audio. `耶稣` resolves to the playable target `mandarin-china`, but the canonical JESUS title is indexed under the exact localization identity `slug:chinese-simplified`. The request filters the latter out, leaving only weaker semantic transcript matches.

The fix introduces an internal lexical query context derived from the query script. It selects the tokenizer fields and exact localization identities that may contain the query text without changing the public response or the target-audio selection chain.

### Problem Frame

- Production reproduces the screenshot: `耶稣`, no selected search language, and an English display context returns two semantic-only results while the lexical lanes are empty.
- The canonical JESUS video has published localized titles `耶稣` (`chinese-simplified`) and `耶穌` (`chinese-traditional`) and playable audio under `mandarin-china`.
- Typesense correctly indexes each localized document under its exact Forge `Language.slug`. The defect is request-time routing: the lexical filter is built from the playback target.
- The existing Chinese unit fixture uses `mandarin-china` as both query/localization slug and audio slug. That shape cannot catch the production mismatch.

### Requirements

- **R1.** A Han-script query with no explicit query language selects the Typesense `zh` title and metadata fields.
- **R2.** Han-script lexical requests admit only the explicit exact localization identities `slug:chinese-simplified` and `slug:chinese-traditional`. The generic safe-locale compatibility fallback remains available to non-Han paths but is not used to broaden Han identity.
- **R3.** Han detection continues to resolve the playback target to `mandarin-china`; lexical routing must not replace, alias, or broaden that exact target identity.
- **R4.** A production-shaped `耶稣` fixture retrieves the canonical JESUS family through the localized title lane and returns playable `mandarin-china` target audio.
- **R5.** A production-shaped `耶穌` fixture can retrieve the Traditional Chinese title through the same `zh` tokenizer without admitting unrelated language identities.
- **R6.** An English `JESUS` query with an explicitly selected Mandarin target retains English lexical retrieval and Mandarin target-audio hydration.
- **R7.** Existing non-Han language routing, semantic evidence-language selection, ranking, canonical deduplication, pagination, and degraded-lane behavior remain unchanged.
- **R8.** The public GraphQL input/output contract and current Web request remain unchanged.
- **R9.** Focused Admin tests use the actual production distinction between localized text slug and playable audio slug; deleting the new lexical routing must make those tests fail.

### Acceptance Examples

- **AE1:** Given query `耶稣`, English display language, no explicit target, a localized JESUS document keyed by `slug:chinese-simplified`, and a `mandarin-china` audio option, the title request uses `title_zh`, filters for the exact Chinese localization identities, returns JESUS, and hydration reports target audio.
- **AE2:** Given query `耶穌` and a localized JESUS document keyed by `slug:chinese-traditional`, the title request uses `title_zh` and returns JESUS without matching an unrelated language that merely shares a locale family.
- **AE3:** Given query `JESUS` with explicit target `mandarin-china`, the title request retains the English lexical identity/fields and the result uses Mandarin target audio.
- **AE4:** Given a Thai, Russian, or other existing script/query-language case, its current tokenizer, exact identity filter, and target behavior are unchanged.

### Scope Boundaries

**In scope**

- Internal query-script lexical context in Admin language resolution or a focused colocated helper.
- Typesense lexical request construction using separate tokenizer and exact localization identity inputs.
- Production-shaped resolver/service regression tests.
- Roadmap and solution documentation.

**Out of scope**

- Typesense schema, lexical projection, aliases, or physical collection rebuilds.
- Transcript embeddings, semantic ranking weights, query embeddings, or evaluation-corpus tuning.
- Web UI or language-picker redesign.
- Public GraphQL schema changes.
- Production deployment, index refresh, or remote evaluation execution.

## Planning Contract

### Key Technical Decisions

- **KTD1. Separate lexical text routing from playback targeting.** Query script answers “which localized text documents/tokenizer can match this text”; target resolution answers “which playable language should hydration prefer.” One value must not stand in for both. Governs R1-R7.
- **KTD2. Preserve exact Forge slug identity.** The query may explicitly choose multiple known Chinese localization slugs, but it must not infer identity through BCP-47 prefix matching. `Language.slug` remains the exact Typesense facet boundary; `zh` remains tokenizer configuration only. Governs R2, R5, R7.
- **KTD3. Script inference is fallback lexical context, not explicit-user intent.** Explicit `queryLanguageSlug` and named-language behavior retain priority. Han-script lexical routing applies only when those stronger query-language signals are absent, so English text with a selected Mandarin playback target still searches English metadata. Governs R3, R6-R7.
- **KTD4. Keep the index projection unchanged.** Production data is already correctly indexed under `chinese-simplified` and `chinese-traditional`; changing query construction is sufficient and avoids a risky rebuild. Governs R1-R5, R8.
- **KTD5. Pin the real producer shape at the service boundary.** Resolver tests prove script-context branch behavior; a service fixture proves the complete production contract across localization retrieval and target-audio hydration. Governs R4-R6, R9.

### High-Level Technical Design

1. Extend the internal language-resolution result (or a focused helper used by it) with a bounded query-script lexical context: tokenizer locale plus exact candidate localization slugs. Han maps to `zh` and the Simplified/Traditional Chinese localization slugs while retaining `mandarin-china` as its target-language hint.
2. In `TypesenseWatchSearchService.search`, derive lexical tokenizer/identity inputs from explicit query language first, query-named language second, query-script context third, and display/target/route fallback last. Do not make the playback target the lexical identity for English text with a manually selected target.
3. Pass explicit lexical identities into candidate retrieval. Build the Han Typesense filter from validated exact slugs; retain the existing normalized-locale compatibility identity only for non-Han paths where one selected locale maps to one legacy slugless document identity.
4. Keep evidence locales and `targetLanguageContext` based on the existing `targetLanguageSlug`, preserving semantic retrieval and watchability hydration.
5. Replace the misleading Chinese request-shape test with production-shaped end-to-end fixtures and keep request assertions for tokenizer fields and exact filter values.

### Assumptions

- Production lexical collections already contain the published JESUS title documents keyed by `slug:chinese-simplified` and `slug:chinese-traditional`.
- `mandarin-china` is the intended playable target for generic Han-script inference in the current product behavior.
- Typesense’s `zh` tokenizer is suitable for both Simplified and Traditional Chinese text, while exact Forge slugs isolate document identity.
- The existing service fixture can model grouped lexical hits, availability hydration, and target-audio watchability without starting Typesense.

### Implementation Constraints

- Do not use BCP-47 equality or prefix matching as the primary lexical document identity.
- Validate or construct every language identity through the existing Typesense identity helper; never interpolate unchecked filter syntax.
- Keep lexical request count and the single multi-search retrieval boundary unchanged.
- Do not change semantic evidence-language selection as part of this fix.
- Avoid public type/schema additions when an internal field/helper is sufficient.
- Preserve existing user changes and limit formatting to touched files.

## Implementation Units

### U1. Model query-script lexical context independently of the audio target

- **Requirements:** R1-R3, R6-R8.
- **Files:** `apps/admin/src/services/search-language-resolution.ts`, `apps/admin/src/services/search-language-resolution.test.ts`.
- **Changes:**
  1. Replace the script hint’s single overloaded slug with an internal structure that can express a target-language hint, tokenizer locale, and exact lexical localization slugs.
  2. Expose the resolved lexical context to the search service without changing the GraphQL contract.
  3. Keep explicit target/query-language/named-language precedence intact; script inference must not become an explicit query-language claim.
  4. Add Han resolver coverage that distinguishes `mandarin-china` target playback from `chinese-simplified`/`chinese-traditional` lexical identities, plus a non-Han control case.
- **Verification:** Resolver tests show the Han split, preserve existing source precedence, and fail if lexical context falls back to the playback slug.

### U2. Route Typesense lexical lanes with exact Chinese localization identities

- **Requirements:** R1-R9.
- **Files:** `apps/admin/src/services/typesense-watch-search.service.ts`, `apps/admin/src/services/typesense-watch-search.service.test.ts`; touch `apps/admin/src/services/typesense-watch-search-lexical.ts` or its test only if a small reusable identity-construction helper is necessary.
- **Changes:**
  1. Derive query tokenizer fields and exact lexical language identities separately from `targetLanguageSlug`.
  2. For Han inference, issue the existing title/metadata lanes against `title_zh`/`metadata_zh` and the exact Simplified/Traditional Chinese localization identities.
  3. Continue to build semantic evidence and target-audio hydration from `mandarin-china`.
  4. Add a production-shaped JESUS fixture with localized `chinese-simplified`/`chinese-traditional` title documents and a distinct `mandarin-china` playable audio option.
  5. Assert `耶稣` and `耶穌` title-lane retrieval, canonical result identity, exact filter values, and target-audio watchability. Add the English-query/selected-Mandarin regression.
- **Verification:** Focused service tests prove the complete retrieval/hydration contract and existing locale-aware request tests remain green.

### U3. Close the roadmap and capture the operational boundary

- **Requirements:** R8-R9.
- **Files:** `docs/roadmap/content-discovery/feat-338-watch-search-chinese-lexical-identity.md`, a solution note selected by formal `ce:compound` under `docs/solutions/`.
- **Changes:**
  1. Mark `feat-338` complete only after focused tests, typecheck, lint, and format checks pass.
  2. Record why the fix belongs in request-time lexical routing, why exact slugs remain mandatory, and why no Typesense rebuild/deploy is performed locally.
- **Verification:** Documentation names the validated commands and preserves production rollout as a separate operator action.

## Verification Contract

| Gate                       | Units | Command                                                                                                                                                                                                                                                                                                                                                                                                                             | Pass condition                                                                                                                 |
| -------------------------- | ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Resolver behavior          | U1    | `pnpm --filter @forge/admin test -- src/services/search-language-resolution.test.ts`                                                                                                                                                                                                                                                                                                                                                | Han context separates Chinese lexical slugs/tokenizer from Mandarin playback target; precedence controls pass.                 |
| Typesense service behavior | U2    | `pnpm --filter @forge/admin test -- src/services/typesense-watch-search.service.test.ts src/services/typesense-watch-search-lexical.test.ts`                                                                                                                                                                                                                                                                                        | Simplified and Traditional queries retrieve JESUS with target audio; English + Mandarin target and existing locale cases pass. |
| Admin types                | U1-U2 | `pnpm --filter @forge/admin typecheck`                                                                                                                                                                                                                                                                                                                                                                                              | No internal/public contract type drift.                                                                                        |
| Admin lint                 | U1-U3 | `pnpm --filter @forge/admin lint`                                                                                                                                                                                                                                                                                                                                                                                                   | Touched Admin code/tests satisfy repository lint rules.                                                                        |
| Formatting                 | U1-U3 | `pnpm exec prettier --check apps/admin/src/services/search-language-resolution.ts apps/admin/src/services/search-language-resolution.test.ts apps/admin/src/services/typesense-watch-search.service.ts apps/admin/src/services/typesense-watch-search.service.test.ts docs/roadmap/content-discovery/feat-338-watch-search-chinese-lexical-identity.md docs/plans/2026-08-06-001-fix-watch-search-chinese-lexical-identity-plan.md` | Touched files are formatted. Add the final solution-note path when created.                                                    |
| Diff audit                 | U1-U3 | `git diff --check && git status --short`                                                                                                                                                                                                                                                                                                                                                                                            | No whitespace errors; only intended files are changed.                                                                         |

No local Typesense process, production-sized corpus, schema generation, migration, index rebuild, or production deployment is required for this query-routing fix.

## Definition of Done

- `耶稣` and `耶穌` retrieve the canonical JESUS family from production-shaped localized title documents.
- Result hydration still selects playable `mandarin-china` target audio.
- English `JESUS` with Mandarin explicitly selected retains English lexical recall and Mandarin playback.
- Exact Forge language slugs remain the Typesense identity boundary; no BCP-47 identity broadening is introduced.
- Existing non-Han resolver and search behavior remains covered and passing.
- Focused tests, Admin typecheck, lint, formatting, and diff checks pass.
- The public GraphQL contract, lexical schema, and production index are unchanged.
- `feat-338` is marked complete with verification evidence.
- Formal `ce:review` has no unresolved blocking findings, and formal `ce:compound` records the durable lesson.

## Sources and Research

- `apps/admin/src/services/search-language-resolution.ts` — current query-script inference and target-language precedence.
- `apps/admin/src/services/typesense-watch-search.service.ts` — current tokenizer selection, lexical identity filter, semantic evidence, and hydration flow.
- `apps/admin/src/services/typesense-watch-search-lexical.ts` — exact slug-backed document projection and BCP-47 tokenizer separation.
- `apps/admin/src/services/typesense-watch-search.service.test.ts` — current request fixture and the mocked Chinese shape that misses the production mismatch.
- `docs/plans/2026-08-05-001-feat-typesense-multilingual-hybrid-quality-plan.md` — established multilingual serving design and acceptance contract.
- `docs/solutions/best-practices/language-identity-on-slug-not-bcp47-20260605.md` — repository rule that slugs are identity and BCP-47 is execution context.
- `docs/solutions/best-practices/mocked-shape-vs-real-contract-discipline-20260506.md` — production-shaped regression-fixture discipline.
- `docs/solutions/best-practices/precomputed-hybrid-search-serving-index-20260803.md` — current Typesense lane and rollout boundaries.
