---
title: Admin Interaction Affordance Polish
type: fix
status: active
date: 2026-06-01
---

# Admin Interaction Affordance Polish

## Summary

This plan tightens the Forge Admin dashboard's interaction affordances so live controls look and behave clickable, unfinished controls are visibly unavailable, and read-only operational surfaces stop implying hidden actions. The implementation will extend the existing admin UI primitives and then audit the current dashboard routes that surfaced inert or misleading controls during the usability pass.

---

## Problem Frame

The production admin panel mixes real operational controls, read-only diagnostics, and future workflow affordances. Several controls currently look active but do nothing, while shared table and button patterns imply clickability even on static information surfaces. That makes the admin panel feel less trustworthy, especially around sync and editorial actions.

---

## Assumptions

_This plan was authored without synchronous user confirmation. The items below are agent inferences that fill gaps in the input -- un-validated bets that should be reviewed before implementation proceeds._

- Treat this as a focused interaction-affordance fix, not a redesign of the Forge Editorial visual language.
- Disable or demote unimplemented controls instead of building the missing workflows in this PR.
- Preserve implemented operational actions, including Core Sync dispatch, semantic search, workflow filtering, and experience creation where permissions allow it.
- Keep scope inside `apps/admin` plus the required roadmap and plan documentation.

---

## Requirements

- R1. Every enabled clickable admin control has an explicit pointer cursor and a clear hover state.
- R2. Disabled or unimplemented controls render semi-transparent, non-clickable, and without an enabled hover affordance.
- R3. Static read-only table rows and cards do not show row hover or action icons unless they actually navigate or open an action surface.
- R4. Icon-only controls have accessible names and a visible affordance; icon controls with no implemented action are disabled or hidden.
- R5. Existing implemented dashboard flows continue to work and retain their existing permission checks.
- R6. Side-effect actions, especially sync-related actions, must not appear as live buttons unless they are wired to a real implementation and user feedback.
- R7. Shared UI primitives make correct affordance behavior the default for future admin pages.
- R8. The finished work is verified with targeted admin tests and a Helium browser smoke pass over representative dashboard routes.

---

## Scope Boundaries

- Do not add new GraphQL fields, Prisma models, service-layer mutations, or generated schema outputs.
- Do not build the missing video filter, manual video creation, row quick-action menus, or top-bar help surface in this pass.
- Do not redesign the dashboard layout, navigation structure, card information hierarchy, or visual token palette.
- Do not change auth/session behavior or cross-app imports.

### Deferred to Follow-Up Work

- Implementing the disabled video workflow actions as real product workflows should be planned against the video and media editorial roadmap.
- Turning the command palette into a real searchable command input can be handled separately if route navigation alone is no longer sufficient.

---

## Context & Research

### Relevant Code and Patterns

- `apps/admin/src/components/admin-ui.tsx` owns shared `PrimaryButton`, `SecondaryButton`, `SearchPillButton`, and `DataTable` primitives.
- `apps/admin/src/components/admin-shell.tsx` owns the top-bar icon buttons, command palette, locale controls, and mobile nav trigger.
- `apps/admin/src/app/dashboard/page.tsx` renders the dashboard `Run Manual Sync` CTA without a handler.
- `apps/admin/src/app/dashboard/videos/page.tsx` renders active-looking `Filter`, `Add manual video`, and row quick-action controls that do not currently implement those workflows.
- `apps/admin/src/app/dashboard/workflows/core-sync-trigger-button.tsx` already demonstrates the desired enabled/disabled affordance pattern for a real side-effect action.
- `apps/admin/src/app/dashboard/dashboard-ui.test.tsx` and `apps/admin/src/components/admin-shell.test.tsx` provide existing render-level coverage for the touched UI surface.

### Institutional Learnings

- `docs/handoffs/2026-04-14-admin-ui-codex-handoff.md` defines the Forge Editorial admin UI as dense, hairline-led, token-based, and conservative with brand-red primary actions.
- `docs/roadmap/platform/feat-091-admin-dashboard-ui.md` established the original dashboard shell and called out the need to replace placeholder admin scaffolding with operational surfaces.
- `docs/roadmap/platform/feat-097-admin-v1-pr-hardening.md` confirms that operator-visible placeholders are release-quality issues in the admin UI.
- `docs/roadmap/platform/feat-108-admin-experiences-dashboard-card-refinement.md` established that clickable experience cards should stay visibly led and direct, which should be preserved while improving disabled/permission states.

### External References

- None. Local patterns and live admin behavior are sufficient for this fix.

---

## Key Technical Decisions

- Extend existing primitives rather than introducing a second button system: the current admin UI already centralizes repeated button and table styling in `admin-ui.tsx`.
- Make disabled/unimplemented state explicit at the JSX/component boundary: placeholder actions should not depend on copy alone to signal that they are unavailable.
- Split static and interactive table affordances: read-only tables should avoid hover and action icons by default, while pages with real row actions can opt in.
- Keep the dashboard overview sync CTA non-operational unless it uses the real Core Sync trigger pattern: a production-looking primary button with no action is worse than a disabled placeholder.

---

## Open Questions

### Resolved During Planning

- Should this implement missing workflows or disable placeholders? Resolve by disabling/demoting placeholders; workflow implementation is outside this PR-sized fix.
- Should the fix be route-by-route or primitive-led? Resolve by updating shared primitives first, then auditing route-specific one-offs.

### Deferred to Implementation

- Exact wording for disabled placeholder hints: choose concise admin-local labels that fit existing messages and avoid expanding the i18n surface unless necessary.
- Whether each read-only `DataTable` caller needs an explicit `interactive` option or whether a default static table plus opt-in actions is cleaner after inspecting all current call sites.

---

## Implementation Units

### U1. Roadmap Ticket And Shared Affordance Primitives

**Goal:** Create the required roadmap ticket and make the shared admin controls encode pointer, hover, focus, and disabled behavior consistently.

**Requirements:** R1, R2, R7

**Dependencies:** None

**Files:**

- Create: `docs/roadmap/platform/feat-153-admin-interaction-affordance-polish.md`
- Modify: `apps/admin/src/components/admin-ui.tsx`
- Modify: `apps/admin/src/app/globals.css`
- Test: `apps/admin/src/app/dashboard/dashboard-ui.test.tsx`

**Approach:**

- Add a platform roadmap ticket with `status: "in-progress"` before UI implementation.
- Extend shared button primitives to accept disabled state and native button props while preserving existing visual defaults.
- Add explicit pointer, focus-visible, and disabled styles to shared interactive controls.
- Introduce a shared disabled/placeholder affordance only if it reduces repetition across the audited routes.

**Patterns to follow:**

- `apps/admin/src/app/dashboard/workflows/core-sync-trigger-button.tsx`
- `docs/handoffs/2026-04-14-admin-ui-codex-handoff.md`

**Test scenarios:**

- Happy path: rendering a shared enabled primary or secondary action includes pointer and hover affordance classes.
- Edge case: rendering a disabled shared action includes disabled cursor and opacity classes while preserving accessible disabled semantics.
- Regression: existing dashboard render tests still include translated dashboard content after primitive changes.

**Verification:**

- Shared buttons have correct enabled and disabled affordance classes in render output.

---

### U2. Disable Placeholder Actions On Dashboard And Videos

**Goal:** Remove misleading enabled affordances from dashboard and video actions that do not yet implement a workflow.

**Requirements:** R2, R4, R6

**Dependencies:** U1

**Files:**

- Modify: `apps/admin/src/app/dashboard/page.tsx`
- Modify: `apps/admin/src/app/dashboard/videos/page.tsx`
- Modify: `apps/admin/src/i18n/messages.ts`
- Test: `apps/admin/src/app/dashboard/dashboard-ui.test.tsx`

**Approach:**

- Render dashboard `Run Manual Sync` as an unavailable/read-only action unless it is intentionally replaced with the existing real Core Sync trigger.
- Render video `Filter`, `Add manual video`, and row quick actions as unavailable placeholders or remove the action chrome when no action is implemented.
- Keep any explanatory copy short and in the same operational voice as existing admin labels.

**Patterns to follow:**

- Disabled button treatment in `apps/admin/src/app/dashboard/workflows/core-sync-trigger-button.tsx`
- Existing message organization in `apps/admin/src/i18n/messages.ts`

**Test scenarios:**

- Happy path: dashboard overview no longer renders an enabled-looking inert sync button.
- Happy path: video header placeholder actions render disabled/unavailable.
- Edge case: video row quick actions do not expose an enabled click target when no row menu exists.

**Verification:**

- Helium smoke pass confirms placeholder actions are visibly disabled and do not show enabled hover/pointer behavior.

---

### U3. Remove False Table And Row Affordances

**Goal:** Ensure static operational tables do not imply clickability and interactive rows remain intentionally opt-in.

**Requirements:** R1, R3, R5, R7

**Dependencies:** U1

**Files:**

- Modify: `apps/admin/src/components/admin-ui.tsx`
- Modify: `apps/admin/src/app/dashboard/page.tsx`
- Modify: `apps/admin/src/app/dashboard/system-status/page.tsx`
- Modify: `apps/admin/src/app/dashboard/embeddings/page.tsx`
- Modify: `apps/admin/src/app/dashboard/languages/page.tsx`
- Modify: `apps/admin/src/app/dashboard/users/page.tsx`
- Modify: `apps/admin/src/app/dashboard/settings/page.tsx`
- Modify: `apps/admin/src/app/dashboard/partner-keys/page.tsx`
- Test: `apps/admin/src/app/dashboard/dashboard-ui.test.tsx`

**Approach:**

- Make `DataTable` static by default and only render hover/action affordances when the caller supplies real row actions or marks rows interactive.
- Remove hover styling from dashboard/system-status static rows that are not links or buttons.
- Preserve existing real navigation or action affordances in workflow and experience surfaces.

**Patterns to follow:**

- Read-only operational surfaces in `apps/admin/src/app/dashboard/partner-keys/page.tsx`
- Clickable experience cards in `apps/admin/src/app/dashboard/experiences/page.tsx`

**Test scenarios:**

- Happy path: read-only `DataTable` render output omits the trailing action icon by default.
- Happy path: static activity and sync-state rows do not include hover affordance classes.
- Regression: existing read-only dashboard pages still render their data rows and status pills.

**Verification:**

- Representative read-only pages show no row hover or action icon unless a real action exists.

---

### U4. Top-Bar And Permission-State Polish

**Goal:** Make shell icon controls and permission-gated actions communicate their state clearly to mouse, keyboard, and assistive-technology users.

**Requirements:** R1, R2, R4, R5

**Dependencies:** U1

**Files:**

- Modify: `apps/admin/src/components/admin-shell.tsx`
- Modify: `apps/admin/src/components/admin-shell.test.tsx`
- Modify: `apps/admin/src/app/dashboard/experiences/experiences-actions.tsx`
- Modify: `apps/admin/src/app/dashboard/embeddings/page.tsx`
- Modify: `apps/admin/src/app/dashboard/system-status/page.tsx`
- Test: `apps/admin/src/components/admin-shell.test.tsx`
- Test: `apps/admin/src/app/dashboard/dashboard-ui.test.tsx`

**Approach:**

- Add accessible labels and consistent pointer/focus affordances to implemented shell icon controls.
- Disable or hide the top-bar help button until it has an implemented destination or panel.
- Render permission-blocked create actions and read-only fallbacks as disabled upfront rather than requiring a click to discover the blocked state.
- Add disabled styling to form fields that can be unavailable, matching the existing button disabled pattern.

**Patterns to follow:**

- `CoreSyncTriggerButton` for real action feedback and disabled behavior.
- Existing `AdminShell` tests for render-level shell coverage.

**Test scenarios:**

- Happy path: command button has an accessible label and remains available.
- Edge case: help button is disabled/unavailable and named, not an unlabeled live icon button.
- Edge case: permission-blocked experience creation renders unavailable without opening the modal.
- Regression: locale controls still render and route refresh behavior remains unchanged.

**Verification:**

- Helium accessibility tree shows named shell icon controls and no live unlabeled help button.

---

### U5. Validation And Browser Smoke

**Goal:** Prove the affordance changes from tests and the live admin surface.

**Requirements:** R8

**Dependencies:** U1, U2, U3, U4

**Files:**

- Test: `apps/admin/src/app/dashboard/dashboard-ui.test.tsx`
- Test: `apps/admin/src/components/admin-shell.test.tsx`

**Approach:**

- Run targeted admin render tests for dashboard and shell behavior.
- Run admin typecheck if the primitive prop shape changes shared TypeScript surfaces.
- Start or reuse the admin local server only after following the worktree preview guidance.
- Use Helium for browser verification, checking hover/disabled/accessible states on dashboard, videos, system-status, embeddings, and experiences.

**Patterns to follow:**

- `apps/admin/docs/worktree-preview-setup.md`
- Existing admin package scripts in `apps/admin/package.json`

**Test scenarios:**

- Integration: targeted dashboard and shell tests pass after the component API changes.
- Browser smoke: enabled controls show pointer/hover, disabled placeholders look unavailable, and read-only rows do not imply action.

**Verification:**

- `pnpm --filter @forge/admin test -- src/app/dashboard/dashboard-ui.test.tsx src/components/admin-shell.test.tsx`
- `pnpm --filter @forge/admin typecheck`
- Helium smoke proof against representative dashboard routes.

---

## System-Wide Impact

- **Interaction graph:** Shared button and table primitives affect most dashboard pages, so route-specific static/action states need review.
- **Error propagation:** No new error propagation is introduced; existing server actions and API calls remain unchanged.
- **State lifecycle risks:** Disabling inert actions should reduce accidental production-action confusion; real side-effect actions must retain their existing pending/success/error feedback.
- **API surface parity:** No GraphQL, REST, Prisma, or generated type surfaces should change.
- **Integration coverage:** Render tests prove class/semantic output; Helium smoke proof is required for real cursor/hover/disabled perception.
- **Unchanged invariants:** Auth, permissions, data loading, service ownership, schema generation, and route availability stay unchanged.

---

## Risks & Dependencies

| Risk                                                                        | Mitigation                                                                                                                                  |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| A broad primitive change accidentally disables a real action                | Audit all modified call sites and add render assertions for enabled versus disabled behavior                                                |
| Disabled placeholders hide useful future intent too aggressively            | Keep labels visible but unavailable, with concise disabled styling rather than deleting all controls                                        |
| Table defaults remove affordances from a route that is actually interactive | Make interactivity explicit and preserve clickable cards/links where they already exist                                                     |
| Browser proof is hard against production auth or local auth loops           | Prefer the already-authenticated Helium production session for read-only smoke; use local server only when the route can be safely verified |

---

## Documentation / Operational Notes

- Update the new roadmap ticket to `status: "complete"` when the implementation and validation are finished.
- Do not record disabled placeholders as completed workflows; they remain intentionally deferred product work.

---

## Sources & References

- Related code: `apps/admin/src/components/admin-ui.tsx`
- Related code: `apps/admin/src/components/admin-shell.tsx`
- Related code: `apps/admin/src/app/dashboard/page.tsx`
- Related code: `apps/admin/src/app/dashboard/videos/page.tsx`
- Related roadmap: `docs/roadmap/platform/feat-091-admin-dashboard-ui.md`
- Related roadmap: `docs/roadmap/platform/feat-097-admin-v1-pr-hardening.md`
- Related roadmap: `docs/roadmap/platform/feat-108-admin-experiences-dashboard-card-refinement.md`
- Design handoff: `docs/handoffs/2026-04-14-admin-ui-codex-handoff.md`
