---
id: "feat-444"
title: "Normalize Watch GA4 measurement"
owner: "vlad"
priority: "P1"
status: "in-progress"
start_date: "2026-08-28"
duration: 5
depends_on: []
blocks:
  - "feat-456"
tags:
  - "web"
  - "watch"
  - "analytics"
  - "observability"
---

## Problem

GA4 splits the main JESUS experience between canonical and compatibility URLs.
Across `/watch/`, views/user and engagement are well below the property average,
but current key-event coverage cannot distinguish weak behavior from missing
instrumentation. Linear: FGE-115.

## Entry Points — Read These First

1. `apps/web/src/proxy.ts` — compatibility/canonical navigation behavior.
2. `apps/web/src/components/watch/WatchPageClient.tsx` — client journey orchestration.
3. `apps/web/src/components/watch/HeroPlayer.tsx` — video interaction events.
4. `apps/web/src/components/watch/WatchBody.tsx` — primary actions and page composition.

## Grep These

- `gtag`
- `dataLayer`
- `analytics`
- `page_view`
- `timeupdate`
- `ended`

## What To Build

Define canonical page/event identity, audit page-view and meaningful Watch
events, and produce a PR-ready instrumentation contract for play, progress,
search, language, download, share, and CTA outcomes.

## Constraints

- Preserve raw-path diagnostics while adding canonical dimensions.
- Follow `docs/analytics-and-recommendation-policy.md`: configured analytics require no consent prerequisite. Preserve the GA page views, navigation, Watch events, and Datadog RUM restored in PR #2229 throughout migration and rollback.
- Avoid user/content identifiers that create PII risk.
- Avoid duplicate events during redirects, hydration, and client navigation.

## Verification

- Tests cover event names, parameters, firing rules, and deduplication.
- GA4 DebugView/Realtime validates representative canonical/localized journeys.
- A monitoring query/dashboard reconciles legacy and canonical traffic.

## Progress

- 2026-10-31: Actual poster-first local HLS playback exposed missed first
  `play` events before recorder subscription in both flag modes. The recorder
  now recovers the initial start from native `playing`, or positive unpaused
  progress if both early events were missed. Normal play/resume reporting and
  identity guards remain unchanged; paused seeks and activation intent do not
  synthesize starts. Four StrictMode timing regressions fail before the repair.
  Fresh independent review, repaired-tree browser closure, publication hooks
  and new-head CI remain pending; operator and loading acceptance remain open.
- 2026-10-30: The player recorder now receives the reactive media attachment
  from `WatchPageClient`. Poster-first late mounts and element replacement
  resubscribe listeners without resetting the video/dub guards. StrictMode
  regressions cover deferred attachment, detach, replacement, and identity
  changes in both contract flag states; all four cases fail before the repair.
  Fresh independent review, repaired-head CI, and mounted player acceptance
  remain pending.
- 2026-09-12: U1–U3 landed in
  [PR #2273](https://github.com/JesusFilm/forge/pull/2273) — search-click GA
  leak fixed, route resolver, typed contract, explicit page views behind
  `NEXT_PUBLIC_FORGE_WATCH_GA4_CONTRACT_V2` (default off).
- 2026-10-08: U4 (player), U5 (search, language, subtitle, download, share,
  and study-CTA outcomes), and the U6 read-only reconciliation query
  (`queryWatchMeasurementReconciliation`) implemented behind the same flag.
  v2 SPA page views now take the previous Watch page as referrer.
- 2026-10-30: R4-2646-1 reproduced with injected GA4 responses: U6 rejected
  exact canonical home `/watch` and omitted it from the default report. The
  scoped correction admits home alongside `/watch/` descendants while retaining
  bounded exact operator paths and rejecting lookalike, query, fragment, and
  traversal paths. Legacy `/watch/` and Unicode provider rows remain counted.
  All 28 focused client tests pass, including regressions that fail before the
  correction. Independent review and repaired-head CI remain pending; this does
  not establish live GA4 delivery or complete the broader draft integration.
- 2026-10-30: Local source integration with main `a3a8f879` retains the
  guarded language component preload from #2748, including cancellation when
  download/share/search/navigation supersede it. Typed v2 opens and v1 fallback
  use that same ownership path; language options still load in parallel.
  The `43ca212e` canonical-home helper and tests remain byte-identical. Both
  analytics flag states now exercise the existing component-load regressions,
  including one intent event during repeated pending activation. Source review,
  publication hooks/current-head CI, mounted loading/event validation and
  GA operator acceptance remain separate gates. #2650 is not integrated here;
  its future tag-loading/lifecycle composition still needs validation.
- Remaining, all operator-side: the property export, privacy audit,
  custom-dimension registration, Enhanced Measurement change, DebugView
  journeys, enablement, the 7-day and 28-day readouts, and the key-event
  decision. Runbook: `docs/operations/watch-ga4-measurement.md` sections 3,
  4, and 6. Close this ticket only after the 28-day classification.
