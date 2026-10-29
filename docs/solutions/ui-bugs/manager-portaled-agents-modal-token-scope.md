---
module: "apps/manager Agents modal"
tags: [manager, portal, modal, css, mobile, accessibility]
problem_type: "ui_bug"
date: "2026-10-28"
---

# Portaled Manager dialogs need an explicit design-system scope

The Agents dialog portals to `document.body`. Scoped selectors such as
`.design-system-eleven .agents-modal` therefore do not match merely because the
React parent renders inside Manager's dashboard. This lost dark-theme styling
and mobile overlay bounds even though those rules existed in `globals.css`.

Apply the existing design-system class to the portaled backdrop. Match the
backdrop itself with `.design-system-eleven.agents-modal-backdrop`, while its
children continue using descendant selectors. Override the scope's page-sized
`min-height` on the fixed backdrop. Otherwise inherited page padding and sizing
can displace a dialog beyond the visible viewport. Use existing semantic tokens
for recipe, choice and review surfaces too; inherited text cannot override
literal colors on descendants.

Check actual computed styles and dialog rectangles after animations finish in
both themes, including a short mobile viewport. Verify horizontal client/scroll
widths and reach the footer by scrolling. On the profile menu, grid children
also need `min-width: 0`: truncating their text alone does not prevent intrinsic
minimum widths from expanding the track beyond the viewport.

Modal opening should focus inside the portal, Tab should stay within visible
controls, and closing should restore the trigger. Keep navigation and final
submit buttons under distinct React keys: reusing a DOM button while changing
its type from button to submit can turn the navigation click into creation.
An explicit active-step submit guard also protects implicit submissions from
rules. See `docs/validation/manager-pr916-2026-10-28/README.md` for browser
characterization, regression tests and measured page-load limits.

Replacing a focused keyed navigation button also drops focus to BODY. On a
wizard step transition, focus the new step's heading with `tabIndex={-1}` so
the next Tab continues into that step's controls. Skip focus on initial mount
and same-step edits to preserve modal opening and typing. Apply the same handoff
to backward transitions and verify native Tab/Shift+Tab behavior in a real
browser; jsdom focus assertions cannot establish scroll or tab-order behavior.
