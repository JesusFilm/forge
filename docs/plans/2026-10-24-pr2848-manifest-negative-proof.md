---
title: "Bound PR #2848 manifest negative proof"
date: "2026-10-24"
execution: code
---

## Scope and decisions

Implement only the stale-manifest correctness repair in Web, under feat-790.
The original feat-757 number in PR #2848 has no ticket file in this checkout.
The user supplied the accepted problem, constraints, and verification contract;
this is a bounded implementation plan, with local execution and caller-owned
independent review/publication. No agents or external review are permitted.

Keep admission decisions unchanged. Track the successful retrieval deadline
separately from the existing 60-second retry cache deadline. A 200 with a valid
payload or a conditional 304 matching a cached validator establishes retrieval
freshness; an error, malformed response, unavailable configuration, or older
shape cannot establish complete negative proof. The producer's generatedAt is
not retrieval time: unchanged content hashes intentionally support 304.

## Implementation units

1. Add private per-snapshot successful-validation metadata and centralize
   completeness plus age proof in `apps/web/src/lib/watch-route-manifest.ts`.
   Preserve positive stale admission and single-flight/retry behavior. Reject
   out-of-range language indexes as invalid payload rather than false absence.
2. Gate both route and language-gap hard statuses in `apps/web/src/proxy.ts`.
   Apply explicit no-store/noindex on both recovery sentinels. Do not forward
   arbitrary misses to the content renderer or expand the route namespace.
3. Exercise real `proxy()` and real cache/fetch/parser wiring using synthetic
   authenticated fixture configuration only. First run the regressions against
   the exact original implementation to retain discriminating red evidence.
4. Run focused tests and scoped PR checks, compare matched HTTP/loading costs,
   self-review security/reliability, compound the reusable learning, and make
   one local conventional commit with hooks enabled. Retain a separate reviewer
   brief and evidence packet; ticket remains in progress pending acceptance.

## Acceptance and limits

Hard 404 only with fresh complete proof; 60,000 ms is an exclusive deadline.
Failed refreshes must not extend proof, including the original seven-day repro.
New route and manifest-only language recover after successful refresh; old
known routes remain admitted in outage; fresh removed routes remain 404.
Test conditional validation, incomplete payloads, retry request counts, bounded
sentinels, forged rewrite claims, query privacy and configured-origin fetching.

No authenticated live-manifest smoke, browser playback, deployed client RSC
navigation, production performance, remote CI or independent acceptance is
claimed. Offline HTTP wiring and measured proxy costs qualify only this repair.

## Round 2: conditional response ownership

Independent review of `13e892b3241cbd71d5df05d040e535996bcf264a`
requested changes: a delayed conditional 304 for A could renew replacement B
following cache invalidation. Bind each request to its cache object generation,
captured snapshot, and sent ETag. Only the still-current exact snapshot may
receive 304 freshness. Superseded 200 bodies and all settlement paths must also
leave replacement manifest, validator, retry deadline and single-flight state
alone. Current-generation retries and positive admission keep existing behavior.

Colocated real-proxy regressions cover different/same/absent replacement ETags,
both miss branches at B ages 59,999 / 60,000 / 60,001 ms, successful current 304,
delayed errors and 200 bodies, publication recovery, and pending replacement
single-flight state. Preserve round-1 evidence and obtain a new independent
review of the final candidate. feat-790 stays in progress pending acceptance.

## Round 3: actual Next document status

The unchanged published candidate reproduces HTTP 200 for both fresh-negative
documents through Next 16.3.8 production rendering. The router does not carry
a rewrite's status into App Router rendering; the shared loading boundary
flushes before sentinel `notFound()`. Proxy-only adapters cannot verify this.

Keep the shared root layout and all ordinary route loading boundaries. Move
ordinary routes plus their existing loading boundary into a URL-transparent
`(content)` group. Hard sentinels stay outside that group and throw before any
loading shell; two fixed soft-recovery pages render the same UI without throwing.
The proxy selects hard versus soft with the existing proof predicate. Preserve
namespace/admission and cache ownership logic; no new dependency or policy.

Verify discriminating before/after actual production documents, real browser
RSC/DOM commits, real-TTL outage/publication recovery, and matched local document
loading measurements. Add a supported Playwright HTTP regression plus retain
fixture/config commands outside source. Parent assigns independent review; keep
feat-790 in progress and leave the correction committed locally only.

Soft recovery pages live in the URL-transparent `(recovery)` group with their
own loading boundary, preserving a streamed shell while optional recovery
metadata resolves. Hard sentinels remain outside both loading groups. The
production regression delays recovery GraphQL by 1500ms and checks that headers
arrive before its body completes.
