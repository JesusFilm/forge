---
title: "Watch Search Candidate Card Language - Plan"
type: fix
date: 2026-08-17
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
product_contract_source: ce-plan-bootstrap
execution: code
---

# Watch Search Candidate Card Language - Plan

## Goal Capsule

- **Objective:** Stop Candidate Watch search from showing result-card snippets in an unrelated language while preserving multilingual recall, ranking, playback selection, and latency.
- **Authority:** This plan and the traced production request govern the fix.
- **Scope:** Candidate response presentation in Admin, focused service tests, production verification, and durable documentation. No frontend, GraphQL schema, index, embedding, or Current-search change.
- **Stop conditions:** Stop if the fix changes result order, playback identity, Typesense requests, index compatibility, or public GraphQL shape.
- **Tail ownership:** Implement, review, document, merge through the normal PR flow, then verify the deployed Watch UI and GraphQL response.

---

## Product Contract

### Summary

Candidate correctly resolves the selected target language and returns playable content in that language. Its global retrieval lanes can also find evidence in other languages. The bug occurs when Candidate copies that foreign retrieval evidence into the public `snippet` field.

The fix keeps global evidence for recall, ranking, diagnostics, and deep links. It limits visible retrieval snippets to the request's display or target language. When the evidence language is unknown or unrelated, the card uses the already-hydrated catalog description selected by `displayLocale`.

### Requirements

**Visible card language**

- R1. Candidate result cards must not show a retrieval snippet whose known language differs from both the display language and target language.
- R2. Candidate must use the localized catalog description when retrieval evidence has an unknown or unrelated language.
- R3. Candidate may keep a retrieval snippet when its evidence language matches the display language or target language.

**Search behavior and compatibility**

- R4. Result order, scores, retrieval sources, evidence metadata, start times, playback identity, availability, and action language must remain unchanged.
- R5. Global exact-title, localized-title, metadata, and semantic retrieval must remain unchanged.
- R6. Current Watch search and the public GraphQL schema must remain unchanged.
- R7. The fix must add no Typesense request, database read, embedding, index field, collection, or runtime configuration.

### Acceptance Examples

- AE1. **Covers R1-R4.** With English display and English target, a Portuguese or Vietnamese retrieval match returns the English catalog description while retaining its ranking and English playback.
- AE2. **Covers R2-R4.** With English display and English target, retrieval evidence with no resolved language returns the English catalog description.
- AE3. **Covers R3-R4.** With French display or target, a French transcript match keeps its French transcript snippet and start time.
- AE4. **Covers R1-R4.** With English display and Russian target, Russian evidence may remain visible, but evidence from an unrelated third language falls back to the English catalog description.
- AE5. **Covers R4-R7.** The same query before and after the fix produces the same ordered IDs, scores, availability, playback IDs, evidence fields, and Typesense request count.

### Scope Boundaries

- Do not add a language hard filter to retrieval.
- Do not change Candidate fusion or title ranking.
- Do not change Web result-card code.
- Do not rebuild or re-vectorize any Candidate collection.
- Do not change the Candidate application or ranking revision because the physical projection and ranking contract are unchanged.

---

## Planning Contract

### Key Technical Decisions

- KTD1. **Sanitize presentation after ranking.** Choose the public snippet while constructing the hydrated result, after retrieval and ranking have finished. This prevents the fix from reducing multilingual recall or changing scores.
- KTD2. **Use existing language roles.** Treat `displayLanguageSlug` and `targetLanguageSlug` as the allowed visible evidence languages. Do not infer another language or add new metadata.
- KTD3. **Fail safe to catalog copy.** Unknown or unrelated evidence uses `displayLocale(document, preferredLocale).description`. The hydrated catalog record already contains this value, so no new I/O is needed.
- KTD4. **Keep evidence intact.** Preserve `candidate.snippet`, `candidate.evidenceLanguageSlug`, `startSeconds`, and diagnostics internally. Only the public `snippet` projection changes.
- KTD5. **Limit behavior to Candidate.** Current keeps its existing snippet behavior so the production regression is fixed without broadening the change.

### High-Level Technical Design

1. Candidate retrieves and ranks globally as it does now.
2. Admin hydrates the selected catalog and playback record.
3. Admin compares the winning evidence language with the display and target language roles.
4. A matching evidence language keeps the retrieval snippet.
5. An unknown or unrelated evidence language uses the localized catalog description.
6. The existing GraphQL and Web layers render the corrected `snippet` without modification.

### Assumptions

- Candidate catalog hydration contains localized descriptions through `localesJson`.
- `displayLocale` remains the source of visible catalog title and description selection.
- A null evidence language is not safe proof that the evidence matches the displayed card language.

---

## Implementation Units

### U1. Add language-safe Candidate snippet projection

- **Goal:** Correct the public card copy without changing retrieval or ranking.
- **Requirements:** R1-R7; AE1-AE5.
- **Dependencies:** None.
- **Files:**
  - `apps/admin/src/services/typesense-watch-search.service.ts`
  - `apps/admin/src/services/typesense-watch-search.service.test.ts`
- **Approach:** Add a small pure selector near Candidate result construction. Build the allowed language set from the resolved display and target language slugs. For Candidate, return the retrieval snippet only when its evidence language is in that set; otherwise return the localized catalog description. Keep Current on its existing path.
- **Test scenarios:** Add focused cases for unrelated known evidence, unknown evidence, matching target evidence, matching display evidence, and unchanged ranking/playback/request counts.
- **Verification:** The focused service suite, Admin typecheck, Admin lint for touched files, and formatting checks pass.

### U2. Verify the public contract and production behavior

- **Goal:** Prove the fix works through the same API and UI path that exposed the bug.
- **Requirements:** R1-R7; AE1-AE5.
- **Dependencies:** U1.
- **Files:**
  - `docs/roadmap/content-discovery/feat-362-watch-search-native-language-candidate-recall.md`
  - a new learning under `docs/solutions/logic-errors/`
- **Approach:** Compare Candidate response identity before and after the fix. Confirm the ordered result IDs, scores, evidence, availability, and playback IDs are unchanged while visible snippets use an allowed language. After the normal PR deployment, probe representative English, Russian, Mandarin, French, and Spanish requests through production GraphQL and inspect the public Watch UI. Record the causal chain and no-reindex rollout rule in the solution document.
- **Test scenarios:** `jesus` with English selected, plus non-Latin and Latin-script queries whose global evidence previously came from a third language.
- **Verification:** Production GraphQL and Watch UI no longer show unrelated third-language snippets; Candidate health and latency remain at the pre-change level.

---

## Verification Contract

| Gate                     | Applies to | Done signal                                                                                                               |
| ------------------------ | ---------- | ------------------------------------------------------------------------------------------------------------------------- |
| Focused regression tests | U1         | Mismatched and unknown evidence fall back; matching display/target evidence remains visible.                              |
| Search invariants        | U1         | Ordered IDs, scores, evidence, playback, availability, start times, and Typesense requests are unchanged.                 |
| Admin standards          | U1         | `pnpm --filter @forge/admin test -- typesense-watch-search.service.test.ts`, typecheck, lint, and formatting pass.        |
| Contract audit           | U1-U2      | No frontend, GraphQL SDL, index schema, application revision, ranking revision, or environment change exists in the diff. |
| Production smoke         | U2         | Representative Watch UI and GraphQL requests show no unrelated third-language snippet.                                    |
| Performance              | U1-U2      | No new I/O or retrieval lane exists, and observed production latency does not regress.                                    |

---

## Risks & Dependencies

- **A valid cross-language semantic excerpt may be hidden.** Mitigation: allow evidence that matches either the display language or target language; only unrelated or unknown evidence falls back.
- **A fallback description can be empty.** Mitigation: preserve the existing nullable description behavior rather than exposing a known-wrong language.
- **Presentation logic could accidentally affect ranking.** Mitigation: run it only after `rankedCandidates` and hydration are complete, then assert ranking and playback invariants in tests.
- **Production may run a stale Admin deploy.** Mitigation: verify the deployed commit and use request/response evidence after the normal main-branch deployment.

---

## Definition of Done

- Candidate never exposes an unrelated known-language or unknown-language retrieval snippet on the public card.
- Matching display-language and target-language evidence remains available.
- Retrieval, ranking, evidence, playback, and latency contracts remain unchanged.
- Focused tests, Admin typecheck, lint, formatting, and formal code review pass.
- A durable solution document records the traced cause, fix, and no-reindex rollout.
- The merged production deployment passes GraphQL and Watch UI smoke checks.

---

## Sources

- `apps/admin/src/services/typesense-watch-search.service.ts` — global retrieval merge and public result construction.
- `apps/admin/src/services/typesense-watch-search-locales.ts` — localized catalog display selection.
- `apps/web/src/lib/watch-search-client.ts` and `apps/web/src/components/search/VideoCard.tsx` — unchanged public `snippet` transport and rendering.
- `docs/solutions/architecture-patterns/typesense-global-exact-title-recall-with-localized-tokenizers.md` — global recall must remain language-neutral.
- `docs/solutions/logic-errors/watch-search-unavailable-evidence-playback-identity.md` — evidence language and playback language are separate roles.
- `docs/roadmap/content-discovery/feat-362-watch-search-native-language-candidate-recall.md` — current Candidate multilingual scope and constraints.
