---
id: "feat-186"
title: "Watch Datadog Availability Incidents"
owner: "vlad"
priority: "P1"
status: "complete"
start_date: "2026-06-12"
duration: 2
depends_on: []
blocks: []
tags:
  - "platform"
  - "web"
  - "watch-page"
  - "observability"
  - "datadog"
  - "monitoring"
---

## Problem

Watch currently has client-side Datadog RUM, but a server-rendered 500 or
timeout can return an "Internal Server Error" response before the browser app
boots. That class of failure can miss RUM Error Tracking and can go unnoticed
unless someone manually checks the URL. Production Watch needs an
availability-first Datadog incident path that requires both outside-in canary
failure and corroborating production server 5xx/timeout logs.

## Entry Points — Read These First

1. `docs/brainstorms/2026-06-12-watch-datadog-availability-incidents-requirements.md` -
   requirements for the two-signal availability incident flow.
2. `docs/plans/2026-06-11-005-feat-web-watch-datadog-rum-plan.md` -
   completed client-side RUM plan; this work extends observability beyond RUM.
3. `docs/plans/2026-06-12-004-feat-watch-datadog-availability-incidents-plan.md` -
   implementation plan for the two-signal availability incident slice.
4. `docs/operations/watch-datadog-availability-incidents.md` - Datadog
   Synthetics, log monitor, composite monitor, and incident workflow setup.
5. `docs/solutions/runtime-errors/railway-logsv2-silences-nextjs-stdout-runtime-20260518.md` -
   logging format constraint for production-visible server breadcrumbs.
6. `apps/web/src/lib/watch-route-manifest.ts` and
   `apps/web/src/lib/watch-seo-manifest.ts` - current Watch manifest fetch
   failure logs and timeout behavior.
7. `apps/web/src/app/[locale]/[htmlLang]/[...rest]/page.tsx` - server-rendered
   Watch route branches where resolver failures can return 500 before RUM.

## Grep These

- `rg -n "JSON\\.stringify\\(|console\\.(warn|error|log)" apps/web/src`
- `rg -n "Datadog|datadog|RUM|rum" apps/web docs`
- `rg -n "watch_route_manifest|watch_seo_manifest|timeout|ApolloError" apps/web/src`
- Datadog monitor search: `title:Watch OR tag:"service:watch"`
- Datadog log search: `service:watch status:error @statusCode:[500 TO 599]`

## What To Build

1. Normalize Watch server-side failure breadcrumbs into production-visible
   `[watch] event=... key=value` log lines where v1 incident corroboration
   needs them.
2. Preserve the existing client RUM behavior; do not make RUM the v1 incident
   trigger.
3. Define a small production Watch canary set that checks public URLs, not an
   internal health endpoint.
4. Configure Datadog monitor coverage for repeated canary failure, production
   Watch 5xx/timeout logs, and a composite incident gate that requires both.
5. Route the confirmed condition into the Datadog incident/workflow path with
   tags that automation can use.
6. Document the exact Datadog queries, canary URLs, and verification steps so
   future operators can audit or recreate the setup.

## Constraints

- Production only; staging, previews, and local development must not create
  incidents.
- Avoid broad route crawling, dashboards, and root-cause timelines in v1.
- Do not add request-time dynamic APIs to the static Watch route tree.
- Do not rely on JSON-shaped server logs for Datadog/Railway corroboration.
- Do not treat a canary-only failure or a server-log-only failure as enough to
  create an incident.

## Verification

- Run focused tests:
  `pnpm --filter @forge/web test -- src/lib/watch-observability.test.ts src/lib/watch-route-manifest.test.ts src/lib/watch-seo-manifest.test.ts 'src/app/[locale]/[htmlLang]/[...rest]/__tests__/page-routing.test.tsx'`
- Run PR-sensitive Web checks: `pnpm --filter @forge/web typecheck` and
  `pnpm --filter @forge/web lint`.
- Live-check canary URLs with `curl -sS -L -o /dev/null -w '%{http_code} %{url_effective}\n' <url>`
  for the home English, Gospel of John English, Jesus English, and LUMO John
  episode English URLs in `docs/operations/watch-datadog-availability-incidents.md`.
- In Datadog Logs Explorer, validate the production host filter:
  `service:watch @url_host:"1ee8fdb1-3cb5-40fd-9258-35d589917b4a.jesusfilm.org" @statusCode:[500 TO 599]`.
- In Datadog Logs Explorer, validate the shared breadcrumb query:
  `service:watch "[watch]" ("event=watch_route_manifest.fetch" OR "event=watch_seo_manifest.fetch")`.
- In Datadog Synthetics/Monitors, verify the composite gate behavior from the
  runbook matrix: canary-only stays OK, log-only stays OK, mismatched route
  pairs stay OK, and matched canary-plus-route or canary-plus-shared-substrate
  alerts create or update a Watch availability incident.
- Run a Helium/agent-browser smoke against a representative local Watch route
  after starting the Web app.
