---
title: "Keep negative manifest proof separate from failed-refresh retry expiry"
date: "2026-10-24"
category: "logic-errors"
module: "apps/web Watch routing"
problem_type: "logic_error"
component: "middleware"
symptoms:
  - "A newly published film or language can receive hard 404 throughout a manifest outage."
  - "A seven-day-old last-good snapshot still carries every field checked as proof."
root_cause: "logic_error"
resolution_type: "code_fix"
severity: "medium"
tags: [watch-route, route-manifest, cache-freshness, http-status, availability]
---

## Problem and cause

PR #2848's original proxy used three manifest index fields as proof that a
rejected route no longer existed. The cache retained its last-good snapshot
on 503, malformed payload, or fetch exception, and renewed the cache expiry
on every attempt. That expiry bounded retries, while saying nothing about the
last successful retrieval. Field presence therefore kept proving false absence
indefinitely. Sending no-store cannot correct a false status for crawlers.

## Local repair, pending independent acceptance

`apps/web/src/lib/watch-route-manifest.ts` records successful-validation
freshness privately per snapshot, separately from retry expiry. Negative proof
expires at the existing 60,000 ms TTL, exclusively. Only HTTP 200 with a parsed
payload or conditional 304 for a cached validator renews that proof. The
producer's `generatedAt` does not measure retrieval: unchanged snapshot hashes
support conditional validation. Out-of-range language indexes are invalid;
missing route-language indexes keep older-shaped snapshots inconclusive.

`apps/web/src/proxy.ts` applies the same proof check to ordinary route misses
and known-content language gaps. Expired or incomplete decisions keep their
existing bounded recovery sentinels with soft 200, private/no-store and noindex.
Fresh complete confirmed misses retain hard 404. Existing fallback admission
and positive last-good routes remain admitted, with caching bypassed while
proof is unavailable. No arbitrary miss is newly forwarded to the renderer.

## Verification and prevention

`apps/web/src/proxy-manifest.test.ts` runs the real proxy, fetch, parser and
cache against synthetic configuration, fake time, and stubbed transport. It
covers the original seven-day outage, 503/throw/invalid payload, newly published
films and manifest-only languages, language gaps, retained positives, fresh
removal, exact TTL boundaries, 304, index omissions, and single-flight retry.
The original code fails the newly published route status assertions; the local
candidate passes the focused routing suite. A separate loopback HTTP adapter
compares exact original/candidate proxy status, upstream request counts and
latency; it does not run the Next renderer or prove browser LCP.

When stale data is useful for positives, represent its authority to prove
negatives separately. A retry cooldown must never renew that authority.
Test publication after the cached snapshot through the actual status-producing
caller, rather than only asserting that a cache helper returns old data.

The authenticated live-manifest smoke, deployed client RSC navigation,
independent review and exact-head CI remain unqualified. See
`docs/operations/watch-route-manifest-freshness.md` for that release gate.
