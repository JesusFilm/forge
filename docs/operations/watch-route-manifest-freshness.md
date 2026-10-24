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

## Production document regression

Proxy response assertions cannot establish the final document status. Next 16's
router ignores a rewrite status for renderer dispatch, and `notFound()` below
a loading boundary can only produce a streamed 200. Normal routes therefore
live with their loading shells in `[locale]/[htmlLang]/(content)`. Hard recovery
sentinels live outside that group. The fixed `recover` and
`unavailable/recover` pages render recovery without throwing when proof is
inconclusive. All retain the shared locale root layout for client navigation.

The opt-in Playwright regression uses HTTP documents from a real production
server, not replacement HTML or RSC-looking headers. With pinned dependencies,
start the synthetic fixture from the repository root in one terminal:

```bash
node apps/web/e2e/fixtures/watch-manifest-runtime.mjs
```

In `apps/web`, build and start using the same synthetic configuration (never
point this regression at a live Admin). Supply these environment variables for
both `next build` and `next start --hostname 127.0.0.1 --port 32848`:

```bash
export NODE_ENV=production
export NEXT_TELEMETRY_DISABLED=1
export ADMIN_GRAPHQL_URL=http://127.0.0.1:32849/api/graphql
export WEB_ADMIN_API_KEYS=synthetic-local-fixture-key
export REVALIDATION_SECRET=synthetic-local-revalidation-key
export NEXT_PUBLIC_CANONICAL_ORIGIN=http://127.0.0.1:32848
export NEXT_PUBLIC_ADMIN_GRAPHQL_URL=http://127.0.0.1:32849/api/graphql
export WEB_BASE_URL=http://127.0.0.1:32848
export WATCH_FOR_YOU_ENABLED=false
```

Use a fresh fixture and Next process; do not warm the manifest before the test.
Then, from `apps/web`:

```bash
WATCH_MANIFEST_DOCUMENT_ORIGIN=http://127.0.0.1:32848 \
WATCH_MANIFEST_FIXTURE_ORIGIN=http://127.0.0.1:32849 \
pnpm exec playwright test --config playwright.manifest.config.ts
```

The test requires three real 60-second retry/TTL intervals. It first forces503
with no snapshot and checks first/repeat compiled-English, compiled-Spanish and
manifest-only-Spanish negative documents for private/no-store, no public cache
policy and no Full Route Cache HIT. It also verifies retained compiled-language
fallback content. Do not warm the manifest before starting this test.

Already-admitted content with inconclusive authority uses the internal
`(content)/unconfirmed/[...rest]` force-dynamic renderer. It reuses the ordinary
page, metadata, chrome, loading and error boundaries. Proxy no-store alone cannot
override a force-static renderer. Fresh positives and the root stay static;
negative documents retain noindex while fallback positive metadata is unchanged.

The remaining test uses two real TTL intervals. It verifies fresh ordinary
and language-gap 404 documents, private/no-store/noindex soft recovery after
503 and expiry, retained last-good positives, publication recovery after the
normal retry interval, and fresh 404s after replacement retrieval. It attaches
status/header/byte evidence. The default dev-server suite skips this opt-in
test. Stop the owned fixture and Next processes afterward. Apply the environment's
foreground I/O guard separately to build and test commands when required.

This synthetic curated-Experience fixture does not qualify video playback,
authenticated live manifest, current-main integration, or production loading
performance. Browser client RSC-to-DOM continuity and matched baseline/candidate
loading measurements are separate acceptance evidence.

Soft recovery pages live in the URL-transparent `(recovery)` group with their
own loading boundary, preserving a streamed shell while optional recovery
metadata resolves. Hard sentinels remain outside both loading groups. The
production regression delays recovery GraphQL by 1500ms and checks that headers
arrive before its body completes.
