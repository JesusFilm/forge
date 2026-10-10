---
id: "feat-229"
title: "Web production readiness gates"
owner: "urim"
priority: "P0"
status: "in-progress"
start_date: "2026-07-02"
duration: 5
depends_on: []
blocks: []
tags:
  - "platform"
  - "web"
  - "watch-page"
  - "observability"
  - "performance"
---

## Problem

`apps/web` has shipped the main Watch production foundations, but production
readiness is still spread across completed feature tickets, package notes,
operation runbooks, and one pending YouVersion smoke TODO. Before broader
launch, the team needs a single executable readiness gate that proves the
deployed site can build, boot, serve public Watch routes, revalidate content,
emit observability, and tolerate expected feature-flag and third-party
configuration states.

## Entry Points — Read These First

1. `apps/web/CLAUDE.md` — current web deployment, cache, Datadog, feature flag,
   and env-var conventions.
2. `apps/web/package.json` — build, test, probe, and Datadog source-map upload
   scripts.
3. `apps/web/railway.toml` — intended Railway build/start/healthcheck config;
   verify the service's Config-as-code Path honors this file.
4. `apps/web/src/env.ts` — required and optional production environment
   contract.
5. `apps/web/src/app/api/revalidate/route.ts` — token-gated ISR/data-cache
   invalidation receiver.
6. `apps/web/src/lib/watch-url-probe.ts` and
   `apps/web/scripts/probe-watch-urls.ts` — production-vs-preview URL parity
   gate.
7. `docs/operations/watch-datadog-availability-incidents.md` — production
   canary, log, and incident monitor runbook.
8. `todos/006-pending-p1-youversion-app-key-smoke.md` — remaining prod-like
   YouVersion Bible Quotes release smoke.

## Grep These

- `ADMIN_GRAPHQL_URL|WEB_ADMIN_API_KEYS|REVALIDATION_SECRET|DD_AGENT_HOST|NEXT_PUBLIC_DATADOG|YOUVERSION`
- `headers\\(|cookies\\(|draftMode\\(`
- `revalidatePath|revalidateTag|unstable_cache`
- `probe:watch-urls|datadog:sourcemaps|prune:next-isr`
- `console\\.(log|warn|error)|sendDatadogStructuredLog`
- `NEXT_PUBLIC_FORGE_WATCH_PLAYER_MIGRATION|FORGE_WATCH_.*_DEFAULT`

## What To Build

1. Create a production readiness checklist/runbook for `apps/web` that maps
   each launch gate to owner action, command, expected output, and evidence
   location.
2. Validate the local code gate: generated UI locales, full Web tests,
   typecheck, lint, build, and start smoke from the production build.
3. Validate the deployment contract: Railway honors `apps/web/railway.toml`,
   production start preloads Datadog tracer through the service start command,
   healthcheck path is `/watch`, and required env vars are present.
4. Validate public route behavior: core Watch URLs return healthy status,
   preview and production match expected status classes/final paths, canonical
   URLs stay on `www.jesusfilm.org`, and cacheable routes stay free of dynamic
   APIs.
5. Validate freshness: authorized revalidation invalidates both route output and
   data-cache tags for representative `experience`, `video`, and manifest
   payloads.
6. Validate observability: Datadog RUM/APM/log forwarding/source-map upload
   configuration is present, availability monitors are installed, and server
   logs use production-visible plain-string or structured syslog paths.
7. Validate release flags and third-party integrations: LaunchDarkly/default
   flag states are documented, YouVersion prod-like smoke passes before
   relying on Admin-resolved Bible passage text, and optional Algolia/OpenRouter paths fail
   gracefully when unset.

## Constraints

- Do not change the public `/watch` URL shape.
- Do not introduce request-time dynamic APIs into cacheable Watch routes.
- Do not expose server-side secrets through `NEXT_PUBLIC_*` variables or browser
  requests.
- Do not rely on browser RUM alone for availability or canonical product
  analytics.
- Do not treat `apps/web/railway.toml` as authoritative until the live Railway
  service proves `configFile` points at it or the dashboard is documented as the
  source of truth.
- Do not enable gated features in production before their prod-like smoke
  evidence is captured.

## Verification

- `pnpm --filter @forge/web test`
- `pnpm --filter @forge/web typecheck`
- `pnpm --filter @forge/web lint`
- `pnpm --filter @forge/web build`
- Production-build smoke: `cd apps/web && pnpm start`, then `curl -I
http://127.0.0.1:3000/watch`.
- Preview/prod parity: `pnpm --filter @forge/web probe:watch-urls --production
<production-origin> --preview <preview-origin> --json
output/watch-url-parity.json`.
- Revalidation smoke: send authorized representative payloads to
  `/watch/api/revalidate` and confirm the next request renders fresh data.
- Datadog smoke: verify availability monitors, server logs, APM service tags,
  RUM initialization, and uploaded browser source maps for the deployed commit.
- YouVersion smoke: complete
  `todos/006-pending-p1-youversion-app-key-smoke.md` before relying on
  `BibleCitation.passage` for production traffic.
