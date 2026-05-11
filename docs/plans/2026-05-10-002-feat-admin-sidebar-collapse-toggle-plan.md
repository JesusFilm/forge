---
title: "feat: Admin Sidebar Collapse Toggle"
type: feat
status: active
date: 2026-05-10
---

# feat: Admin Sidebar Collapse Toggle

## Summary

Add a desktop sidebar hide/show control to the Forge Admin shell. The desktop sidebar gets a close button in its upper-right header area; once hidden, a matching open button appears in the top bar so editors can recover the navigation without leaving the current page.

---

## Assumptions

*This plan was authored without synchronous user confirmation. The items below are agent inferences that fill gaps in the input -- un-validated bets that should be reviewed before implementation proceeds.*

- The request targets the desktop `xl` admin sidebar shown in the screenshot, not the existing mobile drawer close button.
- The collapsed state can be session-local React state; persistence across reloads is not required for this fix.
- The top-bar open affordance should use the existing menu icon/button pattern and remain visible on desktop only while the sidebar is hidden.

---

## Requirements

- R1. Desktop sidebar has an upper-right close control that hides the fixed navigation sidebar.
- R2. When the sidebar is hidden, the main dashboard content shifts left and uses the freed horizontal space.
- R3. A visible top-bar control lets the user show the sidebar again.
- R4. Existing mobile drawer behavior, route highlighting, nav filtering, search palette, locale switcher, and profile footer remain unchanged.

---

## Scope Boundaries

- Do not redesign the admin navigation or change nav item data.
- Do not add new color tokens or one-off palette values.
- Do not persist collapsed state in local storage in this pass.
- Do not alter page route behavior or the experience editor/chat layout beyond the shell margin change caused by hiding the sidebar.

---

## Context & Research

### Relevant Code and Patterns

- `apps/admin/src/components/admin-shell.tsx` owns the fixed desktop sidebar, mobile drawer, top header, and `ShellSidebarContent`.
- `apps/admin/src/components/admin-shell.test.tsx` already covers translated nav rendering and role-based route filtering.
- The mobile drawer already passes `onClose` to `ShellSidebarContent`, which conditionally renders an upper-right `X` button.
- `apps/admin/AGENTS.md` and `apps/admin/CLAUDE.md` require reuse of existing admin UI tokens and no cross-app imports.

### Institutional Learnings

- No directly relevant prior solution doc found. Existing admin UI instructions are sufficient.

### External References

- None. This is a local shell interaction change with established code patterns.

---

## Key Technical Decisions

- Reuse `ShellSidebarContent`'s existing `onClose` affordance for desktop as well as mobile, so the close button lands in the same upper-right header area shown in the screenshot.
- Add a dedicated `isDesktopSidebarOpen` state in `AdminShell`; keep it separate from `isNavOpen` so desktop collapse cannot interfere with mobile overlay behavior.
- Render the desktop fixed sidebar only when `isDesktopSidebarOpen` is true on `xl` screens, and switch the content wrapper between `xl:ml-[240px]` and `xl:ml-0`.
- Show the existing menu-style open button in the top bar on desktop only while the desktop sidebar is hidden; keep the mobile menu button behavior unchanged.

---

## Open Questions

### Resolved During Planning

- Button placement: upper-right of the existing sidebar brand/header block, matching the screenshot request and current mobile drawer close placement.
- Restore placement: top-left of the sticky header, using the existing shell menu button styling.

### Deferred to Implementation

- Exact accessible label copy may be refined to distinguish desktop "Show sidebar" from mobile "Open navigation" if tests reveal ambiguity.

---

## Implementation Units

### U1. Add Desktop Sidebar Hide/Show State and Controls

**Goal:** Let desktop users hide the fixed admin sidebar from the sidebar header and restore it from the top bar.

**Requirements:** R1, R2, R3, R4

**Dependencies:** None

**Files:**
- Modify: `apps/admin/src/components/admin-shell.tsx`
- Modify: `apps/admin/src/components/admin-shell.test.tsx`
- Create: `docs/roadmap/platform/feat-122-admin-sidebar-collapse-toggle.md`

**Approach:**
- Add `isDesktopSidebarOpen` state to `AdminShell`, defaulting open.
- Pass `onClose={() => setDesktopSidebarOpen(false)}` to the fixed desktop `ShellSidebarContent`.
- Make the main content wrapper margin conditional on the desktop sidebar state.
- Keep the existing mobile `isNavOpen` overlay logic intact.
- Add a desktop-only show button in the header when the sidebar is hidden, and keep the existing mobile menu button available on narrow viewports.

**Patterns to follow:**
- Existing `ShellSidebarContent` `onClose` conditional button pattern.
- Existing top-bar menu button classes and lucide icon usage.

**Test scenarios:**
- Happy path: initial server render includes translated nav and the sidebar close affordance.
- Happy path: clicking the desktop close control hides the sidebar and reveals a show-sidebar button in the header.
- Happy path: clicking the show-sidebar button restores the sidebar and removes the desktop show button.
- Regression: editor principals still do not see admin-only routes.

**Verification:**
- On `/dashboard/experiences/[id]?locale=en`, clicking the upper-right sidebar close button hides the sidebar and expands the editor area leftward.
- Clicking the top-bar show button restores the sidebar without changing route or page state.

---

## System-Wide Impact

- **Interaction graph:** Client-only shell state controls the desktop sidebar and wrapper margin.
- **Error propagation:** No change.
- **State lifecycle risks:** Collapsed state is intentionally ephemeral; route changes do not need persistence.
- **API surface parity:** No GraphQL, Prisma, route handler, or server action changes.
- **Integration coverage:** Browser verification is useful because jsdom cannot prove actual layout width shifts.
- **Unchanged invariants:** Nav item visibility, active route styling, mobile drawer behavior, search palette, locale switcher, and authenticated dashboard gating remain unchanged.

---

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| Desktop close button appears in mobile drawer twice | Keep one `onClose` prop per rendered `ShellSidebarContent`; desktop fixed sidebar and mobile drawer are separate render paths. |
| Header has ambiguous menu controls on desktop | Show the desktop restore button only when the desktop sidebar is hidden; keep mobile button `xl:hidden`. |
| Existing staged shell change is overwritten | Edit around the current file state and preserve unrelated staged changes. |

---

## Documentation / Operational Notes

- No operator docs needed. The control is discoverable in the shell chrome.

---

## Sources & References

- User request: `http://localhost:3003/dashboard/experiences/cmownijny0002o05q0hzf79d6?locale=en` plus screenshot of the desktop admin sidebar.
- Related code: `apps/admin/src/components/admin-shell.tsx`
- Related test: `apps/admin/src/components/admin-shell.test.tsx`
