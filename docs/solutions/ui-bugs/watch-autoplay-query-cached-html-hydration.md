---
module: Watch hero player
date: 2026-09-18
problem_type: ui_bug
component: frontend_stimulus
severity: medium
symptoms:
  - A fresh autoplay arrival emits React 418 with args[]=HTML.
  - The same Watch page hydrates successfully without the autoplay query.
  - A development-server visit does not reproduce the production-build mismatch.
root_cause: logic_error
resolution_type: code_fix
tags: [watch, hydration, autoplay, nextjs, static-cache, react]
---

# Hydrate the cached poster before applying autoplay intent

Watch's catch-all page uses `dynamic = "force-static"`. Its cached HTML renders
without search parameters. `HeroPlayer` previously read `autoplay=1` directly
from `useSearchParams()` for its first browser render: it activated media,
changed the frame layout and inserted a loading overlay that the cached HTML
lacked. React recovered by regenerating that subtree.

An owned production build reproduced HTML-variant React #418 on fresh visits
to `/watch/chosen-witness.html?autoplay=1` and
`/watch/sermon-on-the-mount-2.html?autoplay=1`. The corresponding no-query visits
passed. The same visits through a development server did not reproduce this
mismatch. Production RUM also retained this HTML variant on an autoplay arrival
at a Spanish JESUS episode; the issue group contains other stack variants, so
that group alone does not establish a single cause for every occurrence.

`HeroPlayer` now reads autoplay through `useSyncExternalStore`, with a null
server snapshot matching cached HTML. React uses that snapshot during hydration
and then applies the browser query. Ordinary client renders and subsequent
query changes still use Next's current search parameters. The existing preview
delay, one-shot autoplay, sound choice, media identity and analytics remain.
The existing viewer-ID snapshot subscription is reused without changing its
identity behavior.

The regression renders the query-free hero to HTML, hydrates it with an autoplay
query, and checks React's recoverable errors. Before the correction it captures
the actual extra loading-overlay node and frame differences. Afterward it
verifies no hydration recovery, one unmuted play attempt and automatic playback
attribution. A client-only render test would miss the failure.

Validation passed 4,423 Web tests, the production build/type check, scoped lint
and formatting. Five production-build browser cases passed afterward, including
both affected routes and the Spanish episode, with autoplay media present and
no page errors. Six fresh-browser no-query runs on each build retained early
poster paint; the later video LCP and its limitations belong to feat-515.

This proves the autoplay mismatch, not the cause of every historical HTML
variant or the separate text variant. In particular, the original September 16
recommendation batch did not retain its arrival query, so do not claim an exact
reconstruction of that event. Track HTTP failures, semantic recommendation
fallbacks, selection aborts and JavaScript errors separately after deployment.
