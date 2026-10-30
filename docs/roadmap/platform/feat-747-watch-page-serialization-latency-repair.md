---
id: "feat-747"
title: "Reduce Watch page serialization and regeneration contention"
owner: "tataihono"
priority: "P1"
status: "not-started"
start_date: "2026-10-20"
duration: 2
depends_on: ["feat-746"]
blocks: []
tags: [web, watch, performance, infrastructure]
---

## Problem

October 20 delivery note: feat-748 applies and verifies the authorized two-replica
mitigation. That restores observed page latency without establishing the
serialization regression trigger. This deeper application repair remains open;
do not interpret the mitigation PR as completion of the comparison below.

The October 20 investigation reproduced multi-second TTFB for cached Watch
documents. The single Next.js request thread was nearly CPU-bound; a production
profile attributed 43.5% self time to React Flight serialization, with additional
incremental-cache and Redis JSON serialization costs. The specific regression
trigger has not been established.

## Entry Points — Read These First

1. `docs/reports/2026-10-20-watch-production-latency.md` — live evidence and limits.
2. `apps/web/src/app/[locale]/[htmlLang]/page.tsx` — homepage data and client props.
3. `apps/web/src/app/[locale]/[htmlLang]/[...rest]/page.tsx` — detail data and props.
4. `apps/web/src/components/home/WatchHomeExperiencePage.tsx`.
5. `apps/web/src/components/watch/WatchPageClient.tsx`.
6. `apps/web/cache-handler.mjs` and `patches/@fortedigital__nextjs-cache-handler@3.2.1.patch`.
7. `apps/web/scripts/probe-recommendation-runtime.mjs` — bounded local mixed-load pattern.

## Grep These

- `unstable_cache`
- `revalidate: 60`
- `JSON.stringify`
- `audienceEnabled`
- `cacheMaxMemorySize`

## What To Build

Create a repeatable local production-build comparison between active commit
`3003c52046544d83b59f4acbea287ac04504dcf6` and its previous live release, with
identical data, warmed/cold route sets and traffic rates. Identify which rendered
models and cache writes dominate serialization. Fix the measured cause without
dropping content or changing recommendation/player behavior. Measure cached
homepage/detail latency while cold multilingual routes run concurrently.

Separately identify the outbound image hostname behind the October 20
`ETIMEDOUT`/image-optimizer 500s, and split a further ticket if the repair is
independent. Reconcile missing LaunchDarkly flag definitions without suppressing
required observability. Treat the latest audience PR as a comparison candidate,
not an established cause.

## Constraints

- Preserve public routes, language identity, accessibility, rendered content,
  player semantics, GA and Datadog.
- Do not reintroduce ETag hashing, weaken Redis admission safeguards, or remove
  the bounded cache-cleanup patch.
- Never keep request payloads, capabilities, auth material or cache contents in
  retained profiler artifacts.
- Production deploys follow normal PR-to-main flow; no direct deployment,
  rollback, restart, cache flush or scaling without appropriate authorization.

## Verification

- Establish a failing mixed-traffic latency loop before changing implementation.
- Compare matched production builds, exact route/cache state, response bytes,
  first-byte/total time, CPU profiles, and recommendation availability.
- Exercise both cached documents and cold multilingual regeneration.
- Run scope-appropriate Web tests, lint, typecheck, production build and format.
- Verify deployed performance in a fixed window before claiming live recovery.
