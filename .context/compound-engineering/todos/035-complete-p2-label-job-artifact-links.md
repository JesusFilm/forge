---
status: complete
priority: p2
issue_id: "035"
tags: [manager, jobs, ui, accessibility]
dependencies: []
---

# Label Job Workflow Artifact Links

Add visible text labels next to every artifact download link in Manager job workflow steps.

## Problem Statement

The Manager job detail view under Jobs > Workflow Steps renders downloadable artifacts as unlabeled external-link icons. When a step exposes multiple artifacts, users cannot tell which icon opens which file without relying on hover/title text or trial and error.

The requested behavior is to show a human-readable label next to every artifact icon, for example:

- Transcript raw
- Subtitles raw
- Subtitles processed
- Audio raw
- Audio clean
- Chapters JSON
- Chapters VTT
- Translation JSON

This matters because artifact links are used for workflow review/debugging, and icon-only links are ambiguous and weak for accessibility.

## Findings

- User-provided screenshot shows the Artifacts column containing repeated external-link icons with no adjacent visible text.
- Artifact links are rendered in `apps/manager/src/features/jobs/collapsible-step-row.tsx` via `.jobs-step-artifact-link`, currently using `aria-label` and `title` derived from `artifact.key` but no visible label.
- Artifact keys and step mapping live in `apps/manager/src/lib/job-artifacts.ts` through `getArtifactsForStep`.
- Current known artifact keys include `transcript`, `subtitles`, `subtitlesVtt`, `chapters`, `chapters-vtt`, `metadata`, `embeddings`, `translations`, `original-audio`, `cleaned-audio`, and dynamic `subtitles-{locale}` / `translation-{locale}` keys.
- Link sizing/styles live in `apps/manager/src/app/globals.css` under `.jobs-step-artifacts`, `.jobs-step-artifact-link`, and `.jobs-step-artifact-icon`.
- Existing helper tests in `apps/manager/src/lib/job-artifacts.test.ts` verify artifact key ordering and URLs but do not cover visible labels.

## Proposed Solutions

### Option 1: Add labels in the artifact helper

**Approach:** Extend `getArtifactsForStep` to return `{ key, url, label }`, with a small label formatter for exact artifact keys and dynamic translation/subtitle keys. Render the label next to the external-link icon in `CollapsibleStepRow`.

**Pros:**

- Keeps display naming close to artifact classification logic.
- Makes unit tests straightforward in `job-artifacts.test.ts`.
- Reuses the same label for visible text, `aria-label`, and `title`.

**Cons:**

- Changes the helper return shape and all call sites must be checked.

**Effort:** 1-2 hours

**Risk:** Low

---

### Option 2: Format labels directly in the row component

**Approach:** Keep `getArtifactsForStep` as-is and add a `formatArtifactLabel(artifact.key)` helper near `CollapsibleStepRow` or in a local jobs UI utility.

**Pros:**

- Smaller helper API change.
- Limits the implementation to the presentation layer.

**Cons:**

- Splits artifact classification from artifact naming.
- Harder to share if other job artifact surfaces later need the same labels.

**Effort:** 1 hour

**Risk:** Low

---

### Option 3: Store display labels in the artifact manifest

**Approach:** Add optional label metadata when artifacts are persisted in workflow code, then render that metadata when present.

**Pros:**

- Allows workflow-specific labels to be very explicit.

**Cons:**

- Wider data-contract change for a UI labeling issue.
- Existing jobs would still need fallback labels.
- More likely to touch generated or CMS-adjacent surfaces unnecessarily.

**Effort:** 4-6 hours

**Risk:** Medium

## Recommended Action

To be filled during triage. Initial recommendation: use Option 1, adding a typed artifact label in `apps/manager/src/lib/job-artifacts.ts` and rendering it in `apps/manager/src/features/jobs/collapsible-step-row.tsx`.

## Technical Details

**Affected files:**

- `apps/manager/src/lib/job-artifacts.ts` - build per-artifact labels alongside keys and URLs
- `apps/manager/src/lib/job-artifacts.test.ts` - assert labels for exact, audio, chapter, and dynamic translation/subtitle artifact keys
- `apps/manager/src/features/jobs/collapsible-step-row.tsx` - render the label next to the `ExternalLink` icon and use it in accessible names
- `apps/manager/src/app/globals.css` - update artifact link layout from icon-only square to icon + label while preserving compact wrapping in the Artifacts column

**Related components:**

- Manager Jobs detail page at `apps/manager/src/app/dashboard/jobs/[id]/page.tsx`
- Live job steps table at `apps/manager/src/features/jobs/live-job-steps-table.tsx`

**Database changes:**

- None expected.

## Resources

- User request: "manager > jobs > workflow steps add labels to every artifact link next to the icon. Like (subtitles raw, subtitles processed, audio raw, audio clean, etc.)"
- User screenshot: Artifacts column displays repeated external-link icons without visible labels.

## Acceptance Criteria

- [x] Every artifact link in Manager Jobs > Workflow Steps shows a visible text label next to the external-link icon.
- [x] Labels distinguish similar artifacts, including raw vs processed subtitles and raw vs cleaned audio where the underlying artifact keys allow it.
- [x] Dynamic subtitle and translation artifacts include useful locale context when present in keys, such as `subtitles-fr` or `translation-es`.
- [x] Link accessible names and titles use the human-readable label rather than raw internal keys where possible.
- [x] Artifact links still open the same URLs in a new tab and do not toggle collapsible step rows when clicked.
- [x] The Artifacts column wraps labels cleanly on narrow widths without collapsing back to icon-only ambiguity.
- [x] Relevant tests cover artifact label generation and/or rendering.

## Work Log

### 2026-04-13 - Initial Capture

**By:** Codex

**Actions:**

- Captured the user-requested Manager Jobs workflow-step artifact labeling improvement.
- Confirmed likely implementation entry points through code search.
- Documented implementation options and acceptance criteria for triage.

**Learnings:**

- Current artifact links have accessible `aria-label`/`title` strings based on raw keys, but no visible text labels.
- `getArtifactsForStep` is the central place that maps artifact keys to the per-step link list.

### 2026-04-13 - Implementation

**By:** Codex

**Actions:**

- Added human-readable labels to the Manager job artifact link model in `apps/manager/src/lib/job-artifacts.ts`.
- Rendered those labels beside the external-link icon in `apps/manager/src/features/jobs/collapsible-step-row.tsx`.
- Updated artifact link CSS so labels wrap cleanly without introducing new colors.
- Added focused tests for artifact label generation and row rendering.
- Confirmed red/green TDD: the focused tests failed first because labels were missing, then passed after implementation.

**Validation:**

- `pnpm --filter @forge/manager test -- src/lib/job-artifacts.test.ts src/features/jobs/collapsible-step-row.test.ts`
- `pnpm --filter @forge/manager test`
- `pnpm --filter @forge/manager lint`
- `pnpm --filter @forge/manager typecheck`
- `git diff --check`
- Browser smoke via a temporary `/login/artifact-label-smoke` fixture route, removed after validation. The smoke rendered the real `CollapsibleStepRow` and `getArtifactsForStep` label output, clicked a `_blank` artifact link, and confirmed the original row did not toggle (`Toggle count: 0`). Screenshot evidence: `https://tmpfiles.org/dl/33309066/artifact-labels-after-artifact-click.png`.

**Learnings:**

- The real Manager job detail route is blocked without a Strapi-backed authenticated session and real job record, so browser proof used the same temporary fixture-route pattern already documented in repo plans.
- Next dev type generation can retain removed temporary routes under `.next/dev/types`; clearing `apps/manager/.next` before the final typecheck avoids stale fixture references.

## Notes

- Keep labels product-facing and concise. Avoid exposing raw internal keys as the primary UI copy when a clearer label exists.
- Exact final label vocabulary should match how the workflow team refers to artifacts in debugging and review, especially the user's requested "raw" and "processed/clean" distinctions.
