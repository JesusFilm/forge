---
title: "Manager dark-theme contrast requires final-cascade auditing"
date: "2026-08-21"
category: "ui-bugs"
module: "apps/manager"
problem_type: "ui_bug"
component: "frontend_stimulus"
symptoms:
  - "Dark surfaces looked brown or cold even after the root palette was updated"
  - "Coverage, workflow, SEO, and agent states inherited colors with the wrong semantic role"
  - "Disabled text and focus indicators fell below their contrast targets"
root_cause: "logic_error"
resolution_type: "code_fix"
severity: "medium"
tags:
  - "manager"
  - "dark-mode"
  - "css-cascade"
  - "semantic-colors"
  - "contrast"
  - "accessibility"
---

# Manager Dark-Theme Contrast Requires Final-Cascade Auditing

## Problem

Manager's root dark palette had the intended warm near-black foundation, but
later component rules still supplied light-theme literals, whole-card opacity,
or a semantic token intended for a different state. The source palette looked
correct while the rendered Coverage, Jobs, Smart Crop, Shorts, SEO, and Agents
screens still had weak or misleading contrast.

## Symptoms

- Completed and running workflow steps could render with the same green state.
- Disabled mismatch explanations used a danger color whose contrast was reduced
  further by ancestor opacity.
- Coverage focus outlines mixed semantic colors with transparency until they
  were too faint against dark panels.
- Secondary copy and empty media surfaces bypassed the shared muted and surface
  roles.

## What Didn't Work

- Updating only `:root[data-theme="dark"]` did not fix component rules that won
  later in `apps/manager/src/app/globals.css`.
- Reusing a color because its hue looked suitable did not preserve meaning. A
  completed-state green cannot also represent an in-progress state.
- Source inspection alone did not reveal the final rendered foreground,
  background, opacity, and focus-ring combinations.

## Solution

Treat the browser's computed style as the authority, then repair the winning
rules with existing semantic roles. Keep the foundation centralized at the
root, and add a dark-scoped consumer override only where a later base rule must
remain unchanged for the light theme.

For workflow progress, preserve distinct success and running states:

```css
:root[data-theme="dark"] .design-system-eleven .jobs-step-dot-completed {
  background: var(--ds-success);
}

:root[data-theme="dark"] .design-system-eleven .jobs-step-dot-running {
  background: var(--warn);
}
```

For disabled content, remove blanket opacity and assign a readable muted role
to the exact explanatory element:

```css
:root[data-theme="dark"] .seo-candidate-ticket.is-mismatch {
  opacity: 1;
  color: var(--ds-muted);
  background: var(--ds-panel-muted);
  border-color: var(--ds-line-strong);
}

:root[data-theme="dark"] .seo-candidate-ticket.is-mismatch em {
  color: var(--ds-muted);
}
```

For focus indicators whose element color already carries the semantic state,
use the full color on dark surfaces instead of diluting it with transparency:

```css
:root[data-theme="dark"] .coverage-number-item:focus-visible {
  outline-color: currentColor;
}
```

Verify each main route at desktop and narrow widths. Exercise dark and light
themes through the real user-menu switch, inspect computed styles for affected
states, measure contrast pairs, and capture screenshots of the key screens.

## Why This Works

CSS variables define available values, but the final cascade decides which
value a component actually renders. Auditing the winning rule catches late
literals, opacity inheritance, and semantic-role mismatches that token review
misses. Dark-scoped consumer overrides preserve established light rendering
while keeping status meaning and focus visibility intact.

## Prevention

- For palette work, map every affected selector to foreground, background,
  border, opacity, and interaction-state roles before editing tokens.
- Search the full stylesheet for later declarations of each affected selector.
- Validate status colors by meaning as well as hue and contrast.
- Review real routes in both themes and at both desktop and narrow widths.
- Measure focus indicators and disabled explanatory text, not only body copy.

## Related Issues

- `docs/solutions/design-patterns/manager-theme-source-and-shell-sync.md`
- `docs/solutions/ui-bugs/manager-tailwind-reference-branch-visual-parity-20260429.md`
- `docs/plans/2026-08-21-0913-fix-manager-dark-contrast-plan.md`
