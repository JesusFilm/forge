---
id: "feat-736"
title: "Investigate Watch QA cross-build cached HTML identity"
owner: "vlad"
priority: "P2"
status: "not-started"
start_date: "2026-10-18"
duration: 2
depends_on: []
blocks: []
tags: [web, infrastructure]
---

## Problem

Local B24 QA briefly served a different build's cached homepage HTML while the
expected server process and disk build remained unchanged. HTTP200 returned
build `7CleSsSLpddT-3kK3bjv9` with `x-nextjs-cache:HIT` and no B24 notice instead
of expected `9ddibi_U7Zni5GaFWawOC`. Three bounded retries also failed the build
gate. Video and Arabic routes retained the expected build; the homepage later
recovered without cache, configuration, server or API intervention. No foreign
document was accepted as B24 test evidence.

The cause is unproven and the observation is local QA only, not a production
reproduction or cache-clearance claim. No cache/private-environment/source fix
is included with B24. Investigate this separately from feat735's hidden footer
and feat428's infinite-feed Data Cache; those do not establish this HTML cause.

## Entry Points — Read These First

1. `apps/web/next.config.mjs`: cache-handler selection and memory-cache settings.
2. `apps/web/cache-handler.mjs`: handler/prefix selection and key behavior.
3. `apps/web/src/proxy.ts`: public Watch routing and response identity context.
4. `docs/roadmap/platform/feat-428-watch-infinite-feed-shared-cache.md`: related
   feed-only scope, not a confirmed explanation for cross-build full HTML.
5. `docs/solutions/conventions/frontend-change-page-load-performance-verification.md`.

## Grep These

`cacheHandler`, `cacheMaxMemorySize`, `NEXT_CACHE_REDIS_PREFIX`, `DEFAULT_PREFIX`,
`BUILD_ID`, `x-nextjs-cache`. These are investigation targets, not confirmed causes.

## Evidence and Runtime Identity

- Source/base `90908a4326901232ec0ff7569744a0e6b7e89e25`; B24 build
  `9ddibi_U7Zni5GaFWawOC`; local listener0.0.0.0:42283.
- PID3334724, `/usr/bin/node`, `next-server (v16.3.8)`, startticks7101578,
  session3334717, socket inode24568260; cwd
  `/home/lado/.t3/worktrees/Forge/t3-e2035974/apps/web`.
- Anonymous Chrome149/agent-browser0.34 QA completed2026-10-17T21:02:46UTC.
  `/tmp/forge-b24-firstfold-browser-20261017/report.md`, `receipt.json`,
  `identity-gate-diagnostic.json`, `home-gate-failed.json`,
  `identity-checkpoint.json` and `identity-after.json` retain failure/recovery.
- The parent accepted only documents that passed expected build/route gates.
  All final tested pages matched B24; homepage timing was excluded during the
  failure. Later functional recovery is not a clean first attempt.

## What To Build

First reproduce and trace response provenance with independent process/disk and
served-document identities. Inspect handler selection, configuration and cache
keys without assuming a namespace collision. Establish whether builds can share
an HTML entry and under which exact local setup before choosing a repair. Keep
build-marker gates in verification so a foreign document cannot become evidence
for the candidate. Preserve the recovered observations even if reproduction fails.

## Constraints

Do not change shared/private caches or environment, flush data, interrupt other
listeners, copy credentials into artifacts, or invent a production diagnosis.
No dependency on feat734/735 is declared; their scoped acceptance is independent.
This ticket requests investigation, not an unverified cache/configuration fix.

## Verification

Use independently identified local builds and exact owned listener identities.
Retain response build markers/cache status alongside process startticks, socket
ownership, disk build and route. Distinguish a controlled reproduction from
warm-cache coincidence, and verify affected and unaffected routes. If a repair
is justified, add meaningful cache-identity regression coverage, retain normal
cache behavior and measure the relevant rendering/load tradeoff. Never accept
foreign-build HTML as candidate browser/performance evidence.
