---
title: Admin Workflows Embedded Library UI
type: refactor
status: complete
date: 2026-05-05
origin: docs/roadmap/platform/feat-100-admin-video-and-media-editorial-workflows.md
---

# Admin Workflows Embedded Library UI

## Overview

Drop Forge's custom `/dashboard/workflows` implementation in favor of the
embeddable workflow UI components provided by `@workflow/web-shared`. The goal
is not to host the standalone Workflow SDK observability app and not to keep
rebuilding trace, event, run-detail, or hook controls ourselves. The admin app
should own route protection, data fetching, and Forge-specific workflow
actions; the visual workflow/run UI should come straight from the library.

## Problem Frame

`apps/admin/src/app/dashboard/workflows/page.tsx` currently renders a bespoke
operational dashboard from `loadWorkflowsData()`: summary metrics, workers, and
recent run queues. That page is already drifting toward a mini workflow UI we
would have to keep designing, testing, and updating. The library now provides
embeddable workflow UI components, so the better architecture is to remove our
parallel surface and adapt admin's runtime data/actions to the library's
component contracts.

Important correction from planning: `@workflow/web` is a standalone
observability app and is not the target for this feature. It can remain a
developer/debugging tool, but the product direction here is embedded UI
components from `@workflow/web-shared` inside the existing admin shell.

## Requirements Trace

- Replace the custom Workflows page UI with library-provided embedded workflow
  UI components.
- Keep `/dashboard/workflows` inside the admin shell and behind admin session
  checks.
- Use route-per-run navigation: `/dashboard/workflows` is the authenticated run
  index, and `/dashboard/workflows/[runId]` renders the embedded library
  trace/detail UI for a selected run.
- Wire the embedded UI to real admin workflow runtime/ledger data rather than
  mock cards or hand-maintained duplicate presentation.
- Preserve Forge-owned workflow actions, such as Core Sync triggering, on their
  domain surfaces unless the library component contract explicitly supports
  action slots.
- Keep the change scoped to `apps/admin`, package dependencies, tests, and docs.

## Scope Boundaries

- Do not build a custom workflow canvas, run list, worker list, or run-detail
  UI if the library exposes those controls.
- Do not replace workflow execution, dispatch, Postgres World storage, or the
  admin workflow ledger.
- Do not use the standalone `@workflow/web` observability app as the production
  admin page for this work.
- Do not move Forge workflow triggers into a generic library UI unless the
  interaction is first-class in the embedded component API.
- Do not touch public web/mobile/TV consumers.

## Context And Patterns

- `apps/admin/package.json` currently depends on `workflow` and
  `@workflow/world-postgres`; add `@workflow/web-shared` as a direct dependency
  for the embedded UI.
- `@workflow/web-shared@4.1.5` exports:
  - `@workflow/web-shared/components`
  - `@workflow/web-shared/styles.css`
- `@workflow/web-shared` README describes the package as pre-styled,
  prop-driven UI components with no data fetching. Admin must fetch runtime
  data and pass data/callbacks into the components.
- The main exported components include `WorkflowTraceViewer`, `RunTraceView`,
  `EventListView`, `StreamViewer`, `HookResolveModalWrapper`,
  `ResolveHookDropdownItem`, `DataInspector`, `DecryptButton`,
  `LoadMoreButton`, `MenuDropdown`, and `Spinner`.
- `WorkflowTraceViewer` and `RunTraceView` expect `@workflow/world` runtime
  shapes such as `WorkflowRun`, `Event`, `Step`, and `Hook`, plus callbacks for
  hook resolution, sleep wake-up, cancel, stream click, span selection, event
  data loading, and pagination.
- `apps/admin/src/app/dashboard/workflows/page.tsx` is the custom UI to drop.
- `apps/admin/src/app/dashboard/ops-data.ts` owns `loadWorkflowsData()` and
  workflow summary shaping; some of this may become an adapter layer, and some
  may be deleted.
- `apps/admin/src/services/workflow-runtime.service.ts` reads Workflow runtime
  runs via `getWorld()` and may be useful for the library data adapter.
- `apps/admin/src/services/workflow-run-log.service.ts` owns Forge's workflow
  ledger and remains the audit/source-of-truth for admin-specific run metadata.
- `apps/admin/src/components/admin-nav.ts` owns the Workflows nav entry.
- `apps/admin/src/i18n/messages.ts` owns Workflows nav/page copy.
- `apps/admin/src/app/dashboard/dashboard-ui.test.tsx` currently asserts the
  bespoke Workflows page content and will need to shift to embedded UI contract
  tests.
- `apps/admin/docs/core-sync-recurring-job.md`,
  `apps/admin/docs/v1-operational-surfaces.md`, and
  `apps/admin/docs/cms-operational-vs-deferred.md` mention the workflows
  surface.

## Key Technical Decisions

- **Embed, do not recreate.** The Workflows route should render the library
  component(s) directly, with only thin admin adapters around auth, data, and
  layout.
- **Use `@workflow/web-shared`, not `@workflow/web`.** `@workflow/web-shared`
  provides the prop-driven components; `@workflow/web` is the standalone app
  with server actions wired.
- **Create a boundary adapter.** If the library expects a specific run/workflow
  model, add a small adapter module that translates admin's runtime/ledger rows
  into the component props. Keep this adapter narrow and covered by tests.
- **Keep the admin shell.** Operators should stay inside `/dashboard/workflows`
  with existing navigation, role handling, and session requirements.
- **Use route-per-run composition.** Keep the index route focused on finding a
  run, then render `@workflow/web-shared` trace/detail components on
  `/dashboard/workflows/[runId]`. This gives operators stable debug URLs and
  avoids cramming index and detail behavior into one bespoke page.
- **Avoid styling forks.** Prefer the library's default component styling or
  documented theming hooks. Do not copy private CSS or rebuild subcomponents.
- **Treat observability as separate.** The Workflow SDK Web UI remains useful
  for debugging, but this admin feature should not be planned around hosting or
  linking to it.

## Open Questions

### Resolve Before Implementation

- Version alignment: use `@workflow/web-shared@4.1.5` (latest stable on npm as
  of 2026-05-05) or pin an older `4.1.x` if `@workflow/core` /
  `@workflow/world` transitive versions need to stay closer to admin's current
  `workflow@4.2.2` and `@workflow/world-postgres@4.1.1`.
- Data operations: decide which callbacks to support in v1:
  `onLoadEventData`, pagination, `onResolveHook`, `onWakeUpSleep`,
  `onCancelRun`, `onStreamClick`, and decryption.

### Deferred To Implementation

- Whether `loadWorkflowsData()` becomes a compatibility adapter or is deleted.
- How much of the run index should remain custom. Keep it intentionally
  lightweight: enough to find and open a run, not a full replacement for the
  embedded detail UI.
- Whether `@workflow/web-shared/styles.css` can be imported in
  `apps/admin/src/app/globals.css` or needs a narrower route-level import.
- Whether `WorkflowTraceViewer` must be rendered through a client wrapper due to
  browser-only dependencies and interactive callbacks.
- Exact visual fit inside the admin shell after the first embedded spike.

## Implementation Units

- [x] **Unit 1: Install And Spike `@workflow/web-shared`**

**Goal:** Add the embeddable UI package and prove its components can render
inside the admin Next.js app.

**Files:**

- Modify: `apps/admin/package.json`
- Possibly create: `apps/admin/src/app/dashboard/workflows/library-workflows-ui.tsx`
- Test: `apps/admin/src/app/dashboard/dashboard-ui.test.tsx`

**Test Scenarios:**

- `@workflow/web-shared` installs cleanly with React 19 and Next.js 16.
- `WorkflowTraceViewer` or the chosen first component renders under
  `/dashboard/workflows` without importing server-only admin modules into the
  client bundle.
- `@workflow/web-shared/styles.css` is loaded through a documented package
  entry point.
- If the component requires browser APIs, the route uses a client wrapper or
  dynamic import without breaking SSR tests.

- [x] **Unit 2: Build The Admin Data/Action Adapter**

**Goal:** Feed `@workflow/web-shared` real admin workflow data through the
smallest stable adapter.

**Files:**

- Modify: `apps/admin/src/app/dashboard/ops-data.ts`
- Modify or create: `apps/admin/src/app/dashboard/workflows/workflow-ui-adapter.ts`
- Modify: `apps/admin/src/services/workflow-runtime.service.ts`
- Possibly create: `apps/admin/src/app/dashboard/workflows/[runId]/page.tsx`
- Test: `apps/admin/src/app/dashboard/workflows/workflow-ui-adapter.test.ts`
- Test: `apps/admin/src/services/workflow-runtime.service.test.ts`

**Test Scenarios:**

- Runtime runs map to the library's expected workflow/run identifiers,
  statuses, timestamps, events, steps, and hooks.
- Forge ledger rows enrich runtime rows without hiding runtime-only rows.
- Missing runtime/world env degrades to an empty or configured-error state the
  embedded UI can render.
- Callback support is explicit: unsupported actions are omitted from component
  props rather than passed as placeholders.
- Invalid or unknown `runId` values return a not-found or empty state without
  leaking raw backend errors.

- [x] **Unit 3: Replace The Custom Workflows Routes**

**Goal:** Remove the bespoke metrics/workers/recent-runs UI from
`/dashboard/workflows`, keep a lightweight run index, and render the embedded
library trace/detail UI on `/dashboard/workflows/[runId]`.

**Files:**

- Modify: `apps/admin/src/app/dashboard/workflows/page.tsx`
- Create: `apps/admin/src/app/dashboard/workflows/[runId]/page.tsx`
- Create: `apps/admin/src/app/dashboard/workflows/workflow-trace-client.tsx`
- Modify: `apps/admin/src/i18n/messages.ts`
- Modify: `apps/admin/src/app/dashboard/dashboard-ui.test.tsx`
- Possibly delete: unused Workflows-only view models in
  `apps/admin/src/app/dashboard/ops-data.ts`

**Test Scenarios:**

- The route requires `requireSession()` before rendering workflow data.
- The page no longer renders Forge-owned queue cards such as `Recent Workflow
Runs` or custom `Workers` sections.
- The index route lists enough real runs to navigate to a run detail route.
- The detail route passes real adapter data/config into `@workflow/web-shared`.
- Run/event/trace detail interactions work through documented
  `@workflow/web-shared` props.
- Navigation still highlights the Workflows item for `/dashboard/workflows` and
  `/dashboard/workflows/[runId]`.

- [x] **Unit 4: Docs And Operational Notes**

**Goal:** Update admin docs to explain that Workflows uses the library's
embedded UI and where Forge-owned trigger actions live.

**Files:**

- Modify: `apps/admin/docs/core-sync-recurring-job.md`
- Modify: `apps/admin/docs/v1-operational-surfaces.md`
- Modify: `apps/admin/docs/cms-operational-vs-deferred.md`
- Possibly modify: `apps/admin/docs/worktree-preview-setup.md`

**Test Scenarios:**

- Docs no longer describe `/dashboard/workflows` as a custom queue-first Forge
  UI.
- Docs identify the embedded library component as the workflows UI surface.
- Docs preserve the distinction between workflow inspection and Forge-owned
  trigger workflows such as Core Sync.

## Sequencing

1. Confirm the exact embeddable UI package/export and install it.
2. Import `@workflow/web-shared/styles.css`.
3. Render `WorkflowTraceViewer` or the chosen first component in a minimal
   admin client wrapper.
4. Map existing runtime/ledger data into `@workflow/world`-compatible component
   props.
5. Replace the custom Workflows page with a lightweight run index.
6. Add `/dashboard/workflows/[runId]` with the embedded trace/detail UI.
7. Delete or retire unused custom view models and tests.
8. Update docs and run focused admin validation.

## Verification

- `pnpm --filter @forge/admin typecheck`
- `pnpm --filter @forge/admin test`
- `pnpm --filter @forge/admin lint`
- Manual smoke: start admin and confirm `/dashboard/workflows` renders the
  authenticated run index.
- Manual smoke: with Workflow Postgres World configured, confirm real runs,
  events, and trace/detail views load at `/dashboard/workflows/[runId]` and
  match runtime data.

## Risks

- **Version drift:** `@workflow/web-shared@4.1.5` pulls newer
  `@workflow/core`/`@workflow/world` dependencies than admin currently uses.
  Mitigation: pin a compatible `4.1.x` version if type/runtime mismatches show
  up during the spike.
- **Client/server boundary:** Workflow UI components may be browser-only.
  Mitigation: isolate them in a client wrapper and keep server data loading in
  the route or adapter.
- **Theming drift:** Overriding library internals would recreate maintenance
  burden. Mitigation: use documented CSS/theming APIs only.
- **Data mismatch:** Admin's ledger model may not exactly match the library
  component contract. Mitigation: keep translation in one tested adapter module.
