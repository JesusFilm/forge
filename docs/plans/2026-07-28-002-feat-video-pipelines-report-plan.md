---
status: completed
created: "2026-07-28"
origin: "Direct user request via /lfg, no upstream brainstorm doc"
roadmap: "docs/roadmap/platform/feat-322-video-pipelines-coverage-dashboard.md"
---

# feat: Add Video Pipelines Report to Manager Studio

## Summary

Add a new "Video Pipelines" entry to Manager's Studio report switcher
dropdown (`apps/manager/src/features/shell/manager-shell.tsx`) and a new
page at `/dashboard/video-pipelines`, modeled visually and interactionally
on the existing Subtitles coverage report
(`apps/manager/src/features/coverage/coverage-report-client.tsx`) but with
its own lightweight, locally-mocked data model instead of the real
per-language coverage engine.

The page shows one container, **"Devotions - August"** (tag: **Basic**),
with **31 cells** — one per day. Each cell independently tracks whether a
**mobile** (vertical) and a **desktop** (full/web) cut of that day's video
has been generated, shown as two small icons that are light gray when
pending and green when generated. Hovering a cell shows its thumbnail,
title, and date (replacing the description text used elsewhere). Clicking a
cell adds it to the job-order sidebar, same as the reference report, except
the action button reads **"Run Now"** instead of **"Enrich Now"**. The
report has no "AI" stat segment — only Generated / Not Generated.

## Problem

Manager's Studio dashboard currently tracks per-language coverage for
Subtitles, Audio, and Meta only (`ReportType = "subtitles" | "audio" |
"meta"`). There is no operator-facing surface for tracking the development
and status of video _production_ workflows — work that doesn't have a
per-language dimension and instead produces two output aspect ratios per
item (mobile / desktop). The devotional video pipeline tickets
(`docs/roadmap/media-generation/feat-286` through `feat-293`) are the first
concrete example of this shape of work, but nothing in Manager currently
visualizes it.

## Scope

- Add `"video-pipelines"` as a new report type in the Studio shell switcher,
  routed to its own page (not a shell-state toggle on the existing
  `/dashboard/coverage` route).
- Build a new, self-contained mock data model for one container
  ("Devotions - August") with 31 dated cells, each with independent
  mobile/desktop generated flags.
- Reuse the existing visual/interaction language where it fits (collection
  card expand/collapse, hover detail bar, job-order sidebar, action button)
  without importing the language-selection or per-language coverage
  machinery those existing components carry.
- Remove the "AI" stat segment for this report type; keep a two-segment
  Generated / Not Generated split.

### Deferred to Follow-Up Work

- Real dispatch of video generation from "Run Now" (Mastra/worker
  integration). This plan only wires the UI interaction and a stub API
  route that acknowledges the request.
- Any per-language dimension for Video Pipelines.
- Support for more than one container, or authoring/editing containers from
  the UI (adding "Devotions - September", renaming, etc.).
- The flying-selection-to-sidebar animation used in the Subtitles report
  (`SelectedVideoStack` flight animation in `coverage-report-client.tsx`).
- A true calendar (Sun–Sat, weekday-aligned) grid layout for the 31 cells.
- An interactive "Media Type" filter dropdown — v1 ships exactly one tag
  value ("Basic") on the one container, so a dropdown would have nothing to
  filter.

## Assumptions

These are inferred decisions made without a synchronous user checkpoint
(headless `/lfg` invocation) and should be treated as the plan's default
unless corrected:

1. **Aggregate status bucketing.** A cell counts toward "Generated" only
   when _both_ mobile and desktop are generated; anything else (zero or one
   generated) counts as "Not Generated" at the aggregate/stat level. The two
   per-cell icons remain independently accurate regardless of this bucket.
2. **"Media type (tag) - Basic"** refers to the collection tag/pill shown
   next to the container title (matching the existing "Series" / "Standalone"
   pills in the Subtitles report), not an interactive filter control.
3. **Data source.** The 31 cells are locally generated deterministic mock
   data (not `Math.random`), not wired into `src/cms/*`, the mock store, or
   Admin GraphQL. There is no existing backend concept of a "video pipeline"
   item to source real data from yet.
4. **"Run Now" behavior.** Calls a new stub API route
   (`POST /api/video-pipelines/run`) that acknowledges the selected cell ids
   and returns a job-created/failed envelope shaped like the existing
   enrichment response, without dispatching any real work. This proves out
   the full interaction loop (select → sidebar → action → feedback →
   selection cleared) without inventing an undefined generation backend.
5. **Roadmap ownership.** Filed as `feat-322` under `docs/roadmap/platform/`
   with owner `vlad` (matches the owner of the sibling devotional pipeline
   tickets `feat-286`–`feat-293`), since no owner was specified for this
   request.

## Key Technical Decisions

1. **New route, not a shell-state toggle.** Subtitles/Audio/Meta all render
   through `/dashboard/coverage`, switching only `shell.reportType`. Video
   Pipelines gets its own route (`/dashboard/video-pipelines`) per the
   explicit "create a new page" instruction, which also keeps the
   language-selection-heavy `coverage-report-client.tsx` untouched.
2. **Reuse `EnrichActionControls`, not a new sidebar action component.** Its
   visual contract (rocket icon, cancel button, feedback line) is exactly
   what's wanted — only the button copy changes. Add an optional
   `actionLabel` / `submittingLabel` prop pair (defaulting to today's
   "Enrich Now" / "Creating jobs...") rather than forking the component.
3. **A small local 2-segment stat component, not a modified
   `CoverageBar`/`CoverageNumberDiagram`.** Those two components are tightly
   coupled to the `human`/`ai`/`none` `CoverageStatus` union used by the real
   per-language coverage engine. Bending them to support a variable segment
   list risks regressing three existing, actively-used reports for a report
   type whose data doesn't fit that model anyway. A small local
   `PipelineStatDiagram` (two segments: Generated / Not Generated) is
   cheaper and safer.
4. **Local outcome-resolution copy, not `resolveEnrichSelectionOutcome`
   verbatim.** That function's success/failure messages say "enrichment
   job(s)", which is wrong copy for a "Run Now" action. Reuse its
   _selection-preserved-on-partial-failure_ behavior and the shared
   `EnrichFeedback` type/tone contract, but write a small local resolver
   with copy suited to "queued to run" / "failed to run".
5. **No CSS-in-JS / component library change.** Styling follows the existing
   convention of hand-written classes appended to the single
   `apps/manager/src/app/globals.css`.
6. **Test harness convention (must follow):** `vitest.config.ts` runs with
   `environment: "node"` and only includes `src/**/*.test.ts` — there is no
   jsdom, `@testing-library/react` `fireEvent`, or `.test.tsx` file anywhere
   in this app today. Every existing component test either (a) asserts on
   `renderToStaticMarkup(...)` output for a given set of props/state, or (b)
   unit-tests a pure helper function directly. New interactive behavior
   (expand/collapse, cell selection, hover) must be implemented as pure,
   independently-testable helper functions that the component calls, so
   tests can exercise the state transition directly instead of simulating a
   click event.

---

## Implementation Units

### U1. Register "Video Pipelines" in the Studio report switcher

**Goal:** Add the new report type to the dropdown shown in the screenshot,
with correct label/description, and make selecting it navigate to the new
page (while selecting Subtitles/Audio/Meta from that page navigates back to
`/dashboard/coverage`).

**Requirements:** Scope bullet 1.

**Dependencies:** None.

**Files:**

- `apps/manager/src/features/shell/manager-shell.tsx` (edit)
- `apps/manager/src/features/shell/manager-shell-report-switcher.test.ts` (new)
- `apps/manager/src/app/globals.css` (edit — add
  `.design-system-report-icon.is-video-pipelines` color rule next to the
  existing `.is-subtitles` / `.is-audio` / `.is-meta` / `.is-experiences`
  rules around line 7264)

**Approach:**

- Extend `ManagerShellReportType` to `"subtitles" | "audio" | "meta" |
"video-pipelines"`.
- Add an entry to `reportOptions` (label "Video Pipelines", subtitle "Track
  the development and status of video production workflows.", icon `Film`
  from `lucide-react` — add to the existing icon import list).
- Extend `readStoredReportType`'s allow-list check (line ~143) to include
  `"video-pipelines"`.
- Add a small `ROUTE_BY_REPORT_TYPE` map: `subtitles`/`audio`/`meta` →
  `/dashboard/coverage`, `video-pipelines` → `/dashboard/video-pipelines`.
  In `StudioReportSwitcher`'s option `onClick`, call `shell.setReportType`
  as today, then `router.push` to the mapped route for the newly selected
  value (use the `useRouter` already imported at the top of the file — it
  is currently only used inside `StudioUserMenu`).
- The new page (U5) sets `shell.setReportType("video-pipelines")` on mount
  so the switcher shows the right selection when the page is reached
  directly by URL, not just via the switcher click.

**Patterns to follow:** the existing `reportOptions` array shape and
`ReportIcon` rendering; `manager-shell-user-menu.test.ts`'s
`renderToStaticMarkup` + `toContain` assertion style for the new test file.

**Test scenarios:**

- Happy path: `reportOptions` contains a `"video-pipelines"` entry with
  label "Video Pipelines" and the exact description text above.
- Happy path: rendering `StudioReportSwitcher` (via
  `ManagerDashboardShell`) with `reportType: "video-pipelines"` shows "Video
  Pipelines" as the selected workspace button label.
- Integration: selecting the "Video Pipelines" option calls `router.push`
  with `/dashboard/video-pipelines` (mock `next/navigation`'s `useRouter`
  per the pattern in `src/app/login/page.test.ts`).
- Integration: selecting "Subtitles" while the mocked `usePathname` returns
  `/dashboard/video-pipelines` calls `router.push` with
  `/dashboard/coverage`.
- Edge case: `readStoredReportType` returns `"subtitles"` (fallback) for an
  unrecognized stored value, and returns `"video-pipelines"` for a stored
  value of `"video-pipelines"`.

**Verification:** `pnpm --filter @forge/manager test -- manager-shell` passes;
manual check that the dropdown in the screenshot now shows a fourth "Video
Pipelines" row.

---

### U2. Video pipeline mock data model

**Goal:** A small, self-contained module that defines the Video Pipelines
data shapes and builds the "Devotions - August" container with 31
deterministic cells.

**Requirements:** Scope bullet 2; Assumption 1, 3.

**Dependencies:** None.

**Files:**

- `apps/manager/src/features/video-pipelines/video-pipeline-model.ts` (new)
- `apps/manager/src/features/video-pipelines/video-pipeline-model.test.ts` (new)

**Approach:**

- Types: `VideoPipelineCell = { id: string; title: string; date: string
/* YYYY-MM-DD */; thumbnailUrl: string | null; mobileGenerated: boolean;
desktopGenerated: boolean }`; `VideoPipelineAggregateStatus = "generated" |
"none"`; `VideoPipelineCollection = { id: string; title: string; label:
string; labelDisplay: string; cells: VideoPipelineCell[] }`.
- `buildDevotionsAugustCollection(): VideoPipelineCollection` — generates 31
  cells for `2026-08-01`..`2026-08-31`, id `devotion-2026-08-{DD}`, title
  `Devotional — Aug {D}`, a deterministic (not `Math.random`) pattern for
  `mobileGenerated`/`desktopGenerated` that includes at least one fully
  generated day, one fully pending day, and one mobile-only/desktop-only
  ("partial") day, so downstream UI tests have every icon combination to
  assert against.
- `computeAggregateStatus(cell): VideoPipelineAggregateStatus` — per Key
  Technical Decision 1: `"generated"` only when both flags are true, else
  `"none"`.
- `formatCellDate(date: string): string` — human-readable date for the
  hover preview (e.g. "August 3, 2026").

**Test scenarios:**

- Happy path: `buildDevotionsAugustCollection()` returns exactly 31 cells,
  dated `2026-08-01` through `2026-08-31` in order, each with a unique id.
- Happy path: the container's `label`/`labelDisplay` is `"basic"`/`"Basic"`.
- Edge case: `computeAggregateStatus` returns `"generated"` only for
  `{mobileGenerated: true, desktopGenerated: true}`; returns `"none"` for
  `{false, false}`, `{true, false}`, and `{false, true}` (three distinct
  "not both" cases).
- Edge case: the generated fixture set contains at least one cell of each
  of the four `(mobileGenerated, desktopGenerated)` combinations (proves the
  seed data actually exercises every icon-color combination the UI needs).
- Happy path: `formatCellDate("2026-08-03")` renders a human-readable
  string containing "August" and "3".

**Verification:** `pnpm --filter @forge/manager test -- video-pipeline-model`
passes.

---

### U3. `EnrichActionControls` action-label override

**Goal:** Let the job-order sidebar action button read "Run Now" (or any
other label) instead of hard-coding "Enrich Now", without changing existing
callers.

**Requirements:** Scope bullet 3 ("Run Now" instead of "Enrich Now").

**Dependencies:** None.

**Files:**

- `apps/manager/src/features/coverage/enrich-action-controls.tsx` (edit)
- `apps/manager/src/features/coverage/enrich-action-controls.test.ts` (edit)

**Approach:** Add two optional props, `actionLabel` (default `"Enrich
Now"`) and `submittingLabel` (default `"Creating jobs..."`), and use them in
place of the two hard-coded strings on lines 64. No other prop, class name,
or behavior changes — existing callers in `coverage-report-client.tsx` are
unaffected because they don't pass the new props.

**Test scenarios:**

- Happy path: rendering with no `actionLabel`/`submittingLabel` still shows
  "Enrich Now" idle and "Creating jobs..." while `isEnrichSubmitting` is
  true (regression coverage for existing callers).
- Happy path: rendering with `actionLabel="Run Now"` shows "Run Now" when
  idle; rendering with `submittingLabel="Running..."` and
  `isEnrichSubmitting=true` shows "Running...".
- Test expectation for disabled/feedback/cancel behavior: none beyond the
  existing suite — this unit does not change that logic, only the label
  source.

**Verification:** `pnpm --filter @forge/manager test -- enrich-action-controls`
passes, including pre-existing cases.

---

### U4. `POST /api/video-pipelines/run` stub route + outcome resolver

**Goal:** Give the new "Run Now" button something real to call, matching
the shared response envelope shape without dispatching real work.

**Requirements:** Scope bullet 1; Assumption 4; Key Technical Decision 4.

**Dependencies:** None (independent of U1–U3, consumed by U5).

**Files:**

- `apps/manager/src/app/api/video-pipelines/run/route.ts` (new)
- `apps/manager/src/app/api/video-pipelines/run/route.test.ts` (new)
- `apps/manager/src/features/video-pipelines/run-selection.ts` (new)
- `apps/manager/src/features/video-pipelines/run-selection.test.ts` (new)

**Approach:**

- Route: authenticate the same way every other Manager API route does
  (reuse the existing `authenticateRequest` helper used elsewhere in
  `src/app/api/**`); parse body `{ videoIds: string[] }` with Zod (cap at,
  say, 100 ids, mirroring the existing `/api/admin-trigger/*` cap
  convention); respond `200 { created: videoIds.length, failed: 0 }` for
  now (no `jobs`/`errors` — there are no real jobs to link to, so omit
  `jobs` entirely rather than fabricate fake job ids/links).
- `run-selection.ts` exports `resolveRunSelectionOutcome(selectedIds,
response): { nextSelectedIds: Set<string>; feedback: EnrichFeedback |
null }`, mirroring `resolveEnrichSelectionOutcome`'s
  selection-preserved-on-partial-failure rule but with "run" wording (e.g.
  `"${count} video(s) queued to run."` / `"Failed to queue ${count}
video(s) to run: ${details}"`), reusing the `EnrichFeedback` type from
  `@/features/enrich-selection`.

**Test scenarios (route):**

- Happy path: authenticated POST with 1–100 valid ids returns `200` with
  `created` equal to the id count and `failed: 0`.
- Error path: unauthenticated request returns the same 401 shape every
  other Manager API route returns.
- Error path: body failing Zod validation (empty `videoIds`, non-array,
  > 100 ids) returns `400` with validation details, matching the
  > `/api/admin-trigger/*` error-shape convention.

**Test scenarios (resolver):**

- Happy path: an all-success response clears the selection to an empty
  set and returns a success-tone feedback mentioning the count.
- Integration: a partial-failure response keeps only the failed ids in
  `nextSelectedIds` (mirrors `resolveEnrichSelectionOutcome`'s existing
  convention — assert this by name-checking the analogous test case in
  `enrich-selection.test.ts` still holds for the shared expectation).
- Error path: a fully-failed response keeps all ids selected and returns an
  error-tone feedback.

**Verification:**
`pnpm --filter @forge/manager test -- video-pipelines` passes for both new
test files.

---

### U5. Video Pipelines page and client component

**Goal:** The page itself — header, two-segment stat cards, the single
"Devotions - August" collection card (collapsed grid / expanded list),
hover detail bar, cell selection, and the job-order sidebar wired to U3 and
U4.

**Requirements:** All scope bullets; all assumptions; Key Technical
Decisions 1–6.

**Dependencies:** U1, U2, U3, U4.

**Files:**

- `apps/manager/src/app/dashboard/video-pipelines/page.tsx` (new)
- `apps/manager/src/app/dashboard/video-pipelines/loading.tsx` (new)
- `apps/manager/src/features/video-pipelines/video-pipelines-client.tsx` (new)
- `apps/manager/src/features/video-pipelines/video-pipelines-client.test.ts` (new)
- `apps/manager/src/features/video-pipelines/pipeline-stat-diagram.tsx` (new)
- `apps/manager/src/features/video-pipelines/pipeline-stat-diagram.test.ts` (new)
- `apps/manager/src/app/globals.css` (edit — new `.pipeline-*` classes for
  the cell grid, per-aspect icon coloring, and the collection tag pill;
  reuse existing `.collection-card` / `.collection-details` /
  `.collection-tiles` / `.translation-bar.is-detail.is-preview` class names
  where the visual is identical so the new rules only add what's actually
  new)

**Approach:**

- `page.tsx` mirrors `apps/manager/src/app/dashboard/coverage/page.tsx`:
  `export const dynamic = "force-dynamic"`, sets `metadata.title`, renders
  `<VideoPipelinesClient />` with no server-fetched data (U2's builder runs
  client-side; see Assumption 3).
- `loading.tsx` reuses `DashboardRouteSkeleton` with `variant="coverage"`
  (closest existing layout shape — header + stat cards + one collection
  card).
- `VideoPipelinesClient`:
  - On mount, calls `shell?.setReportType("video-pipelines")` (optional
    chaining — the shell context may be absent in tests) per U1's Approach.
  - Renders the page header (label + description from Assumption/Scope),
    `PipelineStatDiagram` fed by `counts = { generated, none }` derived by
    mapping every cell through `computeAggregateStatus` (U2).
  - A `Search` input that filters the 31 cells by title/date substring
    (client-side, no Media Type dropdown per Scope's Deferred list).
  - One collection card for `buildDevotionsAugustCollection()`: title +
    "Basic" tag pill + cell count, an expand/collapse toggle (mirroring
    `CollectionCard`'s `isExpanded` prop and "Show details"/"Hide details"
    button), a collapsed grid of 31 compact cells (each cell: two small
    icon elements — `Smartphone` and `Monitor` from `lucide-react` — with a
    `pipeline-cell-icon--generated` / `pipeline-cell-icon--pending` class
    driven independently by `cell.mobileGenerated` /
    `cell.desktopGenerated`), and an expanded list of the same 31 cells
    grouped by aggregate status ("Generated" / "Not Generated" headings,
    per Key Technical Decision 1) showing date + title + the same two
    icons per row.
  - Expand/collapse state and cell-selection state are both implemented as
    small pure functions (`toggleExpandedId`, `toggleSelectedCellId` — same
    shape as a `Set<string>` toggle) that the component calls from its
    click handlers, per Key Technical Decision 6, so they're directly
    unit-testable.
  - Hovering a cell sets a local `hoveredCell` state and renders the
    existing `.translation-bar.is-detail.is-preview` markup pattern
    populated with `cell.thumbnailUrl`, `cell.title`, and
    `formatCellDate(cell.date)` (Assumption 2 / Key Technical Decision — no
    coverage pills, since there is no verified/AI/none concept here).
  - Clicking a cell toggles it into `selectedCellIds`; when non-empty,
    renders `ManagerShellSidebarSlot` with a simple "N video(s) selected"
    summary and `<EnrichActionControls actionLabel="Run Now"
submittingLabel="Running..." onEnrich={...} ... />`, where `onEnrich`
    POSTs to `/api/video-pipelines/run` and applies
    `resolveRunSelectionOutcome` (U4) to update `selectedCellIds` and the
    feedback message.

**Patterns to follow:** `coverage-report-client.tsx`'s `CollectionCard` for
the expand/collapse markup shape and its `.collection-details` /
`.collection-tiles` class toggling; its hover-detail-bar block (~line 2118)
for the preview bar; `ManagerShellSidebarSlot` usage in the same file for
the job-order sidebar mount point.

**Test scenarios:**

- Happy path: `renderToStaticMarkup` of the collapsed component contains
  "Video Pipelines", the description text, "Devotions - August", the
  "Basic" tag, and "31 video" (count text).
- Happy path: rendering with `isExpanded=true`-equivalent state shows
  `collection-details is-open` and `collection-tiles is-hidden` in the
  markup (mirrors the existing `CollectionCard` toggle assertion style);
  rendering collapsed shows the reverse.
- Happy path: for a cell fixture with `mobileGenerated: true,
desktopGenerated: false`, the rendered markup contains one
  `pipeline-cell-icon--generated` and one `pipeline-cell-icon--pending`
  class for that cell's two icons (proves independence from the aggregate
  bucket).
- Happy path: rendering with a given `hoveredCell` state shows that cell's
  title and formatted date in the detail bar markup; rendering with no
  hovered cell shows the existing empty-state hint text.
- Happy path: rendering with 1+ ids in `selectedCellIds` shows "Run Now" in
  the sidebar markup (not "Enrich Now").
- Edge case: `toggleSelectedCellId` (pure function) removes an id that is
  already present and adds one that is not, matching a standard Set-toggle
  test shape.
- Edge case: rendering with zero cells generated (`counts = {generated: 0,
none: 31}`) shows 0% / 100% in `PipelineStatDiagram`'s output, and no "AI"
  label appears anywhere in the rendered stat markup.
- Integration: the search filter narrows the rendered cell list to titles/
  dates matching the query string (e.g. searching "12" only renders the
  August 12 cell).

**Verification:**
`pnpm --filter @forge/manager test -- video-pipelines` (full feature
directory) and `pnpm --filter @forge/manager typecheck` pass; manual
browser check at `http://localhost:3002/dashboard/video-pipelines` (mock
mode) confirms the visual requirements — hover preview, icon coloring, tag
pill, expand/collapse, and "Run Now" sidebar action.

---

### U6. `PipelineStatDiagram` (2-segment stat component)

**Goal:** The top-of-page Generated / Not Generated percentage cards,
structurally independent from the shared 3-segment `CoverageNumberDiagram`.

**Requirements:** Scope bullet 4 (remove AI segment); Key Technical
Decision 3.

**Dependencies:** None (consumed by U5).

**Files:**

- `apps/manager/src/features/video-pipelines/pipeline-stat-diagram.tsx` (new)
- `apps/manager/src/features/video-pipelines/pipeline-stat-diagram.test.ts` (new)

**Approach:** A small presentational component modeled visually on
`CoverageNumberDiagram` (same `coverage-number-diagram` / `coverage-number-item`
class names for style reuse) but taking `counts: { generated: number; none:
number }` and rendering exactly two segments — no third "ai" entry, no
`ai`-keyed prop anywhere in its type.

**Test scenarios:**

- Happy path: `counts = {generated: 10, none: 21}` renders "32%" /"68%"-style
  percentages (rounded) for Generated / Not Generated and no other segment
  label.
- Edge case: `counts = {generated: 0, none: 0}` renders `0%` for both
  without dividing by zero.
- Test expectation: the rendered markup never contains the string "AI".

**Verification:** `pnpm --filter @forge/manager test -- pipeline-stat-diagram`
passes.

---

## System-Wide Impact

- No changes to the real Subtitles/Audio/Meta coverage engine, its API
  routes, or `src/cms/*` — this feature is additive and isolated to a new
  `src/features/video-pipelines/` directory, one new route file, one new
  page, and small additive edits to `manager-shell.tsx`,
  `enrich-action-controls.tsx`, and `globals.css`.
- `ManagerShellReportType` and its `reportOptions` array grow from 3 to 4
  entries — any other code that exhaustively switches over
  `ManagerShellReportType` (none found in current research) would need a
  new case; verify with a repo-wide search for the type name during
  implementation.

## Risks

- **Low risk overall** — no auth, payments, migrations, or external API
  surfaces touched. The main risk is scope creep into wiring real video
  generation, which Scope Boundaries explicitly defers.
- Adding a fourth `ManagerShellReportType` value could reveal an
  unanticipated exhaustive switch elsewhere in the codebase; the
  implementer should grep for `ManagerShellReportType` after U1 to confirm
  no other file needs a matching case.

## Verification (Overall)

- `pnpm --filter @forge/manager typecheck`
- `pnpm --filter @forge/manager lint`
- `pnpm --filter @forge/manager test`
- Manual browser check (mock mode) of `/dashboard/video-pipelines`: switcher
  entry present and correctly described; page shows "Devotions - August"
  [Basic] with 31 cells; hover shows thumbnail/title/date; cell icons are
  gray/green independently per aspect; clicking cells populates the
  job-order sidebar with a "Run Now" button; no "AI" percentage appears
  anywhere on the page.
