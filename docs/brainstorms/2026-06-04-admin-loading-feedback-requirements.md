---
date: 2026-06-04
topic: admin-loading-feedback
---

# Admin Loading Feedback And Slow Route UX

## Summary

Improve Forge Admin so route changes acknowledge clicks immediately and slow
dashboard pages show purposeful loading states while targeted performance work
reduces the heaviest videos and languages waits.

---

## Problem Frame

Operators using Forge Admin can click into data-heavy screens such as
`/dashboard/videos` and `/dashboard/languages` and see the current window stay
visually still while the next server-rendered route loads. The delay makes it
unclear whether the click was registered, which undermines trust even when the
route eventually succeeds.

---

## Actors

- A1. Admin operator: uses the dashboard to browse videos, language diagnostics,
  and other operational screens.
- A2. Implementing agent: plans and ships a scoped admin UX/performance slice
  without widening into unrelated admin redesign work.

---

## Key Flows

- F1. Navigation click feedback
  - **Trigger:** An operator clicks an internal dashboard link, sidebar item,
    command-palette route, pagination control, or row link.
  - **Actors:** A1
  - **Steps:** The click receives immediate visual acknowledgement; the current
    route remains understandable while the next route resolves; the pending
    state clears when the new route is ready.
  - **Outcome:** The operator can tell the click was accepted even when server
    rendering or data loading takes noticeable time.
  - **Covered by:** R1, R2, R3, R5

- F2. Slow page load fallback
  - **Trigger:** An operator navigates to `/dashboard/videos`,
    `/dashboard/languages`, or another dashboard route whose server work does
    not resolve instantly.
  - **Actors:** A1
  - **Steps:** The dashboard shell stays stable; the content area shows a
    Forge Editorial loading surface; videos and languages use skeletons that
    match their final information architecture; the final content replaces the
    fallback without layout shock.
  - **Outcome:** The slow route feels like active loading rather than a frozen
    browser window.
  - **Covered by:** R2, R4, R5, R6, R8

- F3. Performance follow-through
  - **Trigger:** Implementation identifies obvious route work that can be made
    cheaper without changing product behavior.
  - **Actors:** A2
  - **Steps:** The implementing agent measures or characterizes the heavy path,
    applies targeted improvements, and preserves route behavior with tests.
  - **Outcome:** The first PR improves perceived speed everywhere and reduces
    confirmed slow work on priority routes where safe.
  - **Covered by:** R7, R8, R9, R10

---

## Requirements

**Navigation Feedback**

- R1. Internal admin navigation must show immediate feedback after a click or
  route-changing submission starts, including sidebar links, command-palette
  route links, video row links, and pagination links.
- R2. Pending feedback must preserve the current dashboard shell and make the
  loading state visible without hiding or scrambling existing context.
- R3. Pending feedback must clear when the destination route or URL state has
  resolved, including query-string-only changes such as video filters or
  pagination.
- R4. Route-level loading fallbacks must use the existing Forge Editorial visual
  grammar and must not introduce a separate visual system.

**Priority Routes**

- R5. `/dashboard/videos` must have a loading fallback shaped like the video
  library page so operators see that catalog data is loading.
- R6. `/dashboard/languages` must have a loading fallback shaped like the
  language diagnostics page so operators see that diagnostics are loading.
- R7. Video and language route performance improvements should be targeted to
  confirmed heavy work and must preserve existing read-only behavior,
  URL-backed filters, pagination, diagnostics, and empty states.

**Quality And Boundaries**

- R8. Loading states must be accessible to keyboard and assistive-technology
  users through appropriate status semantics or live announcements.
- R9. The implementation must not change Prisma schema, Pothos schema,
  GraphQL SDL, generated clients, auth/session semantics, or public consumer
  app behavior unless a measured bottleneck proves such a change is required.
- R10. Tests and browser proof must cover both the visible route feedback and
  the priority slow-route loading surfaces.

---

## Acceptance Examples

- AE1. **Covers R1, R2, R3.** Given an operator is on `/dashboard`, when they
  click the sidebar Videos link, the shell immediately shows a route-changing
  status and the status clears after `/dashboard/videos` is active.
- AE2. **Covers R1, R3.** Given an operator is on `/dashboard/videos`, when
  they click pagination or submit a filter that changes only the query string,
  pending feedback appears and clears when the updated URL state is rendered.
- AE3. **Covers R5, R6.** Given `/dashboard/videos` or `/dashboard/languages`
  server data is still loading during navigation, the content area shows a
  page-shaped loading surface rather than leaving the old route looking idle.
- AE4. **Covers R7, R9.** Given a performance improvement is made to a priority
  route, existing filters, diagnostics, read-only boundaries, and generated
  GraphQL outputs remain unchanged.

---

## Success Criteria

- Operators can tell within one interaction beat that a dashboard click or
  filter submission was accepted.
- Slow videos and languages navigations feel active and intentional instead of
  frozen.
- The first implementation slice improves perceived loading across admin and
  includes targeted route-speed work only where the codebase shows a safe,
  confirmed opportunity.
- The handoff to planning is concrete enough that implementation does not need
  to invent loading behavior, scope boundaries, or validation expectations.

---

## Scope Boundaries

- Do not redesign the admin navigation, dashboard layout system, or Forge
  Editorial token palette.
- Do not build new video creation, editing, language editing, or bulk action
  workflows.
- Do not add saved views, advanced search syntax, or broader dashboard
  performance rewrites.
- Do not change Prisma, Pothos, GraphQL generated outputs, or public app
  contracts unless profiling proves a narrow contract change is necessary.
- Do not attempt to solve every admin route's data-loading cost in one PR.

---

## Key Decisions

- Use a staged approach: immediate route feedback comes first, then targeted
  slow-route improvements.
- Make the loading pattern shared at the admin shell/route level so the fix is
  not limited to videos.
- Treat `/dashboard/videos` and `/dashboard/languages` as priority proof
  points because they are the screens called out by the user and already have
  heavy server-owned data loaders.
- Preserve the existing dense, operational admin design language; loading UI
  should feel native to Forge Editorial rather than decorative.

---

## Dependencies / Assumptions

- The dashboard remains a Next.js App Router surface with a persistent admin
  shell and server-rendered route content.
- Current video filters, pagination, and language diagnostics are expected to
  continue working without schema changes.
- Browser validation should use the repo's configured admin local-dev path and
  Helium/in-app browser availability for local smoke proof.

---

## Outstanding Questions

### Deferred to Planning

- [Affects R7][Needs research] Which route-load work is actually the safest
  first performance win after inspecting current videos and languages data
  paths?
- [Affects R10][Needs research] Which local browser surface is available in the
  current Codex environment for the required admin smoke proof?
