---
title: "Shared Watch FAQ Component - Plan"
type: "feat"
date: "2026-08-31"
artifact_contract: "ce-unified-plan/v1"
artifact_readiness: "implementation-ready"
product_contract_source: "ce-plan-bootstrap"
execution: "code"
---

# Shared Watch FAQ Component - Plan

## Goal Capsule

**Objective:** No rhythm, type-scale, or colour value can drift between the FAQ on an authored Experience page and the one on `/watch/whats-new`, and an Experience FAQ's answers reach the served HTML instead of appearing only after a click.

**Means:** One shared disclosure component rendered by both surfaces (KTD1).

**Authority hierarchy:** Requirements win on product behaviour. KTDs win on mechanism inside those requirements. Units override neither.

**Stop conditions:**

- Stop and report if the Experience FAQ's served-HTML or render-cost comparison (U5) comes back worse. Do not record a failing number in the PR body and continue.
- Stop and report if the question's hover colour fails contrast on any `SECTION_BG_CLASSES` background (U5).
- Stop and report if removing the preview harness breaks `next build` route typing.
- Do not commit, push, or open a PR from this plan. The calling pipeline owns the shipping tail; U5's evidence leaves as a PR-body-ready block in the final handoff.

**Execution profile:** The feature code is already written and green in the working tree. That inverts the usual risk: these requirements were derived from shipped code, so a requirement the code violates would most plausibly be resolved by editing the requirement. Treat every R below as a constraint the code must satisfy, and prefer changing code over changing text.

## Product Contract

### Summary

Consolidate the two Watch FAQ surfaces onto one shared component, close two defects in it, restore the accessibility relationship the consolidation dropped, and measure the surface that actually changed.

### Problem Frame

`apps/web/src/components/sections/RelatedQuestions.tsx` (authored Experience blocks) and `apps/web/src/components/whats-new/WhatsNewFaq.tsx` (the `/watch/whats-new` page) presented the same idea two different ways: padded tinted cards under a small uppercase eyebrow, versus flush hairline rows under one large heading. The design intent is that an Experience FAQ reads the way the what's-new FAQ does. A first pass achieved that by copying Tailwind values between the files, which left the shared look resting on duplicated literals that drift with no test going red.

The row presentation this change replaces was itself shipped deliberately. `docs/roadmap/platform/feat-312-watch-faq-row-alignment.md` (complete) built the centred, equally-padded, normal-weight, icon-free row that the new hairline row overwrites. Its regression test was replaced during this session's first pass without the ticket being consulted.

Consolidating them changed the disclosure primitive, and that reaches past styling. `docs/plans/2026-07-25-001-fix-watch-faq-disclosure-semantics-plan.md` — completed, tracked as `feat-317`, scoped from external accessibility issue FGE-40 — gave the Experience FAQ `aria-expanded` and `aria-controls` on a hand-rolled button. Its roadmap entry constrains the file against exactly this migration, and its forward-looking grep patterns now name symbols the file no longer contains.

### Requirements

**Shared presentation**

- R1. Both FAQ surfaces render one shared component, so no rhythm, type-scale, or hairline value is duplicated between them.
- R2. The Experience FAQ presents as hairline rows under one section heading, matching `/watch/whats-new`.
- R3. Colours inside the shared component derive from inherited text colour, so the component stays legible on every `SECTION_BG_CLASSES` background in `apps/web/src/components/sections/Section.tsx`.
- R4. The what's-new FAQ's rendered appearance and hover behaviour are unchanged, including a chevron that stays neutral while its question reddens.
- R12. The question's hover colour meets WCAG AA text contrast on every `SECTION_BG_CLASSES` background. This is new behaviour on the Experience surface, which had no hover colour before.

**Disclosure behaviour**

- R5. Each surface keeps its own open-model: single-open for Experience blocks, multi-open with a bulk control for what's-new.
- R6. A toggle the component reports for a state change React itself caused does not collapse a row the visitor opened.
- R7. Selecting question text inside a `<summary>` does not toggle that row.
- R8. Every decorative icon carrying an `opacity-*` utility also carries a solid, alpha-free colour utility.
- R11. An Experience FAQ's answers are present in the served HTML while their rows are closed.

**Accessibility contract**

- R13. Every FAQ trigger exposes `aria-controls` pointing to a unique answer panel in the same row, preserving `feat-317` R2 on the native element.
- R9. The `feat-317` and `feat-312` roadmap entries and `feat-317`'s plan carry dated notes naming every constraint, requirement, and shipped outcome this work overtook, without rewriting their historical record, and FGE-40 is told.
- R10. Regression coverage for the disclosure states `feat-317` required survives the primitive change, expressed against the native element.

### Key Decisions

- **One shared component over shared style tokens** (session-settled: user-directed — chosen over extracting shared Tailwind constants into a module both components import: the user wanted drift made impossible rather than merely discouraged, accepting that a one-off marketing page and every authored Experience FAQ now move together). Governs R1, R2, R4, R5.
- **The shared component belongs to the Experience surface.** It is localized, editor-authored, and rendered on many pages; `/watch/whats-new` is one English-only announcement page. When the two diverge, what's-new forks into its own component rather than the shared one gaining a third presentation prop. R4 pins what's-new's appearance for this change only and is not a standing veto. Governs R1, R4.
- **Answers ship in the served HTML.** Closed `<details>` content stays in the DOM, so FAQ answers reach the served markup instead of mounting on click. This is the one `feat-317` requirement the consolidation genuinely gives up — its R3 asked that the panel be hidden from assistive technology while collapsed — and it is given up deliberately, because reachability is the point. Governs R11.

### Scope Boundaries

**In scope:** the shared component, both callers, their tests, the restored `aria-controls` relationship, the `feat-317` and `feat-312` supersession notes and FGE-40 notification, evidence on the Experience surface, and removal of local scaffolding.

**Out of scope:** the remaining FGE-40 acceptance criteria (carousel, dialog, focus management, touch targets, page-level axe), which `feat-317` already deferred.

### Deferred to Follow-Up Work

- `apps/mobile/src/components/sections/RelatedQuestionsRenderer.tsx` and `apps/tv/src/components/sections/RelatedQuestionsRenderer.tsx` render the same authored `relatedQuestions` block and were built against web's previous card presentation as their reference (see `docs/plans/2026-03-26-003-feat-related-questions-leading-icon-plan.md`). This change re-bases that reference, so the same authored FAQ now reads as hairline rows on web and tinted cards on phone and TV. U7 records the divergence as a decision so it is not rediscovered as a bug.
- Migrating `apps/web/src/components/watch/WatchStudyQuestions.tsx` onto the shared component. A third lookalike with an animated height panel and its own CTA set.
- Bounding `questions` array length and `answer` length in `RelatedQuestionItemSchema` (`apps/admin/src/domain/blocks.ts`), now that every answer's markdown mounts eagerly. U5 measures the current cost; a cap is a separate admin-side change.

### Outstanding Questions

- Deferred: whether the shared component should eventually own the `<section>` wrapper. Today each caller keeps its own so it can supply the band and the ink.
- Deferred: whether editors need notice before the authored FAQ presentation changes on published pages. The restyle is the user's explicit request, so it is authorized; U5's captured comparison is what makes it reviewable.

## Planning Contract

### Key Technical Decisions

- KTD1. **Both surfaces render `apps/web/src/components/watch/WatchFaqList.tsx`** (session-settled: user-directed — chosen over a shared style-token module keeping two components: the user wanted the drift guarantee, accepting the coupling). The caller keeps its `<section>`, background, padding, and ink; the shared component owns the header row, heading scale, and disclosure rows. Governs R1, R2, R4.

- KTD2. **The shared component is fully controlled.** It takes `openIds` and `onToggle`; callers own their open-set. This is what lets one component serve both a single-open accordion and a multi-open list with a bulk control. Native `<details name>` exclusive accordions were considered for the single-open surface and rejected: `name`-grouped rows cannot all be open at once, which the what's-new bulk control requires, and a shared component cannot use the attribute on one caller only. Governs R5, R6.

  Sharp edge: `<details>` reports a `toggle` event for React's own writes as well as the visitor's, so every caller's handler must ignore a toggle matching what it already believes. The guard lives in each caller, not in the shared component — so R6 cannot be discharged by the shared component's own tests.

- KTD3. **Colours derive from inherited text colour**, with `questionHoverClass` as the single caller-supplied exception. `border-current/10` and `opacity-*` resolve against whatever ink the enclosing section sets. The brand hover red is not a tint of surrounding ink, so it cannot be derived — which means it is also the one value R3's guarantee does not cover, and `RelatedQuestions` currently supplies no override, taking the component default on all six backgrounds. Governs R3, R12.

- KTD4. **Native `<details>`/`<summary>` replaces the hand-rolled button disclosure.** It supplies keyboard behaviour, expanded-state announcement, and find-in-page expansion, works without hydration, and makes `<h3>` inside the toggle valid, which it is not inside `<button>`.

  Conflict call-out — read before executing. This crosses three items in completed, shipped work. `docs/roadmap/platform/feat-317-watch-faq-disclosure-semantics.md` says verbatim "Do not migrate the section to a different accordion implementation" and "Keep the current FAQ content, visual styling, and single-open interaction"; `docs/plans/2026-07-25-001-fix-watch-faq-disclosure-semantics-plan.md` states the same migration constraint in its own wording ("instead of migrating the section to another accordion implementation") and carries R2 (`aria-controls`) and R3 (panel hidden from assistive technology while collapsed). Of these: visual styling was deliberately changed and is the user's explicit request; single-open interaction is preserved; `aria-controls` is restored by U6, so `feat-317` R2 is met again; only `feat-317` R3 is genuinely surrendered, deliberately, because content-in-DOM is what buys find-in-page and served-HTML reachability. KTD4's equivalence claim is **asserted, not yet verified** — U6 carries the assistive-technology check that settles it.

- KTD5. **The `<summary>` guards against select-to-copy.** `docs/solutions/design-patterns/native-details-summary-disclosure-implementation-traps.md` (Trap 2) records that Chrome fires a click when a drag-select ends inside a summary, collapsing the disclosure, and that summary activation is that click's default action — so `preventDefault` on a click with a non-collapsed selection cancels the toggle and nothing else. That learning says to wire it day one. Governs R7.

- KTD6. **The chevron carries `text-current` rather than no colour utility.** `apps/web/src/components/whats-new/__tests__/WatchWhatsNewPage.test.tsx` enforces that a decorative lucide icon with `opacity-*` also carries a solid colour utility, because a fractional colour composites every stroke crossing twice. `text-current` satisfies that rule while preserving inheritance. Governs R8.

### Assumptions

- The what's-new page's rendered output is unchanged. Measured this session in headless Chromium against the pre-change component: identical row padding, question size and weight, answer leading, heading size, chevron colour and opacity, first-row height, and hover colours. Two deltas remain — a hairline at `#131111`/10% instead of pure black/10%, and answer transparency moved from colour-alpha to element `opacity`. On what's-new the answers are plain strings, so those composite the same. On the Experience surface the answer is a `<Markdown>` subtree, where element opacity dims links, emphasis, and list markers as one group; U5 captures that surface rather than assuming it.
- Eager answer mounting is free on `/watch/whats-new`: its answers are a fixed static list of plain strings in `whats-new-content.ts`, and that page already mounted them eagerly before this change. It is **not** free by assumption on the Experience block, where `questions` is `z.array(...)` with no `.max()` and every answer is now its own react-markdown subtree parsed at SSR and again at hydration, whether or not its row is open. U5 measures that surface at a deliberate worst case.

### Requirements Trace

| Requirement | Discharged by                                                                                                                                            |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1          | U2                                                                                                                                                       |
| R2          | U5 (captured harness comparison)                                                                                                                         |
| R3          | U2 (hairline class contract) + U5 (rendered reading)                                                                                                     |
| R4          | U5 (captured harness comparison) + the what's-new suite's icon invariants                                                                                |
| R5          | Existing caller suites: `RelatedQuestions.test.tsx` "opens one row at a time"; `WhatsNewFaq.test.tsx` "expands and collapses every row from one control" |
| R6          | U2 (caller-level scenarios — the guard lives in the callers, per KTD2)                                                                                   |
| R7          | U1                                                                                                                                                       |
| R8          | U2 + the what's-new page suite                                                                                                                           |
| R9          | U3                                                                                                                                                       |
| R10         | U2                                                                                                                                                       |
| R11         | U5                                                                                                                                                       |
| R12         | U5                                                                                                                                                       |
| R13         | U6                                                                                                                                                       |

### Sources

- `docs/roadmap/platform/feat-317-watch-faq-disclosure-semantics.md` and `docs/plans/2026-07-25-001-fix-watch-faq-disclosure-semantics-plan.md` — the constraints KTD4 crosses. The verbatim "do not migrate" wording is in the roadmap file.
- `docs/solutions/design-patterns/native-details-summary-disclosure-implementation-traps.md` — Trap 2 (select-to-copy) and the jsdom capability map, including the warning that closed-`<details>` content being findable by role query is a jsdom artifact, not the browser contract.
- `docs/solutions/conventions/frontend-change-page-load-performance-verification.md` — the repo's page-load evidence requirement.
- `apps/web/src/components/watch/__tests__/SubtitleTranscript.ssr.test.tsx` — the repo's `renderToStaticMarkup` precedent, which is how U5 proves served-HTML content with no Admin backend.
- `apps/chat/src/components/chat/sources-list.tsx` — the select-to-copy handler shape U1 mirrors.

## Implementation Units

### U2. Create the shared component's own test file

- **Goal:** The shared component and its callers' echo guards are covered.
- **Requirements:** R1, R3, R6, R8, R10
- **Dependencies:** None
- **Files:**
  - `apps/web/src/components/watch/WatchFaqList.test.tsx`
  - `apps/web/src/components/whats-new/__tests__/WhatsNewFaq.test.tsx`
- **Approach:**
  1. Render `WatchFaqList` directly with fixture items and a controlled open-set.
  2. Pin the contract both callers depend on: rows are `<details>`, hairlines use a `currentColor`-derived border, the chevron carries a solid colour utility beside its `opacity-*`, and `onToggle` reports the item id with the new open state.
  3. Add the R6 coverage where the guard actually lives. `RelatedQuestions.test.tsx` already has "ignores the close echo from a row React itself just closed"; `WhatsNewFaq.tsx`'s `setRow` equality guard has no equivalent, so add one to the what's-new suite.
  4. Do not assert that closed-row content is findable by role query — per the jsdom capability map that is a jsdom artifact. Assert on `textContent` presence, which holds in both.
  5. Check whether jsdom dispatches `toggle` asynchronously while `details.open` flips synchronously. If it does, an assertion on `onToggle` taken immediately after a click will not see the call, while one on `details.open` will — probe it once and write the scenarios to match rather than assuming parity.
- **Patterns to follow:** `apps/web/src/components/sections/RelatedQuestions.test.tsx`
- **Test scenarios:**
  1. Each item renders as a `<details>` carrying the caller's `itemTestId`, with a `<summary>` and an `<h3>` question.
  2. A row whose id is in `openIds` renders open; one that is not renders closed.
  3. Toggling a row calls `onToggle` with that row's id and the new open state.
  4. The chevron's class list contains both a solid colour utility and an `opacity-*` utility, and no fractional colour utility.
  5. The row hairline uses a `currentColor`-derived border rather than a literal colour.
  6. In the what's-new suite: applying a controlled `open` update and delivering the resulting matching toggle leaves the bulk-control state unchanged, and a visitor toggle is still reported exactly once.
- **Verification:** The suite passes, and scenarios 4, 5, and 6 are each falsified once against a deliberately wrong implementation.

### U1. Guard the shared summary against select-to-copy collapse

- **Goal:** Selecting question text stops toggling the row.
- **Requirements:** R7 (KTD5)
- **Dependencies:** U2
- **Files:**
  - `apps/web/src/components/watch/WatchFaqList.tsx`
  - `apps/web/src/components/watch/WatchFaqList.test.tsx`
- **Approach:**
  1. Add an `onClick` on the `<summary>` that calls `preventDefault()` when `window.getSelection()` returns a non-collapsed selection.
  2. Mirror the handler shape in `apps/chat/src/components/chat/sources-list.tsx`.
  3. Add no state and no `stopPropagation` — summary activation is the click's default action, so cancelling it is sufficient.
- **Patterns to follow:** `apps/chat/src/components/chat/sources-list.tsx`
- **Test scenarios:**
  1. A click on a summary while `window.getSelection()` reports a non-collapsed selection leaves `details.open` unchanged.
  2. A plain click with a collapsed selection still toggles `details.open`.
  3. A click with `window.getSelection()` returning `null` still toggles, so the guard cannot wedge the control shut.
- **Verification:** All three scenarios pass, and the guard is falsified once by removing `preventDefault`.
- **jsdom traps for these scenarios.** Drive the guard with a real `summary.click()`. The existing FAQ suites synthesize state with `row.open = true; row.dispatchEvent(new Event("toggle"))`, which never runs the click handler — reusing that helper makes all three scenarios pass with `preventDefault` deleted, so the required falsification would be vacuous. `apps/web` has no `@testing-library/*` dependency, and jsdom's `window.getSelection()` always returns a Selection object, so scenario 3 needs `window.getSelection` stubbed rather than a cleared selection. Re-probe these against `apps/web`'s own vitest setup before trusting them: the capability map in the cited traps doc was measured against `apps/chat`'s composed environment, which differs.

### U6. Restore the aria-controls relationship on the native disclosure

- **Goal:** `feat-317` R2 is met again, on the native element.
- **Requirements:** R13
- **Dependencies:** U2
- **Files:**
  - `apps/web/src/components/watch/WatchFaqList.tsx`
  - `apps/web/src/components/watch/WatchFaqList.test.tsx`
- **Approach:**
  1. Give the answer container a stable per-row `id` (derive from `useId` plus the item id, matching the pattern the previous `RelatedQuestions` used).
  2. Put `aria-controls` on the `<summary>` pointing at it. This is purely additive — `<details>` supplies expanded state natively, so do **not** also hand-write `aria-expanded`, which would fight the native mapping.
  3. Verify in a real browser with assistive technology that the row announces an accessible name, a disclosure role, and an expanded/collapsed state that updates on toggle. Record the result for the PR body.
- **Execution note:** The AT pass is what settles KTD4's equivalence claim, which is currently asserted rather than verified. Prefer VoiceOver/Safari and NVDA/Chrome; one is acceptable if only one is reachable, stated as such.
- **Test scenarios:**
  1. Every `<summary>` carries a non-empty `aria-controls` whose value resolves to an element in the same row.
  2. The `aria-controls` values are unique across rows in one render, and across two independently rendered lists on the same page.
  3. No `<summary>` carries a hand-written `aria-expanded`.
- **Verification:** Scenarios pass; the AT transcript is captured for the PR body.

### U3. Record what this work overtook in feat-317, feat-312, and FGE-40

- **Goal:** Both completed tickets, feat-317's plan, and the external issue stop misleading their next reader.
- **Requirements:** R9 (KTD4)
- **Dependencies:** U6
- **Files:**
  - `docs/roadmap/platform/feat-317-watch-faq-disclosure-semantics.md`
  - `docs/plans/2026-07-25-001-fix-watch-faq-disclosure-semantics-plan.md`
  - `docs/roadmap/platform/feat-312-watch-faq-row-alignment.md`
- **Approach:**
  1. Append a dated supersession note to each file. Do not rewrite either body — both are historical records, and the repo's retired-mechanism convention is an additive adjacent note.
  2. Enumerate every superseded item by name: roadmap Constraint 1 (visual styling deliberately changed; single-open preserved); roadmap Constraint 2 and the plan's matching wording (the section did migrate, to `apps/web/src/components/watch/WatchFaqList.tsx`); plan R2 (`aria-controls` restored by U6, so it is met again); plan R3 (closed content now stays in the DOM and the accessibility tree — the one requirement deliberately surrendered, and why).
  3. Note that the roadmap's "Grep These" patterns (`function QuestionItem`, `openIndex`, `aria-expanded`, `aria-controls`, `useId`) no longer match the file, and its Entry Points now resolve through the shared component.
  4. Add `linear_issue: "FGE-40"` to `feat-317`'s frontmatter — it currently has none, so the note has no path back to the tracker — and post a comment on FGE-40 stating that the accordion criterion is now satisfied by native `<details>`/`<summary>` with `aria-controls` preserved, naming the shared component and the surrendered R3.
  5. Do the same for `feat-312`, whose shipped row presentation this change overwrites. Its note states: row presentation moved to the shared component, which renders the question `font-semibold` at `text-lg`/`sm:text-xl` rather than normal weight, uses `py-6` on the `<summary>` rather than equal four-side `p-4`, top-aligns rather than centres the row, and drops the `hover:bg-white/5` row tint for a question-only hover colour — so its "Grep These" patterns `QuestionIcon` and `hover:bg-white/5` no longer match. Its icon-free outcome is preserved.
  6. Leave every frontmatter `status` alone. Both tickets shipped; only their outcomes were later overtaken.
- **Test expectation:** none -- documentation and tracker updates only.
- **Verification:** All three roadmap/plan files carry a dated note naming the items they superseded; no historical body is rewritten; `feat-317` carries `linear_issue`; the FGE-40 comment exists; `npx prettier --check` passes on all three.

### U5. Measure the surface that actually changed

- **Goal:** The claims this change rests on are measured on the Experience FAQ, not on the page the change was designed not to alter.
- **Requirements:** R2, R3, R4, R11, R12
- **Dependencies:** U2
- **Files:**
  - `apps/web/src/components/sections/RelatedQuestions.test.tsx`
- **Approach:**
  1. Prove served-HTML presence where it changed. Add a `renderToStaticMarkup(<RelatedQuestions data={fixture} />)` assertion to `RelatedQuestions.test.tsx` asserting every answer string appears in the emitted markup while no `<details>` carries `open`. The repo already uses `renderToStaticMarkup` in several suites, so this needs no Admin backend. The `/watch/whats-new` served-HTML check is **not** evidence for this: that page already rendered `<details>` with unconditional answers before this work, so it passes either way.
  2. Measure the eager-markdown cost on the Experience path, using the existing `preview/faq-compare` harness under `next build` + `next start` — never `next dev` — with a deliberate worst case (20 questions, multi-paragraph markdown answers). Compare against the pre-change component.
  3. Extend the harness to all six `SECTION_BG_CLASSES` keys before reading anything — it currently covers `default`, `dark`, `primary`, and `light`, and omits the `cosmic` and `purple` gradients, where `cosmic` ends on `to-cyan-300/50` and is the least predictable ground for `opacity-72` answer text and an `opacity-45` chevron. Read the rendered hover colour and the answer-tier colour on each, and check the hover against WCAG AA. The Experience surface had no hover colour before, so this is new behaviour, not preserved behaviour.
  4. Capture the before/after comparison of the Experience FAQ against representative authored content — including one `heading` written as an eyebrow-style label such as "FAQ", which now renders at display scale — on one light and one dark background.
  5. Produce all results as a PR-body-ready evidence block in the final handoff. Do not open a PR; the calling pipeline does that.
- **Execution note:** Measure, do not compute. Run this before U4 deletes the harness — the harness is the only artifact that renders the pre-change and post-change components side by side.
- **Test scenarios:**
  1. `renderToStaticMarkup` output for a closed-row fixture contains every answer string and contains no `open` attribute on any `<details>`.
  2. The same output for a fixture with markdown answers contains the rendered list markup, proving the markdown subtree is server-rendered rather than client-only.
- **Verification:** Both scenarios pass; the render-cost, hover-contrast, and authored-content comparisons are recorded; any regression triggers the Goal Capsule stop condition rather than a note in the PR body.

### U7. Record the mobile and TV divergence

- **Goal:** The next mobile or TV design pass reads web's move as a decision, not a bug.
- **Requirements:** R9
- **Dependencies:** U5
- **Files:**
  - `docs/roadmap/platform/feat-508-related-questions-cross-platform-realignment.md` (create)
- **Approach:**
  1. Create a roadmap ticket at the next unused id (508; main's highest was 507) covering mobile and TV re-alignment of `RelatedQuestionsRenderer`.
  2. Name both renderers, state that web moved to hairline rows under a display heading and why, and link this plan.
  3. Set `status: "not-started"` and leave sequencing to its owner.
- **Test expectation:** none -- roadmap tracking only.
- **Verification:** The ticket exists with valid frontmatter and passes `npx prettier --check`.

### U4. Remove the local preview harness

- **Goal:** No throwaway scaffolding reaches the commit.
- **Requirements:** R1
- **Dependencies:** U5
- **Files:**
  - `apps/web/src/app/(preview)/preview/faq-compare/page.tsx` (delete)
- **Approach:**
  1. Delete the harness route directory, only after U5 has captured everything it needs from it.
  2. Stop the `next dev` process on port 3222, matching it with a bracketed pattern so the command does not match its own shell.
  3. Remove `apps/web/.next/dev` so stale generated route types do not fail typecheck after the route disappears.
  4. Confirm no untracked scratch files remain — the session also created `.tmp.mjs` driver scripts.
- **Test expectation:** none -- removal of local scaffolding.
- **Verification:** `git status --porcelain` shows only intended feature, test, and documentation paths, and `next build` passes with the route gone.

## Verification Contract

Run from `apps/web` with the worktree toolchain on `PATH`. The two build-time commands additionally need the CI env loaded first — `src/env.ts` validates `ADMIN_GRAPHQL_URL` and `REVALIDATION_SECRET` as required with no `skipValidation`, and this worktree has no `.env.local`, so a bare `next build` fails Zod validation and reads as a code fault. Prefix them with `set -a; . .env.ci; set +a`. The test, typecheck, lint, and format commands need no prefix.

- `npx vitest run` — the full app suite. It was green at 3,657 tests before this plan's units.
- `npx tsc --noEmit -p tsconfig.json`
- `npx eslint <changed files>`
- `npx prettier --check <changed files>` — including the markdown in U3 and U7, because CI's `format` job checks every tracked file.
- `npx next build` — required for U4, since only a real build regenerates route types after a route is deleted.

Gates:

- The what's-new page suite must stay green, including "never gives a decorative icon a per-stroke alpha" and "gives every decorative icon a flattened group opacity".
- Every new guard in U1, U2, and U6 is falsified once. A guard that has never been observed failing is not known to guard anything.
- U5's evidence is gathered before U4 deletes the harness, and a regression stops the run rather than being recorded.

## Definition of Done

**Global:**

- All seven units complete, with their verification satisfied.
- No throwaway harness, scratch script, or running dev server remains.
- The full `apps/web` suite, typecheck, lint, format, and build pass.
- Abandoned or experimental code from this session is removed, not left in the diff.

**Per unit:**

- U2 — the shared component has its own test file, and the what's-new echo guard has coverage.
- U1 — the select-to-copy guard exists and is falsified once.
- U6 — `aria-controls` resolves per row and the assistive-technology pass is recorded.
- U3 — both `feat-317` artifacts carry a dated note naming all four superseded items, `linear_issue` is set, and FGE-40 is told.
- U5 — served-HTML, render-cost, hover-contrast, and authored-content evidence are recorded as a PR-body-ready block.
- U7 — the cross-platform re-alignment ticket exists.
- U4 — the harness route is gone and `git status` is clean of scaffolding.

**Handoff:** The PR body must carry U5's evidence block and call out the KTD4 disclosure-contract change against `feat-317` / FGE-40. That call-out names what was restored (`aria-controls`) and what was deliberately surrendered (`feat-317` R3, collapsed content hidden from assistive technology), so the reviewer agrees to a bounded trade rather than an unscoped reversal.
