---
module: Manager Studio shell
problem_type: ui_bug
tags: [manager, studio, navigation, unsaved-changes, popover, top-layer]
date: 2026-10-30
---

# Product navigation must integrate with the active editor

PR #2967 replaced product links with listbox options and imperative router
pushes. The editor guarded anchors, unloads and history traversal, so both
option clicks and combobox Enter bypassed its dirty-session warning. Autosave
and best-effort recovery did not provide a Cancel opportunity, particularly
when saves failed and session storage was unavailable.

Use a small cancellable navigation request in `src/lib/client-navigation.ts`.
The active editor handles that request through its existing dirty-state guard.
Request permission before changing the shell's report context, persisted report
or pending submenu. A canceled selection keeps the menu open and retains its
current product. In-place Jobs/Report context changes need no route request.
The shell must not import editor sessions or heavy editor dependencies.

The actual `/dashboard/shorts/[id]` editor also applies `overflow-y:auto` to the
sidebar through `studio.css`. An absolute menu inside it clips horizontally;
increasing z-index cannot escape this scrollport. A native manual popover puts
the menu in the browser top layer while preserving DOM ancestry, scoped theme
tokens, combobox/listbox IDs, blur handling and sequential keyboard order.
Measure and clamp its position only while it is open, and release observers
and scroll/resize listeners when it closes.

Test the integration seam: actual shell click/Enter handlers, real dirty
`EditorSession`, real guard, failed and pending autosave, and storage denial.
All 16 new cases failed on the original published source with zero warning
calls. Mocking the permission helper itself would miss the original bypass.
Native clipping, hit-testing and focus behavior require a real browser using
the actual editor route and CSS; jsdom proves only lifecycle and wiring.

Local development/mock evidence remains separate from authenticated production
acceptance and optimized loading performance. The editor's pre-existing narrow
layout has a 720px minimum at widths below 850px; compare menu-open versus
menu-closed overflow rather than attributing that existing layout to the menu.

Persisted report selection has a separate hydration boundary. A lazy state
initializer reading session storage renders Subtitles on the server and saved
Audio/Meta on the client. Once that preference controls submenu children,
React must regenerate the shell because the Subtitle Lab anchor disappears.
Keep a deterministic server/initial-hydration snapshot, then expose the retained
client value without writing over storage. A listener-free hydration snapshot
boundary avoids adding global storage listeners or a new shared preference
store. Subtitle Lab can still force Subtitles through its existing contract.

Prove this with window-absent `renderToString` followed by real `hydrateRoot`
and a recoverable-error collector, including StrictMode and denied storage.
`createRoot`, static markup rendered while window exists, and matching text
assertions cannot discriminate the original SSR/client mismatch. These tests
verify React hydration behavior; actual Next reload/loading acceptance remains
separate.

A parent hydration flag does not cover a still-dehydrated Suspense descendant.
After the shell restores a saved preference, a delayed report consumer can see
Audio/Meta against its Subtitles SSR HTML. Give the context consumer its own
listener-free hydration snapshot and memoize the facade while retaining setter
identities. Test an unresolved client-only Suspense promise through parent
restoration, then release it and require zero recoverable errors. Keep a choice
made while the child waits, including denied storage; do not reset the provider
or overwrite the saved preference merely to hydrate the child.
