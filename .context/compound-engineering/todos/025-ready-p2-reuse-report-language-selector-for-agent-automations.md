---
status: ready
priority: p2
issue_id: "025"
tags: [manager, agents, ui, languages]
dependencies: []
---

# Reuse Report Language Selector For Agent Automations

## Problem Statement

The Agents new automation modal currently uses a custom checkbox grid for target language selection. That diverges from the Report screen language selection experience and risks duplicate UI behavior, styling drift, and inconsistent search/geography affordances.

Target language selection for agent automations should reuse exactly the same language section/component from the Report view/screen instead of maintaining a separate language picker.

## Findings

- The Report screen renders its language selection section in `apps/manager/src/features/coverage/coverage-report-client.tsx` using the `language-panel-section` / `language-panel-layout` wrapper and `LanguageGeoSelector`.
- The underlying component lives in `apps/manager/src/features/coverage/LanguageGeoSelector.tsx`.
- `LanguageGeoSelector` currently couples selection to Report URL search params via `usePathname`, `useRouter`, `useSearchParams`, and `normalizeCoverageLanguageSearchParams`.
- The Agents modal target language UI is in `apps/manager/src/features/agents/automation-form.tsx` and currently renders plain checkboxes with a local single-language disable rule.
- Agent target subtitle automations intentionally allow exactly one target language for V1, so the reused Report language selector either needs a controlled/single-select mode or a small wrapper that preserves the Report UI while enforcing the one-language automation contract.

## Proposed Solutions

### Option 1: Extract A Shared Controlled Language Selector

**Approach:** Refactor `LanguageGeoSelector` so its core UI can be used as a controlled component with `value`, `onChange`, and an optional single-select mode. Keep the Report URL-sync behavior in a Report-specific wrapper, and use the same shared UI in the Agents modal.

**Pros:**

- Exact UI/component reuse with one source of truth.
- Avoids Agents-specific language picker drift.
- Allows the Agents modal to enforce the one-language contract without Report URL side effects.

**Cons:**

- Requires a careful refactor of a large Report component.
- Needs focused regression coverage and a browser smoke test for both Report and Agents language selection.

**Effort:** 3-5 hours

**Risk:** Medium

---

### Option 2: Add A Report-Style Agents Wrapper Around `LanguageGeoSelector`

**Approach:** Add minimal props to `LanguageGeoSelector` for non-URL usage, then render it inside the same `language-panel-section` / `language-panel-layout` structure from the Agents modal.

**Pros:**

- Smaller than a full extraction if the current component can accept controlled callbacks cleanly.
- Still reuses the Report-facing language selector UI.

**Cons:**

- Can become awkward if URL sync and controlled selection are interleaved.
- May still leave Report and Agents behavior partially coupled in one component.

**Effort:** 2-4 hours

**Risk:** Medium

---

### Option 3: Copy Report Markup And Styles Into Agents

**Approach:** Duplicate the Report language section styling and behavior into the Agents modal.

**Pros:**

- Fastest immediate visual match.

**Cons:**

- Violates the requirement to reuse exactly the same component.
- Creates another drift-prone language picker.

**Effort:** 1-2 hours

**Risk:** High

## Recommended Action

Implement Option 1 unless a small controlled-mode prop change in Option 2 proves cleaner after reading `LanguageGeoSelector` end to end. The completed change should remove the Agents checkbox grid and render the same Report language selector UI inside the new automation modal, while preserving the V1 single-target-language automation rule.

## Technical Details

**Affected files:**

- `apps/manager/src/features/coverage/LanguageGeoSelector.tsx`
- `apps/manager/src/features/coverage/coverage-report-client.tsx`
- `apps/manager/src/features/agents/automation-form.tsx`
- `apps/manager/src/app/globals.css`
- Agent/coverage tests as needed

**Related components:**

- `LanguageGeoSelector` handles language fetch/search/geographic affordances for Report.
- Agents automation validation and runner already enforce exactly one target language for `target_subtitles_missing`.

**Database changes:**

- No database changes expected.

## Resources

- Existing Report selector component: `apps/manager/src/features/coverage/LanguageGeoSelector.tsx`
- Report usage: `apps/manager/src/features/coverage/coverage-report-client.tsx`
- Agents modal form: `apps/manager/src/features/agents/automation-form.tsx`
- Current smoke screenshot before this follow-up: `output/playwright/review-fix-agents-create-modal-target.png`

## Acceptance Criteria

- [ ] Agents new automation modal reuses the same Report language selector UI/component for target language selection.
- [ ] Agents target subtitle automations still allow exactly one selected target language.
- [ ] Agents no longer render the custom checkbox grid for target languages.
- [ ] Report language selection behavior remains unchanged.
- [ ] Unit/component-level coverage is added or updated for the shared selector behavior where feasible.
- [ ] User-like browser smoke covers Report language selection and Agents modal target language selection, with screenshots or equivalent validation.
- [ ] `pnpm --filter @forge/manager test -- src/features/agents src/features/coverage` passes.
- [ ] `pnpm --filter @forge/manager typecheck`, `pnpm format:check`, and relevant lint/test checks pass.

## Work Log

### 2026-04-12 - Initial Discovery

**By:** Codex

**Actions:**

- Captured the follow-up requirement from review: target language selection should reuse exactly the same language section component from the Report screen.
- Located the Report language selector implementation and current Agents modal checkbox implementation.
- Identified the main implementation wrinkle: Report selector currently owns URL search-param updates, while Agents needs controlled modal-local state and a one-language contract.

**Learnings:**

- The right fix is a reuse/refactor task, not just a styling tweak.
- The existing V1 safety rule of one target language should stay intact while the UI changes.

## Notes

- Keep this as a follow-up to the Agents automation modal work.
- Avoid introducing a second Report-like picker in Agents; the requirement is component reuse.
