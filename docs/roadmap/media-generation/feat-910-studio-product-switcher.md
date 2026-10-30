---
id: "feat-910"
title: "Studio sidebar product switcher"
owner: "vlad"
priority: "P1"
status: "in-progress"
start_date: "2026-10-29"
duration: 1
depends_on: []
blocks: []
tags: [manager, studio, navigation, ui]
---

## Problem

Acceptance reopened on 2026-10-30 for independent coordinator findings R1/R2
at published head `18e0698cd6796a870953743f7f754063db123e79`. The scoped local
repair preserves dirty-editor cancellation for product click/Enter and lifts the
menu out of the editor sidebar scrollport using the browser top layer. See
`docs/plans/2026-10-30-pr2967-editor-switcher-repair.md` and
`docs/solutions/ui-bugs/manager-switcher-editor-navigation-and-top-layer.md`.
The original public reporter remains unknown; these findings are independent
review findings. Historical result entries below describe the original owner's
executions, not acceptance of this repair.

Keep this ticket in progress pending independent candidate review and actual
authenticated runtime/performance acceptance. Prior 20-sample development/mock
measurements found +88ms median cold mobile LCP, +10,578 transferred bytes and
+25ms custom blocking time against requested current-main baseline
`067a1c27b53590db9d384b608e0a352b7847e090`; that is not production no-regression
proof. Git's graph merge-base is `1279e6cfc07f34c59ad9e8a2cae6c64fcf63062a`.
Local editor overflow below 850px retains the existing 720px minimum documented
in feat-869; the product menu must add no further horizontal overflow. A stored
non-default report also needs a real reload/hydration recheck; the historical
"no hydration warning" claim below is not blanket acceptance for that state.

The Manager Studio shell does not name the product it belongs to (Watch) or
show the other planned products. Operators need a global "Switch product"
control. The first approved direction (ideation option 10) put a compact
dropdown / command-palette switcher in the top bar. The revised, approved
placement moves that same trigger to the top of the sidebar, immediately above
the Subtitles / Audio / Meta report selector, and removes it from the top bar.
An earlier attempt that put a product card or nested product menu inside the
sidebar and changed the report selector stays rejected. A later refinement
removes the separate Subtitles / Audio / Meta report selector and makes those
three report contexts the Media entries of the "Switch product" dropdown.
The latest refinement moves the Smart Crop, Shorts, SEO, Alerts and Agents
links out of the primary sidebar navigation into the dropdown as linked route
entries; the primary navigation keeps only Report, Jobs and Subtitle Lab.
The final refinement replaces that static Report / Jobs / Subtitle Lab list:
the navigation directly below the switcher is the selected product's submenu
and changes with the product. Everything else in the shell must stay visually
and behaviorally unchanged.

## Entry Points — Read These First

1. `apps/manager/src/features/shell/manager-shell.tsx` —
   `ManagerDashboardShell` sidebar (`design-system-sidebar-content`), its
   `reportType` / `setReportType` state, the top bar
   (`design-system-topbar-actions`) and `TOPBAR_ICON_BUTTON_CLASS`.
2. `apps/manager/src/features/shell/studio-product-switcher.tsx` — the
   switcher component.
   `apps/manager/src/features/shell/studio-product-submenu.ts` — the
   product-owned submenu model, current-product resolution and
   most-specific active matching.
3. `apps/manager/src/app/globals.css` — `.studio-product-switch*` rules for
   the collapsed rail and the ≤900px / ≤720px sidebar grid areas.
4. `apps/manager/src/features/shell/studio-product-switcher.test.ts` and
   `manager-shell-product-switcher.test.ts` — interaction and placement
   coverage.

## Grep These

- `StudioProductSwitcher`
- `getStudioProductSubmenu`
- `studio-product-switch`
- `design-system-sidebar-content`
- `design-system-topbar-actions`

## What To Build

1. Render one "Switch product" trigger as the first item of
   `design-system-sidebar-content`, directly above the navigation on every
   route. There is no separate report selector and no standalone Shorts
   card. Remove it from
   the top-bar actions. It keeps the existing compact button treatment
   (`TOPBAR_ICON_BUTTON_CLASS`), stretched to the sidebar width.
2. The popover holds a filter input (combobox) and a listbox with exactly this
   grouped catalog, in order: Media (Subtitles, Audio, Meta, Smart Crop,
   Shorts), Marketing (SEO, Campaigns), Support (HS Support Agent, HS User
   Discovery), Operations (Alerts, Agents, Agent Registry, Agent Runs,
   Automations, Evaluations, Monitoring), Analytics/Data (Custom Dashboards,
   Reports, Questions), Website (Website Editor). Each group is a
   `role="group"`
   labelled (`aria-labelledby`) by its visible heading. The popover anchors to
   the trigger's left edge; in the collapsed desktop rail the trigger becomes
   a 36px icon button and the popover opens beside the rail.
3. Subtitles, Audio and Meta are report entries (`kind: "report"`): choosing
   one calls `setReportType` (keeping the session-storage persistence) without
   navigating. Smart Crop (`/dashboard/smart-crop`), Shorts
   (`/dashboard/shorts`), SEO (`/dashboard/seo`), Alerts
   (`/dashboard/alerts`) and Agents (`/dashboard/agents`) are route entries
   (`kind: "route"`) that navigate with the Next client router. Either kind
   closes the popover and returns focus to the trigger. On a route entry's
   page (or sub-page) that entry is current (`aria-selected`); elsewhere the
   entry matching `shell.reportType` is. The other twelve entries have no
   Manager routes yet, so they are present but disabled "Coming Soon" entries
   (see step 5).
4. Search filters entries (by entry or group label) and omits empty groups.
   Keyboard: Arrow keys (wrapping), Home/End and Enter move and select across
   the selectable entries of the flattened, filtered result order. Escape
   closes the popover and returns focus to the trigger. Clicking outside or
   tabbing away also closes it.
5. Every `available: false` entry is a disabled "Coming Soon" entry: it shows
   the exact `Coming Soon` badge (existing `Badge` `outline` variant, class
   `studio-product-switch-coming-soon`), keeps `aria-disabled="true"`, renders
   at `opacity-50` with `cursor-not-allowed`, and is never active or
   selectable. Keyboard movement skips it, hover does not move the active
   descendant or add the highlight, and click/Enter never select it. Search
   still lists matching disabled entries and their group headings; when a
   result holds only disabled entries, `aria-activedescendant` is omitted and
   Arrow/Home/End/Enter do nothing. The eight report and route entries stay
   fully opaque, badge-free and selectable.
6. The navigation directly below the switcher is the selected product's
   submenu (`STUDIO_PRODUCT_SUBMENUS` in `studio-product-submenu.ts`) and
   changes with the selection: Subtitles — Report, Jobs, Subtitle Lab; Audio
   and Meta — Report, Jobs; Smart Crop — Smart Crop; Shorts — Projects, New
   Project, Planning Calendar; SEO — Overview, Runs; Alerts — Alerts; Agents —
   Agents. Only the most specific matching item is active. Coming Soon
   entries own no submenu.

## Constraints

- Do not change report state semantics, breadcrumbs, user menu,
  notifications, theme, polling, or any route. Navigation changes only by
  moving the product links into the dropdown and showing the selected
  product's submenu below it; submenus link only to existing routes. Do not
  add a sidebar product card or nested product menu.
- Do not invent routes, data models, access grants, or backend scope for future
  products.
- Reuse existing Manager `--ds-*` tokens and Lucide icons; no new colors.
- The closed control must add no network request or client initialization
  work beyond rendering a button.

## Verification

- `pnpm --filter @forge/manager exec vitest run src/features/shell`
- `pnpm --filter @forge/manager typecheck`
- ESLint and Prettier on the changed files, plus `git diff --check`.
- Browser check of the sidebar trigger and popover (expanded and collapsed
  rail, light/dark, desktop/mobile), with the closed and open states adding no
  network request.

## Result

- Hydration follow-up (2026-10-30): independent review resolved the editor
  navigation and top-layer repairs, then confirmed stored Audio/Meta causes
  different server/initial-client submenu children. The shell now retains its
  client report state behind a deterministic hydration snapshot, preserving
  saved selection and Subtitle Lab ownership. True SSR-to-`hydrateRoot`
  StrictMode regressions reproduce four failing Audio/Meta cases before the
  change; all 95 focused shell/editor tests pass afterward, including default,
  invalid and denied-storage companions. Matched actual-app reload/loading
  evidence and fresh changed-source review remain pending; earlier local
  browser results do not validate this follow-up. Status stays in progress.

- PR preparation (2026-10-30): renumbered from feat-889, which `main`
  already uses for `topic-experiences/feat-889-tv-streaming-ux-followup.md`.
  Reviewed the full diff. At ≤720px the sidebar
  grid now stacks `brand` / `product` / `nav`, so the switcher sits directly
  above the submenu it controls instead of below it (the ≤900px
  `"brand nav" / "product product"` layout is unchanged). Browser smoke in
  mock mode (Playwright, 1440px light/dark, collapsed rail, 820px, 390px):
  each product shows its exact submenu with the most specific item active
  (Jobs, Shorts/New Project, SEO Overview/Runs, Alerts, Agents, Smart Crop,
  Subtitle Lab); Audio on Jobs stays in place; Meta from Smart Crop and Audio
  from Subtitle Lab land on the report; Coming Soon entries render at 0.5
  opacity, are skipped by End and ignore clicks; Escape returns focus to the
  trigger; the collapsed rail shows a 36px trigger with the popover beside
  it; the 390px popover stays inside the viewport (`scrollWidth` 390);
  opening the popover issues no network request; reloading Jobs with a
  stored Audio report renders the Audio menu with no hydration warning.
  All 49 shell tests, Manager typecheck, ESLint, Prettier and
  `git diff --check` pass.
- Product-specific submenus (2026-10-29): the static `navItems` /
  `getManagerShellNavigation` model is removed. Each selectable product owns
  its submenu in `STUDIO_PRODUCT_SUBMENUS`
  (`studio-product-submenu.ts`), rendered by `ManagerDashboardShell` as the
  `design-system-shell-nav` below the switcher, labelled `<Product> menu`:
  Subtitles — Report (`/dashboard/coverage`), Jobs (`/dashboard/jobs`),
  Subtitle Lab (`/dashboard/subtitle-lab`); Audio and Meta — Report, Jobs;
  Smart Crop — Smart Crop; Shorts — Projects (`/dashboard/shorts`), New
  Project (`/dashboard/shorts/new`), Planning Calendar
  (`/dashboard/shorts/calendar`); SEO — Overview (`/dashboard/seo`), Runs;
  Alerts — Alerts; Agents — Agents. `/dashboard/seo/runs` has no index page
  (only `/dashboard/seo/runs/[runId]` run reports), so Runs links to the
  existing run-history view `/dashboard/seo?view=runs` and is also active on
  run reports. No routes or pages were added. `getStudioCurrentProductKey`
  selects route products from the pathname (root and sub-pages), Subtitles on
  Subtitle Lab (which belongs only to Subtitles; visiting it sets the report
  type to Subtitles) and the persisted `reportType` on Report/Jobs.
  `getActiveStudioSubmenuItemKey` marks only the most specific match (longest
  path, then matched query), so `/dashboard/shorts/new` activates only New
  Project and `/dashboard/seo?view=runs` only Runs; `/dashboard` still
  activates Report. Choosing Subtitles/Audio/Meta updates `reportType` and the
  `forge-coverage-report` session storage; on Report or Jobs (or Subtitle Lab
  for Subtitles) the route stays, otherwise the shell navigates to
  `/dashboard/coverage`. Route products navigate to their roots. A pending
  selection shows the chosen product's submenu immediately (with no active
  item) until the pathname changes. The Jobs queue badge renders only on the
  Jobs item (`badge: "job-queue"`) of report submenus. Coming Soon entries
  cannot be selected and own no submenu. Tests cover exact submenu
  labels/routes/order, Coming Soon without submenus, badge placement,
  most-specific Shorts/SEO matching, current-product resolution, in-place
  report switching on Report/Jobs, redirects from Subtitle Lab and
  route-product pages, immediate submenu changes, root navigation and inert
  Coming Soon clicks. All 50 shell and design tests, Manager typecheck,
  ESLint, Prettier and `git diff --check` pass; visual review relies on the
  dev server's hot reload on port 3002.
- Moved navigation (2026-10-29): the Smart Crop, Shorts, SEO, Alerts and
  Agents links leave `navItems` in `manager-shell.tsx`, so the primary
  navigation (`getManagerShellNavigation`) is exactly Report, Jobs and
  Subtitle Lab. They become route entries in `STUDIO_PRODUCT_GROUPS`: Smart
  Crop (`Crop`) and Shorts (`Clapperboard`) after Meta in Media, SEO
  (`SearchCheck`, previously Coming Soon) in Marketing, and Alerts (`Bell`)
  and Agents (`Bot`) at the top of Operations (Agent Registry's icon becomes
  `Library` so the two do not share `Bot`). `StudioProduct` is now a
  discriminated union on `kind` (`report` | `route` with an `href: Route` |
  `unavailable`); `StudioProductSwitcher` imports neither shell state nor the
  router and calls `onSelect(product)` after closing and restoring focus.
  `ManagerDashboardShell.handleProductSelect` sets the report type for report
  entries and calls `router.push(href)` for route entries, so navigation is
  client-side. `getStudioRouteProductForPathname` marks the route entry
  current on its route and sub-pages (for example `/dashboard/shorts/new`);
  Report, Jobs and Subtitle Lab pages keep following `reportType`. The
  standalone "Shorts / Standalone projects" sidebar card is removed because
  it duplicated the Shorts entry, along with its ≤900px grid-column rule;
  Shorts breadcrumbs and pages are unchanged. Search and keyboard traversal
  walk all eight selectable entries and skip the twelve Coming Soon entries.
  Tests cover the exact three-item primary navigation on several routes, no
  moved link or Shorts card outside the dropdown, exact group placement and
  `href` metadata, opaque badge-free route entries, `router.push` with each
  exact route (report unchanged), current selection for each moved route and
  its sub-pages versus report context on Report/Jobs/Subtitle Lab, report
  switching without navigation, and full and filtered keyboard traversal.
  All 33 shell tests, Manager typecheck, ESLint, Prettier and
  `git diff --check` pass; visual review relies on the dev server's hot
  reload on port 3002.
- Coming Soon semantics (2026-10-29): `studio-product-switcher.tsx` renders
  the `Badge` (`variant="outline"`) with the exact text "Coming Soon" on the
  thirteen `available: false` entries and marks those rows `opacity-50
cursor-not-allowed` (no new tokens; the earlier muted-text overrides are
  dropped so opacity alone dims them). `getSelectableProductIndices` drives
  the active index: open starts on `currentKey`, typing moves to the first
  selectable match (or `-1`), Arrow keys wrap across selectable entries only,
  Home/End jump to the first/last selectable entry, and with no selectable
  match the combobox omits `aria-activedescendant` and Enter is a no-op.
  Disabled rows have no `onMouseMove`/`onClick` handlers, so hover and click
  neither activate nor select them (mousedown still keeps focus in the
  filter). Placement, grouped catalog, report-state integration, focus
  restoration and responsive CSS are unchanged; no routes were added. Tests
  cover exact badges only on unavailable entries, opacity/cursor classes and
  `aria-disabled`, opaque badge-free Media entries, full and filtered keyboard
  skipping (`"a"`, `"ta"`), disabled-only results (`"or"`, `"agent"`,
  `"operations"`, `"data"`) with no active descendant and inert Enter, and
  disabled hover/click. All 25 shell tests, Manager typecheck, ESLint,
  Prettier and `git diff --check` pass; visual review relies on the dev
  server's hot reload on port 3002.
- Consolidated report selector (2026-10-29): `StudioReportSwitcher`,
  `ReportIcon` and `reportOptions` are removed from `manager-shell.tsx`, and
  the Media group is now Subtitles (`Captions`), Audio (`FileAudio2`) and
  Meta (`FileJson2`, replacing Content), all selectable.
  `StudioProductSwitcher` takes `currentKey` and `onSelect`;
  `ManagerDashboardShell` passes `reportType` and `setReportType`, so the
  current mark follows shell state and selection keeps the existing
  `forge-coverage-report` session storage and every `reportType` consumer.
  `StudioProduct` is a discriminated union, so only the three Media keys
  can be `available`. Unavailable entries still ignore Enter/click and
  never call `onSelect`. No routes were added. The Shorts entry is unchanged and
  renders only on Shorts routes. `globals.css` drops every
  `.design-system-report-switch*` and `.design-system-report-icon*` rule and
  the `switcher` grid rows at ≤900px and ≤720px; the Shorts entry auto-places
  on its own full-width row (`grid-column: 1 / -1`), so other routes leave no
  empty row. Tests cover the exact Media entries, all three selectable,
  current-from-`currentKey`, Audio/Meta selection by Enter and click with
  callback and focus return, search ("meta", "media"; "content" now empty),
  the shell switching `reportType` and session storage from the dropdown, the
  absence of any "Current report" selector, and the removed grid rows. All 24
  shell tests, Manager typecheck, ESLint, Prettier and `git diff --check`
  pass; visual review relies on the running dev server's hot reload.
- Operations group (2026-10-29): a sixth group, Operations, sits between
  Support and Analytics/Data and covers the agent-operations lifecycle rather
  than individual agents (the named HS agents stay under Support): Agent
  Registry (`Bot`, configure/manage available agents), Agent Runs (`History`,
  execution history and run state), Automations (`Workflow`, scheduled or
  event-triggered work), Evaluations (`ClipboardCheck`, quality/testing of
  agent behavior) and Monitoring (`Activity`, operational health and
  observability). That makes six groups and sixteen entries; only Subtitles is
  selectable and the five new entries are disabled without badges or routes.
  Search matches the "Operations" group name (returning all five) and each
  entry individually; "agent" now returns HS Support Agent plus Agent Registry
  and Agent Runs, and "au" returns Audio plus Automations. Tests assert the
  exact six-group order, the exact sixteen-entry flattened order, Operations
  group-name and per-entry search, current/disabled semantics, and full and
  filtered keyboard traversal across Support → Operations → Analytics/Data.
  All 20 shell tests, Manager typecheck, ESLint, Prettier and
  `git diff --check` pass; visual review relies on the running dev server's
  hot reload.
- Expanded catalog (2026-10-29): the Users group is renamed Support and gains
  HS User Discovery (`UserSearch`); new Analytics/Data (Custom Dashboards
  `LayoutDashboard`, Reports `FileChartColumn`, Questions
  `MessageCircleQuestion`) and Website (Website Editor `PanelsTopLeft`) groups
  follow. Website Editor sits in its own Website group because the popover is
  grouped. That makes five groups and eleven entries; only Subtitles is
  selectable and the other ten are disabled without badges or routes. Search
  still matches entry or group labels, so "analytics", "data", "support" and
  "website" return their whole groups. Tests now assert the exact five-group,
  eleven-entry order, group-name filtering, current/disabled semantics, and
  full and filtered keyboard traversal over the longer list. All 20 shell
  tests, Manager typecheck, ESLint, Prettier and `git diff --check` pass.
  Visual review relies on the running dev server's hot reload.
- Grouped catalog (2026-10-29): the original Watch / Blog / Language Studios /
  Media Team / Teams list is replaced by `STUDIO_PRODUCT_GROUPS` in
  `studio-product-switcher.tsx` (Media: Subtitles, Audio, Content; Marketing:
  SEO, Campaigns; Users: HS Support Agent). `filterStudioProductGroups` drops
  empty groups and `flattenStudioProductGroups` defines the keyboard order.
  Group headings are visible and name each `role="group"`; they are
  `aria-hidden` so screen readers announce them only as the group name. The
  list scrolls within the popover and keeps the active option in view.
  Subtitles is current; the rest are disabled without badges. Placement,
  trigger, report selector and routes are unchanged.
- Grouped catalog tests: nine jsdom component tests cover group order and
  exact entries, current/disabled semantics, full and filtered keyboard
  traversal (Arrow Up/Down wrap, Home/End, Enter), Subtitles selection by
  Enter and click, Escape focus return, filtering with empty-group omission
  and empty state, and outside-click reset.
- Revised placement (2026-10-29): `StudioProductSwitcher` is the first child
  of `design-system-sidebar-content`, above `StudioReportSwitcher` (or the
  Shorts entry), and the top bar again holds only Notifications and the user
  menu. The trigger reuses `TOPBAR_ICON_BUTTON_CLASS`, made full width with a
  trailing chevron; its popover anchors left below the trigger.
- `globals.css` adds only `.studio-product-switch*` rules: above 900px the
  collapsed rail shows a 36px icon trigger whose popover opens beside the
  rail; at ≤900px and ≤720px the sidebar grid gains a `product` area above the
  report `switcher` area. Report selector, navigation, breadcrumbs, user menu,
  theme, and polling are unchanged.
- At that stage Watch was current and the other four products were disabled;
  the grouped catalog above supersedes that list. Choosing the current entry,
  or pressing Escape, closes the popover and focuses the trigger. Tab and an
  outside click close it. Document listeners exist only while it is open.
- Trap: Manager's unlayered global `.grid { gap: 16px }` rule in
  `apps/manager/src/app/globals.css` overrides Tailwind `gap-*` utilities on
  any element that also uses the `grid` class. The option list uses
  `flex flex-col gap-0.5` for that reason. The same unlayered precedence lets
  the collapsed-rail `.studio-product-switch*` rules override the trigger's
  Tailwind sizing.
- Tests: eight jsdom component tests (under `StrictMode`) cover the product
  list, closed state, current/disabled semantics, keyboard movement,
  selection, Escape focus return, filtering and empty state, and outside-click
  reset. Three shell placement tests assert the trigger is first in the
  sidebar content, precedes the report selector (and the Shorts entry on
  Shorts routes), and is absent from the top-bar actions. All 19 shell tests,
  Manager typecheck, ESLint, Prettier and `git diff --check` pass (Node
  26.12.0 instead of the pinned 24.22.1).
- The original top-bar version was browser-checked in light/dark at 1440px,
  820px and 390px with no extra network requests; the revised sidebar
  placement relies on the running mock dev server's hot reload for visual
  review.

## Delayed-consumer hydration follow-up

Coordinator review R4 found a remaining saved-report mismatch when the report
subtree hydrates after the shell. Both exported shell hooks now retain the
server report snapshot until each consumer hydrates; live state and stable
setters remain authoritative afterward. Controlled Suspense regressions and
scoped checks are required; actual delayed Next Coverage, fresh review, current
CI and the earlier runtime/performance/device acceptance remain open. Ordinary
matched reload success on the previous candidate remains scoped prior evidence.
