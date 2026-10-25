# Admin CMS Outstanding Work

This write-up captures what is still missing on `feat/admin-cms-expansion-loop`
after the v1 hardening pass and the first auth/access fixes. It is intended to
answer a simple question: what still prevents `apps/admin` from feeling like a
real CMS instead of an operational shell?

## Current Baseline

- The admin app has a working login flow, Better Auth-backed users/sessions, and
  a real Postgres-backed dashboard shell.
- The main dashboard routes are live and no longer render generic stub pages.
- `/dashboard/experiences` supports listing experiences and creating a new
  draft shell.
- The GraphQL/service layer already contains meaningful experience/video/search
  behavior, including publish logic and ABAC checks.
- `VIEWER` access to the dashboard is now blocked at the layout boundary, and
  redirected users see a concrete login error message.

## What Is Still Outstanding

### 1. No Real Experience Editor Yet

This is the largest product gap.

- There is no route for an individual experience editor such as
  `/dashboard/experiences/[id]`.
- Editors cannot open a draft and edit title, slug, blocks, locale content, or
  publish state from the admin UI.
- The current experiences page is still an index/create surface, not an editing
  workflow.
- Backend capability exists in services/GraphQL, but the admin UI does not yet
  expose it as a usable editorial tool.

Impact:

- The admin app cannot yet replace the day-to-day authoring flow expected from a
  CMS.

## 2. Revision History Is Not Surfaced

The schema and service direction support editorial history, but the UI does not
yet expose it.

- No revision timeline or draft-vs-canonical comparison view.
- No visible publish audit trail for experiences/locales.
- No operator-facing workflow for reviewing or restoring prior revisions.

Impact:

- Editors cannot safely understand what changed, who changed it, or recover from
  a bad publish within the admin UI.

## 3. Route-Level Capability Segmentation Needs More Hardening

The global dashboard gate now blocks `VIEWER`, but the route model still needs
more intentional shaping.

- Navigation is not role-filtered; the shell assumes a single operator-facing
  menu.
- Sensitive pages such as settings/users/system surfaces should be explicitly
  modeled as editor-only or admin-only, not just inherited through current
  assumptions.
- The app now has the correct "who gets in" rule, but still needs the correct
  "which authenticated roles see which surfaces" rule.

Impact:

- Authorization is safer than before, but the operator experience is not yet
  cleanly segmented by role.

## 4. Several Admin Surfaces Are Read-Heavy, Not Workflow-Heavy

The v1 hardening pass made routes operational, but many of them are still
observability pages rather than full CMS workflows.

- `/dashboard/users` shows real data but is not yet a real user-management tool.
- `/dashboard/settings` shows posture/configuration but does not yet provide
  controlled admin actions.
- `/dashboard/media` is informational; it is not yet a media library workflow.
- `/dashboard/system-status` and `/dashboard/workflows` provide visibility, but
  they are not yet deep operator consoles.

Impact:

- The app is useful for awareness, but several routes still stop short of the
  actions an operator expects to take from them.

## 5. Embeddings and Search Need Editorial Ergonomics

The data plumbing exists, but the UX is still low-level.

- Embedding controls are exposed, but the operator affordances are still basic.
- Search works as a diagnostic/query console, not yet as an editor-friendly
  discovery tool tied directly into content editing.
- There is no clear editorial handoff from "I found the record" to "I am now
  editing the record".

Impact:

- Useful for technical operators; not yet smooth for everyday editorial work.

## 6. Video Editing Is Not Yet a Complete CMS Flow

Video data is available in the admin app, but the editing surface is not yet at
feature parity with what a CMS replacement needs.

- Canonical video editing remains restricted and sparse in the admin UI.
- Locale-specific editorial flows are not yet presented as a cohesive operator
  workflow.
- There is no evident media/programming-style editing experience that feels
  complete from the admin shell alone.

Impact:

- The admin app can inspect and expose video data, but not yet own the full
  editorial lifecycle for it.

## 7. Documentation Still Needs a True "Operational vs Deferred" Map

The branch has improved documentation, but one gap remains: a compact map of
what is actually complete versus what only exists in services or plans.

- Current docs explain architecture and v1 operational surfaces.
- What is still needed is a concise matrix of:
  - operational now
  - backend exists but UI missing
  - intentionally deferred
  - requires follow-up ticket

Impact:

- Without this map, it is still too easy to confuse "implemented in code
  somewhere" with "usable in the admin product".

## Priority Order

If the goal is to make the new CMS genuinely usable, the next sequence should
be:

1. Build the real experience editor flow.
2. Surface revision history and publish ergonomics.
3. Tighten role-segmented navigation and route gating.
4. Turn read-only admin surfaces into action-capable operator tools.
5. Improve search/media/video workflows so they chain into editing naturally.

## Suggested Follow-Up Ticket Shape

The cleanest decomposition from here is likely:

1. Experience editor UI + locale editing.
2. Revision history and publish review surfaces.
3. Admin role segmentation and nav pruning.
4. User/settings/media operator actions.
5. Video editorial workflow expansion.

## Bottom Line

The admin app is now a real operational admin shell, but it is not yet a full
CMS because the main editorial workflow, editing an experience through to
publish, is still missing from the UI. That is the next defining milestone for
this branch.
