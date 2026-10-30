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

## Conditional validation across invalidation

A conditional response authenticates the snapshot associated with the ETag sent
in that request. Reading mutable global cache state again after awaiting 304
can credit a replacement snapshot with freshness it never earned. Independent
review reproduced this across a webhook cache clear: A's delayed 304 renewed B
and produced hard 404 at B age 60,001 ms in both negative branches.

Capture the cache object as a generation token plus its snapshot and ETag before
fetching. Renew 304 proof only if all remain current. Check generation after
200 JSON completion and before publishing any settled result or retry deadline;
release only the request's own single-flight slot. A clear replaces the cache
object, so old responses cannot mutate a replacement even with the same ETag.
Colocated proxy tests retain this interleaving and the exclusive TTL boundary,
with delayed 200/error and successful current-304 controls. Round-2 source
acceptance remains pending a fresh independent review.

## Actual document status is a renderer contract

A subsequent production `next build` / `next start` reproduction found that both
fresh-negative branches still returned HTTP 200. The proxy-only adapters had
supplied synthetic bodies and observed the rewrite status without executing
Next's renderer. Next 16.3.8's `router-server.js` uses middleware status for
response bodies and redirects, but does not assign it before dispatching a
rewritten App Router page. A loading boundary then streams 200 before the
sentinel's `notFound()` can establish 404.

Keep ordinary pages and their existing loading boundaries in a URL-transparent
route group, outside the fixed hard sentinels. Verified misses call `notFound()`
before streaming. Explicit fixed soft sentinels render the same recovery UI
without throwing for stale/incomplete/unavailable proof. Keep their shared root
layout so client transitions continue through RSC rather than a root-layout
reload. No request-time header read belongs in the static positive layout.

`apps/web/e2e/watch-manifest-document-status.spec.ts` checks actual production
HTTP documents using the synthetic fixture and real TTL expiry. See the runbook
for fixture/config commands. Unit proxy status assertions remain useful for
admission and cache races, but cannot certify final document status.

Soft recovery pages live in the URL-transparent `(recovery)` group with their
own loading boundary, preserving a streamed shell while optional recovery
metadata resolves. Hard sentinels remain outside both loading groups. The
production regression delays recovery GraphQL by 1500ms and checks that headers
arrive before its body completes.

## Cache policy also needs renderer proof

A cold503/no-snapshot request with a compiled public language still admits
fallback content. Its page can resolve to not-found. Next's force-static content
renderer overwrote the proxy no-store header and stored that negative (MISS then
HIT); a manifest-only language instead took bounded recovery and concealed it.

Select an internal force-dynamic renderer for already-admitted content while
authority is inconclusive. Reuse the content page and chrome, preserve subtitle
intent and re-prove the same renderer on internal re-entry. Keep the positive
root and fresh admitted content static. Test compiled and manifest-only language
branches against actual production documents, including repeated requests and
positive fallback content. Route groups also affect Next's sourceRoute hash:
cache diagnostics must follow the actual build owner, including `(content)`.
