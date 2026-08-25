---
title: "Unavailable Watch Search Card Presentation - Plan"
type: "fix"
date: "2026-08-22"
artifact_contract: "ce-unified-plan/v1"
artifact_readiness: "implementation-ready"
product_contract_source: "ce-plan-bootstrap"
execution: "code"
---

# Unavailable Watch Search Card Presentation - Plan

## Goal Capsule

- **Objective:** Watch search results with no playable option in the completed Search Language are never presented or announced as ordinary playable cards.
- **Means:** Retain a ranked result with a valid completed Search Language as a clearly unavailable recovery link while removing every playback-specific visual and network affordance from its card; missing or malformed language remains fail-closed under R7 (KTD1, KTD2).
- **Authority:** Linear FGE-25 and the requirements below own product behavior; Search Watchability owns action eligibility; the completed FGE-72 recovery contract owns unavailable navigation.
- **Execution profile:** Scoped Web presentation change with focused component and floating-search regression coverage, browser accessibility evidence, and page-loading evidence.
- **Stop conditions:** Stop if current main no longer returns explicit `unavailable` watchability, if the recovery contract cannot accept retained results, or if active work claims `VideoCard` unavailable presentation before implementation begins.
- **Tail ownership:** The LFG run owns review, CI, roadmap and Linear linkage, and PR readiness; it does not deploy production.

---

## Product Contract

### Summary

Unavailable-language results remain relevant search evidence and keep their existing recovery destination when the completed Search Language is valid; missing or malformed language retains R7's fail-closed destination. Their cards become visibly disabled across artwork and copy while remaining clickable recovery links. A prominent locale-aware label names the unavailable Search Language. The change trusts explicit Search Watchability, preserves Admin ranking and pagination, and leaves playable availability kinds unchanged.

### Problem Frame

Admin correctly returns some relevant rows with `availability.kind = UNAVAILABLE`, null playback identity, and no playback action. Current Web mapping preserves those nulls and routes the row into the completed unavailable-language recovery flow, but `VideoCard` still gives the row the shared playback grammar: a play-shaped placeholder, optional Mux media, progress, runtime pill, animated hover media, zoom, and ordinary playable card chrome.

Production evidence on 2026-08-22 confirms the condition remains reachable. A Mandarin-target Watch search for Spanish query `Jesús` returned a mixed window containing `tümlükden-nura` as `UNAVAILABLE` with null playback, duration, language, and action fields alongside playable Mandarin rows. The card presenter, not result classification or routing, is the remaining truthfulness gap.

### Requirements

**Unavailable presentation**

- R1. A result classified as `unavailable` displays a prominent label that pairs the locale's existing translated “Not available” status with the requested Search Language without sentence-level concatenation.
- R2. An unavailable result displays no playback-specific cue: no Mux-derived poster, animated Mux preview, progress bar, play icon, duration/count pill, generic play placeholder, or media zoom behavior.
- R3. An unavailable result preserves Admin-provided static artwork, title, snippet, stable card dimensions, and keyboard focus treatment while dimming the artwork, title, and snippet as one disabled-looking card.
- R4. Explicit `availabilityKind === "unavailable"` is authoritative even when an inconsistent or stale row also contains playback, duration, child-count, blur, or stored-progress data.

**Recovery and language identity**

- R5. When the completed requested language is valid, an unavailable result remains an anchor to the existing unavailable-language recovery destination and retains the current unmodified-navigation context handoff and `prefetch={false}` behavior; missing or malformed language follows R7.
- R6. The completed Search Language may identify the recovery context but must not become playback or action identity.
- R7. A missing or malformed requested language retains the existing fail-closed destination and never creates a playback URL or recovery context write.

**Playable and search-window preservation**

- R8. `target_audio`, `target_subtitle`, `related_language`, experiences, and unclassified results retain their current playable or non-video presentation and destinations.
- R9. The Web client does not filter unavailable rows after Admin ranking or pagination; result order, offsets, Load more behavior, viewed identifiers, click identifiers, and positions remain unchanged.
- R10. The presentation derives synchronously from existing mapped props and introduces no fetch, effect, hydration-time reclassification, or unavailable-card Mux request.

### Acceptance Examples

- AE1. **Unavailable row with canonical artwork**
  - **Covers:** R1, R2, R3, R5
  - **Given:** A video result has `availabilityKind: "unavailable"`, null playable identity, and a valid Admin `imageUrl`.
  - **When:** The search card renders and receives hover or keyboard focus.
  - **Then:** The artwork, title, and snippet are visibly dimmed; the localized label stays high contrast; the recovery link remains; and playback cues and animated media remain absent.
- AE2. **Stale unavailable row**
  - **Covers:** R2, R4, R10
  - **Given:** A deliberately inconsistent unavailable fixture also contains a playback ID, duration, child count, Mux blur data, and stored progress.
  - **When:** The card renders and receives pointer intent.
  - **Then:** Unavailable classification suppresses every playback-derived surface and request.
- AE3. **Playable watchability matrix**
  - **Covers:** R8
  - **Given:** Equivalent results are classified as target audio, target subtitle, or related language.
  - **When:** Each card renders.
  - **Then:** Existing destinations, artwork fallbacks, previews, progress, and pills remain eligible, and no unavailable status is shown.
- AE4. **Completed versus draft language**
  - **Covers:** R5, R6, R9
  - **Given:** A completed mixed search is visible and the language control is changed without submitting again.
  - **When:** The unavailable result is activated.
  - **Then:** Recovery uses the completed search language while analytics and result position remain those of the rendered window.
- AE5. **Malformed recovery context**
  - **Covers:** R7
  - **Given:** An unavailable row is rendered without a valid requested language slug.
  - **When:** Its destination and click behavior are evaluated.
  - **Then:** The destination fails closed and no recovery context is written.

### Success Criteria

- A keyboard or screen-reader user can distinguish an unavailable recovery result before activation.
- Hovering or focusing an unavailable result initiates no Mux poster or animated-preview request, while playable cards retain their current intent-triggered behavior.
- Mixed initial and appended result windows preserve server order and analytics identity.
- The change adds no hydration warning, client request, effect, or layout shift and does not degrade the lazy search surface's page-loading posture.

### Key Decisions

- **Keep unavailable results in the mixed result window as clickable recovery links.** (session-settled: user-directed — chosen over filtering the rows or moving them to a secondary section: the user selected a disabled-looking card that still opens recovery.) Governs R5, R7, and R9.
- **Dim the whole unavailable card and keep the status label prominent.** (session-settled: user-directed — chosen over a subtle status line or image-only dimming: the earlier treatments did not look different enough from playable cards.) Governs R1, R2, and R3.
- **Name the unavailable Search Language with natural localized status.** (session-settled: user-directed — chosen over a generic status that omits the language or a mechanically concatenated sentence: the requested language and the locale-owned unavailable message must read as one clear badge in every supported UI language.) Governs R1.
- **Preserve the existing FGE-72 recovery contract and playable availability kinds.** (session-settled: user-approved — chosen over reopening routing or search eligibility: recovery is already terminal and the defect is presentation-only.) Governs R5-R10.

### Scope Boundaries

**In scope**

- `VideoCard` presentation derived from explicit unavailable Search Watchability.
- The existing fully localized unavailable-language message composed with the requested Search Language as separate badge content.
- Focused and integration regression tests, accessibility evidence, and page-loading/browser evidence.
- A fresh roadmap record linked to FGE-25 and the resulting PR.

**Outside this product's identity**

- Admin recall, scoring, candidate qualification, ranking revisions, evidence-language fusion, and result hydration.
- Search result filtering, page size, pagination offsets, Load more behavior, or analytics schema changes.
- Playback/action language synthesis, subtitle or player UX, route admission, not-found sentinels, recovery pages, manifests, and recovery storage shape.
- Candidate-profile work in FGE-92 and adjacent work in FGE-24, FGE-26, FGE-27, FGE-5, FGE-68, FGE-70, FGE-79, and FGE-85.
- Production deployment or support-channel communication.

### Dependencies

- Merged unavailable recovery behavior from PR #1929 and roadmap `feat-361` remains the navigation owner.
- Admin's four-state Watchability contract remains available through the existing Web result mapping.
- `feat-421` is the current candidate after auditing main, active worktrees through `feat-420`, and all open PR file lists. U1 must repeat that full audit immediately before file creation and allocate the lowest genuinely free sequential ID if concurrent work has claimed it.

### Sources / Research

- Linear FGE-25 description, comments, relations, and current status inspected on 2026-08-22.
- Production Admin Watch search request `375ff74b-8259-4ccc-9a78-a007693a4fcb` demonstrates a mixed playable/unavailable Mandarin-target window for `Jesús`.
- `docs/solutions/logic-errors/watch-search-unavailable-evidence-playback-identity.md` establishes null playback identity and recovery ownership.
- `docs/solutions/logic-errors/watch-search-subtitle-playback-contract.md` establishes that target-subtitle results remain actionable.
- `docs/solutions/logic-errors/watch-search-overlay-page-size-mismatch.md` prohibits post-window filtering that corrupts pagination.
- `docs/solutions/integration-issues/semantic-search-video-card-display-metadata-hydration.md` keeps explicit mapped availability authoritative at the presentation boundary.

---

## Planning Contract

### Key Technical Decisions

- KTD1. **Retain unavailable rows as recovery links.** (session-settled: user-directed — chosen over filtering after pagination or building a secondary result section: the existing recovery action remains useful and the mixed candidate window must stay intact.) Merged recovery behavior is a valid non-playback action, while omitting rows in Web after Admin pagination would corrupt the candidate window and analytics. Governs R5, R6, and R9.
- KTD2. **Branch only on explicit unavailable Watchability.** A single synchronous `isUnavailable` presentation state suppresses all playback-derived calculations and surfaces, including under stale data. Null-field heuristics would incorrectly affect playable and non-video cards. Governs R2, R4, R8, and R10.
- KTD3. **Compose the badge from two already localized identities.** (session-settled: user-directed — chosen over generic copy that omits the language or a new sentence template requiring unreviewed grammar in every catalog: the requested language and existing unavailable message remain separate badge spans.) This avoids inflection and word-order assumptions while preserving a natural accessible label. Governs R1 and R10.
- KTD4. **Dim artwork and caption while keeping the status label opaque.** (session-settled: user-directed — chosen over image-only dimming and a semi-transparent status line: the complete card must read as disabled without hiding its recovery action.) The status takes badge priority and ordinary type metadata does not compete with it. Governs R1, R2, and R3.
- KTD5. **Preserve recovery and analytics contracts as regression-only scope.** Existing destination, prefetch, context storage, completed-language binding, click callback, and visible-result behavior are asserted but not redesigned. Governs R5, R6, R7, and R9.

### Assumptions

- The approved merged recovery journey resolves FGE-25's retain-versus-omit ambiguity in favor of a distinct recovery card.
- A link is the correct accessible semantic because activation has a real recovery destination; `aria-disabled` would misrepresent that behavior.
- The language name and unavailable message remain separate text spans so locale direction and grammar do not depend on a new parameterized sentence translation.
- The unavailable status may replace ordinary type/count metadata because availability truth is more important than media taxonomy on a non-playback action.

### Implementation Constraints

- Preserve the card's aspect-ratio footprint and keyboard focus visibility.
- Do not inspect playback or image sparsity to infer availability.
- Do not touch Admin GraphQL, generated types, recovery route/sentinel/manifest code, player code, or Candidate/FGE-92 files.
- Keep the diff resilient to concurrent nearby work by avoiding locale catalog rewrites and controller/search-service changes.

### Sequencing

1. Re-audit current main, active worktrees, branches, and open PR file lists immediately before creating the lowest genuinely free sequential roadmap record; mark it in progress, then add characterization coverage for the stale unavailable-row boundary.
2. Implement the explicit unavailable presentation branch and localized status at the existing card presenter.
3. Run focused, integration, locale, static, page-loading, and browser verification before completing the roadmap record and shipping through review and CI.

---

## Implementation Units

### U1. Roadmap ownership and regression baseline

- **Goal:** Establish the durable sequential FGE-25 scope record and failing tests that prove the remaining presentation defect without reopening recovery or ranking.
- **Requirements:** R1-R10
- **Dependencies:** None
- **Files:**
  - `docs/roadmap/content-discovery/feat-421-watch-search-unavailable-card-presentation.md`
  - `apps/web/src/components/search/VideoCard.test.tsx`
  - `apps/web/src/components/__tests__/FloatingSearchProvider.test.tsx`
- **Approach:**
  1. Repeat the active main/worktree/branch/open-PR ID audit, allocate the lowest free sequential ID (`feat-421` if still free), and record exact entry points, grep terms, constraints, production evidence, adjacent-task exclusions, and verification gates.
  2. Add a deliberately inconsistent unavailable fixture carrying static artwork and stale playback fields; characterize recovery href/context while expecting every playable affordance to be absent.
  3. Pin the four availability kinds and completed-language integration so the change cannot broaden to normal badges, routing, filtering, or analytics behavior.
- **Execution note:** Start with the focused unavailable-card expectation failing on current main before changing the presenter.
- **Patterns to follow:** `feat-361-watch-search-unavailable-language-recovery.md`; existing recovery and no-visible-playable-badge tests in `VideoCard.test.tsx`.
- **Test scenarios:**
  - Covers AE1. Render unavailable content with Admin artwork and null playback identity; expect localized status, static art, recovery href, and no playback affordance.
  - Covers AE2. Render unavailable content with stale playback, duration, count, blur, and progress data; expect explicit availability to suppress every derived playback cue.
  - Covers AE3. Render target-audio, target-subtitle, and related-language rows; expect current playable destinations and presentation with no unavailable status.
  - Covers AE4. Change draft language after a completed search; expect recovery context and click analytics to retain completed-language and rendered-position identity.
  - Covers AE5. Render invalid requested-language context; expect fail-closed href and no context write.
- **Verification:** The focused suite fails on current main only for the newly required unavailable presentation and preserves all existing recovery and playable assertions.

### U2. Truthful unavailable card presentation

- **Goal:** Make unavailable cards visibly and accessibly non-playback while preserving their recovery action and static catalog content.
- **Requirements:** R1, R2, R3, R4, R5, R7, R8, R10
- **Dependencies:** U1
- **Files:**
  - `apps/web/src/components/search/VideoCard.tsx`
  - `apps/web/src/i18n/client-messages.ts`
  - `apps/web/src/components/search/VideoCard.test.tsx`
- **Approach:**
  1. Derive a single explicit unavailable presentation state before thumbnail, preview, pill, progress, placeholder, and interaction calculations.
  2. Preserve only Admin static artwork for unavailable media and remove its zoom treatment; do not derive poster or preview URLs from playback fields.
  3. Render the requested Search Language and existing locale-owned unavailable message as separate parts of one prominent badge inside the anchor's accessible content.
  4. Dim artwork with grayscale, 40% brightness, 75% contrast, and a dark overlay; dim title and snippet to 45% opacity; keep the status badge opaque and full contrast.
  5. Preserve the recovery href, focus treatment, `prefetch={false}`, guarded context handoff, title, snippet, aspect ratio, and click callback.
  6. Leave all non-unavailable branches byte-for-behavior equivalent where practical.
- **Patterns to follow:** Existing `availabilityKind` recovery branch in `VideoCard.tsx`; `LanguagePickerModal.notAvailable`; `VideoThumbnailEyebrow`; global client-message namespace selection.
- **Test scenarios:**
  - Covers AE1. Pointer hover and keyboard focus on an unavailable artwork card show dimmed artwork and caption plus an opaque status label, without preview, zoom, progress, or pill.
  - Covers AE2. Stale Mux fields do not produce a Mux poster URL, animated preview, blur fallback, duration/count pill, progress mount, or play-shaped placeholder.
  - An unavailable row without Admin artwork renders a neutral media surface with no play glyph.
  - Covers AE3. Each playable Watchability state still permits its existing poster fallback, preview, progress, pill, and type treatment.
  - Experience cards retain their branded placeholder and chip.
  - An unclassified result retains its current presentation and destination.
- **Verification:** The component DOM and mocked media helpers prove no playback-derived surface is constructed for unavailable rows, and localized status participates in the link's accessible name.

### U3. Integration, accessibility, and page-loading proof

- **Goal:** Prove the card change survives the real floating-search flow without search-window, hydration, accessibility, or loading regressions.
- **Requirements:** R1, R5, R6, R8, R9, R10
- **Dependencies:** U2
- **Files:**
  - `apps/web/src/components/__tests__/FloatingSearchProvider.test.tsx`
  - `docs/roadmap/content-discovery/feat-421-watch-search-unavailable-card-presentation.md`
- **Approach:**
  1. Run the focused component and floating-search suites plus mapped search/recovery regressions.
  2. Validate message parity, generated locale selection, type checking, lint, formatting, and changed-file CI gates.
  3. Exercise a mixed search at desktop, phone, keyboard, and RTL presentation; inspect accessible content, result order, recovery navigation, console, network, resources, layout shift, and hydration.
  4. Confirm unavailable intent causes no Mux request and normal playable-card intent still does.
  5. Record verified outcomes and complete the roadmap record only after all applicable gates pass.
- **Patterns to follow:** Browser and performance evidence format in recent completed Web roadmap records; existing Floating Search analytics and language-binding coverage.
- **Test scenarios:**
  - Covers AE4. Initial and appended mixed windows keep server order, visible identifiers, click identifier, position, and completed Search Language.
  - Desktop and compact viewports show a readable unavailable status without overflow or aspect-ratio change.
  - Keyboard and screen-reader inspection expose the unavailable status before activation and retain a working recovery link.
  - RTL layout keeps status and title readable with no directional corruption.
  - Network inspection shows no unavailable-card Mux poster/preview request and no added fetch or dynamic resource.
- **Verification:** Automated gates pass; browser evidence has no hydration error, console error, new request, unavailable Mux request, or material layout/loading regression; roadmap resolution cites the final evidence.

---

## Verification Contract

| Gate                                               | Applies to | Done signal                                                                                                                                           |
| -------------------------------------------------- | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Focused `VideoCard` Vitest suite                   | U1, U2     | Unavailable stale-data boundary and all playable variants pass.                                                                                       |
| Floating Search provider/integration suite         | U1, U3     | Completed-language, recovery, ordering, and analytics regressions pass.                                                                               |
| Search mapping and unavailable recovery suites     | U3         | Null playback identity and terminal recovery behavior remain unchanged.                                                                               |
| Web typecheck and changed-file ESLint              | U2, U3     | No type, hook, accessibility-lint, or import regressions.                                                                                             |
| UI locale generation/parity checks                 | U2, U3     | Every delivered client catalog exposes the existing unavailable-language message and badge composition needs no new provisional sentence translation. |
| Prettier and `git diff --check`                    | U1-U3      | Plan, roadmap, code, and tests are formatted with no whitespace defects.                                                                              |
| Browser desktop, compact, keyboard, and RTL checks | U3         | Status is perceptible, recovery works, playable cards are unchanged, and layout remains stable.                                                       |
| Browser network and page-loading checks            | U3         | No unavailable Mux request, hydration warning, added fetch/effect, long-task regression, or material CLS/resource regression.                         |
| CE code review and compound pass                   | U1-U3      | No unresolved in-scope findings; durable learning is updated only if the solution adds a reusable rule.                                               |
| PR and CI watch                                    | U1-U3      | PR is linked to FGE-25, review is decided, required checks pass or have an exact durable blocker, and the PR is ready for human review.               |

---

## Definition of Done

- All R1-R10 requirements and AE1-AE5 examples are satisfied by tests or browser evidence.
- The freshly audited sequential roadmap record is the durable FGE-25 owner, moves from `in-progress` to `complete`, and records verified outcomes without claiming a deployment.
- The diff stays limited to unavailable-card presentation, focused regressions, client message exposure, plan/roadmap records, and any justified durable solution update.
- Admin ranking, candidate windows, analytics schemas, playback identity, subtitle behavior, recovery routing/storage, manifests, and player code remain unchanged.
- SSR/hydration, accessibility, localized layout, page-loading, and browser network evidence are recorded and clean.
- CE simplify/review findings are resolved or explicitly dispositioned, and abandoned experimental code is removed.
- The branch is committed, pushed, linked from FGE-25, and has an open PR with review and CI decided and ready for human review, or an exact durable blocker is recorded.
- No production deployment, credential forwarding, or Help Scout reply occurs.
