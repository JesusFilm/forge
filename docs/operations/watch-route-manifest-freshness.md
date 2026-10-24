# Watch route manifest freshness

PR #2848's local repair bounds negative routing proof to the existing
process-local manifest TTL: **60,000 ms, exclusive**, after a successful 200
retrieval or a conditional 304 for a cached ETag. `generatedAt` describes the
Admin snapshot, not successful retrieval; an unchanged authoritative snapshot
can be revalidated without transferring a new body.

The cache has two independent deadlines. Successful validation renews negative
proof. Every refresh attempt defers the next fetch for 60 seconds to bound
outage load; that retry deadline never renews proof. A failed status, transport
exception, malformed JSON/payload, missing configuration, or out-of-range
language index cannot establish fresh authority. A 304 without a sent cached
validator cannot establish it either. Older payloads missing any of the three
route-language index fields cannot prove hard misses even after a successful
retrieval. This does not prove the Admin snapshot-generation pipeline is healthy.

When proof expires, last-good data still admits known routes under the existing
policy. Negative decisions keep the bounded ordinary or unavailable-language
sentinel and return soft HTTP 200 with `private, no-store, max-age=0` and
`noindex, nofollow`. Fallback admitted routes bypass caching as well, without
marking playable pages noindex. A fresh complete snapshot can still prove a
removed route or a known language gap and answer 404. A new route may remain
inconclusive until the next retry (at most 60 seconds after an unsuccessful
attempt); the retry delay is not permission to answer hard 404 from stale data.

## Offline checks

Run from a checkout with the pinned Node major and frozen dependencies:

```bash
pnpm --filter @forge/web exec vitest run src/proxy-manifest.test.ts src/proxy.test.ts src/lib/watch-route-manifest.test.ts
pnpm --filter @forge/web typecheck
pnpm --filter @forge/web lint
```

The proxy fixture uses real `NextRequest`/`NextResponse`, production routing,
fetch, parser and cache wiring, fake time, and synthetic transport/configuration.
It checks the original seven-day outage, 503/throw/invalid payload, TTL boundary,
new film/new manifest-only language, existing positives, confirmed misses,
language gaps, conditional validation, single-flight retry, and recovery.
No authenticated Admin, provider, database, or production call is necessary.

## Qualification still required before release

The local fixture does not complete the original authenticated live-manifest
smoke. With separate authorization and deployed-equivalent configuration,
confirm redacted version/generatedAt/index presence and status for implicit and
explicit English, non-English, newly published languages outside the corpus,
episodes, nested parents, language gaps and missing routes. Real Next document
and client RSC navigation must preserve the intended status/body/cache behavior.
Do not generate snapshots, trigger a refresh, alter flags, deploy, or disclose
bearers merely to obtain that evidence. Independent review and exact-head CI
remain gates; this runbook grants no release approval.
