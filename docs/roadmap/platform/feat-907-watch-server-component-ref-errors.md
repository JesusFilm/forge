---
id: "feat-907"
title: "Localize Watch server-component ref rendering errors"
owner: "nisal"
priority: "P2"
status: "not-started"
start_date: "2026-10-30"
duration: 2
depends_on: []
blocks: []
tags: [web, watch, reliability, observability]
---

## Problem

During feat-905's production verification, Web application logs recorded
`Refs cannot be used in Server Components, nor passed to Client Components.`
with digest `2382937951`. The October 30 00:17:14–00:19:44 UTC error-filtered
sample reached its 200-line cap and contained ten such messages, so ten is a
lower bound. The saved frames lack the route and useful component stack.
These are genuine rendering errors even though the aligned HTTP 5xx query
returned zero. Their affected route, user impact and cause remain unknown.

Web still ran `c2f0a0e52a58b62a848617fd773ba7d228bdcde6`; the schema cleanup
changed Admin. That does not rule out a data-triggered or earlier Web defect.
Targeted pre-U2 and pre-U1 windows returned no matching messages; do not call
the error proved preexisting or caused by schema removal. No existing matching
roadmap ticket was found. This investigation is separate from the accepted
physical profile/co-watch cleanup and from ordinary expiry's transaction errors.

## Entry Points — Read These First

1. `docs/reports/2026-10-30-retired-behavioral-schema-removal.md`: bounded
   deployment, serving and error observations, with their limits.
2. `apps/web/src/app/[locale]/[htmlLang]/page.tsx` and
   `apps/web/src/app/[locale]/[htmlLang]/[...rest]/page.tsx`: candidate Watch
   route entry points, not yet localized fault sites.
3. `apps/web/src/app/[locale]/[htmlLang]/error.tsx` and
   `apps/web/src/app/[locale]/[htmlLang]/[...rest]/error.tsx`: route error
   boundaries; preserve error visibility and recovery behavior.
4. Private original evidence under
   `/home/nisal/.codex/research/recommendation-schema-removal-905/`:
   `logs-20261030T0020Z/web-app-errors.stdout.raw`, its invocation/result,
   `log-event-comparison-20261030T0022Z/` and
   `log-event-targeted-20261030T0023Z/`. Preserve timestamps, caps and original
   streams; do not replace these observations with later reads.

## Grep These

`2382937951|Refs cannot be used|forwardRef|asChild|ref=|use client`

## What To Build

First localize one observed failure to its route and server/client component
boundary using existing bounded diagnostics. Reproduce that path in an isolated
checkout with the same relevant data shape. Fix only the demonstrated ref
crossing; preserve SSR, streaming, navigation, playback and error recovery.
Do not suppress the message, promote an entire route to a client component,
or change recommendation/database behavior without causal evidence.

## Constraints

- No production fault injection, synthetic business traffic, direct deploy or
  broad repeated log sweep. Preserve private user/request data in diagnostics.
- Distinguish missing LaunchDarkly flag defaults and bounded Admin fact retries
  from this React rendering error; they are different observations.
- HTTP 200 and successful persisted requests do not prove no rendering failure.
  A quiet log window does not prove a fix or establish first occurrence.
- This ticket does not reopen retired profile/co-watch behavior or alter the
  accepted feat-554 daily-cycle gate.

## Verification

Reproduce the identified error before the change and exercise the corrected
route after it, including its server/client boundary and error recovery. Run
scoped Web validation and browser checks with page-loading performance evidence.
Require independent review, green required checks and a normal PR-to-main
release, then bounded actual-route/deployment evidence. Report remaining
unlocalized observations separately rather than claiming global reliability.
