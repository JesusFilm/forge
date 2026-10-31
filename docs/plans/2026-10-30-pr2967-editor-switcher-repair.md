# Repair product switching inside the Shorts editor

Published source: PR #2967 at `18e0698cd6796a870953743f7f754063db123e79`.
Scope: independent coordinator findings R1/R2 against feat-910. The original
public reporter is unknown; these are not attributed to the original user.

## Plan

1. Reproduce actual shell selection with a dirty `EditorSession`, failed/pending
   autosave and unavailable session storage. Reproduce clipping in the real
   `/dashboard/shorts/[id]` editor with its `studio.css` scrollport.
2. Add a lightweight cancellable client-navigation request owned by `src/lib`.
   The editor's existing guard handles it; the shell requests permission before
   changing report/pending state. Keep in-place Report/Jobs switching intact.
3. Lift the menu to the browser top layer while retaining DOM ancestry, theme
   tokens and focus order. Position and clamp it only while open. Preserve the
   sidebar scrollport and avoid new dependencies or closed-menu global work.
4. Verify actual click and combobox Enter through the real editor guard; retain
   falsification evidence. Check real editor layout at 1440 expanded/collapsed,
   820 and 390; keyboard, outside/blur closure and loading/initialization.
5. Run focused tests (two workers), Manager typecheck, scoped lint/format and
   roadmap checks. Review the diff, compound the integration lesson, leave an
   unpublished immutable candidate for the parent's independent review.

## Acceptance boundaries

Cancellation preserves URL, current product/submenu, report context and its
persisted value. Accepted navigation may commit those changes. Storage recovery
does not substitute for cancellation. Native top-layer layout needs real browser
hit-testing; jsdom alone cannot establish clipping or viewport containment.

Local development/mock results do not establish production readiness. Keep
feat-910 in progress while production/runtime/performance acceptance and fresh
independent candidate review remain open. The prior 20-sample performance audit
is separate evidence: +88 ms median cold mobile LCP, +10,578 transferred bytes,
+25 ms custom blocking time; it is not production no-regression proof.

## R3 follow-up: persisted report hydration

Independent review resolved R1/R2 at tree `9702678` and confirmed a separate
P2: SSR defaults to Subtitles while the initial client render reads saved
Audio/Meta, removing the Subtitle Lab link during hydration. The initializer
predates this PR; the product submenu adds the structural manifestation.

Keep the client report state, but expose the deterministic Subtitles snapshot
through hydration before restoring that client value. Use a listener-free
`useSyncExternalStore` hydration boundary; do not overwrite the stored report
while restoring it. Preserve Subtitle Lab's existing Subtitles ownership and
in-place changes when storage is denied.

Validate actual window-absent SSR followed by `hydrateRoot` under StrictMode,
collecting recoverable errors on Jobs and Report. Include stored Audio/Meta,
default/invalid values, denied storage and Subtitle Lab. A matched actual-app
reload/loading check and a fresh independent review of the changed candidate
remain acceptance steps; the earlier browser/load evidence does not execute
this follow-up.

## R4 follow-up: delayed report consumer hydration

The shell can finish hydrating and restore Audio/Meta while a report subtree
behind Suspense remains dehydrated. Its first consumer render must still match
Subtitles SSR markup. Ordinary successful Next reloads do not test that schedule.

Both exported report-context hooks now share a memoized consumer-local hydration
facade. Each consumer keeps the deterministic server report until its own
hydration commits, then sees the current live selection. Setters retain their
identity; no storage reads/writes, listeners or dependencies are added. Coverage
uses this existing hook, avoiding a second report-specific hydration rule.

Add controlled client-only Suspense delay to true window-absent SSR followed by
hydrateRoot under StrictMode. Exercise both hook APIs, saved Audio/Meta, default
and invalid values, Lab forcing, and denied-storage selection during delay.
Require no recoverable errors, correct final report, unchanged restoration
storage and stable setters. Preserve immediate reload/dirty-editor/menu tests.
Actual delayed Next Coverage chunks, fresh source review, relevant loading and
existing authenticated/production/device acceptance remain separate gates.
