---
title: "Manager review player Before/After toggle button semantics"
date: "2026-04-12"
category: ui-bugs
module: apps/manager
problem_type: ui_bug
component: tooling
severity: medium
symptoms:
  - "Before/After review switch used tablist/tab roles for a simple mode toggle"
  - "No tabpanel or aria-controls relationship existed for the advertised tab pattern"
  - "Arrow-key tab navigation was not implemented"
  - "Assistive technology could receive a tab contract that the UI did not fulfill"
root_cause: wrong_api
resolution_type: code_fix
related_components:
  - "apps/manager/src/features/jobs/review-player/review-player-card.tsx"
  - "apps/manager/src/app/globals.css"
tags:
  - accessibility
  - aria
  - review-player
  - toggle-buttons
  - manager
  - code-review
---

# Manager review player Before/After toggle button semantics

## Problem

The manager job detail review player has a `Before` / `After` switch for comparing live CMS state with generated enrichment output. A code review found that the switch used partial ARIA tab semantics: `role="tablist"` around `role="tab"` buttons, but no linked `tabpanel`, no `aria-controls`, and no arrow-key tab behavior.

The interaction was not actually a tabbed interface. It was a two-state review mode switch, so the accessibility contract was misleading even though the visual behavior worked.

## Symptoms

- Screen readers and browser agents could interpret the control as tabs.
- The page did not provide tab panels for those tabs.
- Keyboard behavior did not match the ARIA tabs pattern.
- The UI had extra semantics for a binary mode switch that could be represented with native buttons.

## What Didn't Work

**Completing the full tab pattern:** This would require `aria-controls`, stable panel IDs, a tabpanel, and arrow-key handling. That would be correct for a true tabbed interface, but it adds complexity for a control whose only job is changing review mode.

**Keeping the tab roles as-is:** Partial ARIA patterns are worse than plain HTML because they promise behavior and relationships that do not exist.

**Changing layout or styles:** The visual pill control already worked. The issue was semantic, not visual, so CSS did not need a rewrite.

## Solution

Use a labeled button group and expose selection with `aria-pressed`.

```tsx
<div className="jobs-review-tabs" role="group" aria-label="Review mode">
  {(["before", "after"] as const).map((nextMode) => (
    <button
      key={nextMode}
      type="button"
      aria-pressed={state.mode === nextMode}
      className={`jobs-review-tab ${state.mode === nextMode ? "is-active" : ""}`}
      onClick={() => setMode(nextMode)}
    >
      {nextMode === "after" ? "After" : "Before"}
    </button>
  ))}
</div>
```

The fix lives in `apps/manager/src/features/jobs/review-player/review-player-card.tsx`. The existing pill styles in `apps/manager/src/app/globals.css` stayed reusable because they style `.jobs-review-tabs`, `.jobs-review-tab`, and `.jobs-review-tab.is-active` without relying on ARIA tab roles.

## Why This Works

The accessible role now matches the product behavior:

- The wrapper is a named control group: `role="group"` with `aria-label="Review mode"`.
- Each option is a real `<button>`, preserving native keyboard activation.
- `aria-pressed` exposes the current mode programmatically.
- The visual active state and accessible pressed state come from the same `state.mode` value.
- No tab-specific semantics remain, so the UI no longer needs tabpanel relationships or arrow-key tab navigation.

This keeps the review player simpler and avoids an overbuilt ARIA pattern.

## Prevention

Use this review checklist for future comparison controls:

- If the user is choosing a view mode, prefer native buttons with `aria-pressed`.
- If the interface is truly tabs, implement the full pattern: `tablist`, `tab`, `tabpanel`, `aria-controls`, one selected tab, and arrow-key navigation.
- Do not leave `role="tab"` without a matching `tabpanel`.
- Do not use `aria-selected` on plain toggle buttons.
- Assert that the default state has exactly one active option.
- Assert that toggling swaps both the visual active state and `aria-pressed`.
- Browser-smoke user-facing toggles with both states and save screenshots when the surface is visual.

## Verification

The fix was verified with:

```bash
pnpm --filter @forge/manager test -- src/features/jobs/review-player/review-player-presenter.test.ts src/features/jobs/review-player/review-player-metadata.test.ts src/features/jobs/review-player/load-job-review-context.test.ts 'src/app/api/jobs/[id]/review-context/route.test.ts'
pnpm --filter @forge/manager typecheck
pnpm --filter @forge/manager lint
git diff --check
```

Browser smoke assertions on the authenticated manager job detail page checked:

- The `Review mode` control is a group, not tabs.
- There are no elements with role `tab`.
- `After` is pressed by default.
- Clicking `Before` swaps `aria-pressed` values.
- The review card remains visible and changes from generated output to live state.

Proof screenshots:

- `output/playwright/job-review-tab-semantics-after.png`
- `output/playwright/job-review-tab-semantics-before.png`

## Related Docs

- Origin brainstorm: `docs/brainstorms/2026-04-12-job-detail-enrichment-review-player-brainstorm.md`
- Implementation plan: `docs/plans/2026-04-12-feat-job-detail-enrichment-review-player-plan.md`
- Review finding todo: `.context/compound-engineering/todos/030-complete-p2-finish-review-mode-accessibility.md`
- Render-test follow-up: `.context/compound-engineering/todos/033-pending-p3-add-review-player-card-render-test.md`
- Adjacent review-player data context: `docs/solutions/integration-issues/manager-job-read-model-source-language-metadata-20260409.md`
