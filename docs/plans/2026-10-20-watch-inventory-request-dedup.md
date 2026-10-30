# Watch inventory request deduplication investigation

Tracking: FGE-293 and feat-750. Owner: Tatai.

## Evidence and scope

A production navigation to the German language inventory at 2026-10-19
23:59:58 UTC took 15.835 seconds (Datadog trace
`6ad6aefe00000000299196839ca33dac`, Web release
`f54a7f1c2fccbf66413f8b7a93ca8b270efa6d70`). The route calls
`resolveWatchLanguageInventory(locale, languageSlug)` from both
`generateMetadata` and the page. The trace contains repeated parallel data-cache
reads and writes, including two 569,630-character inventory writes. It also
contains other latency: the Admin inventory call took about 3.305 seconds, and
several overlapping cache reads took about 4.695 seconds. JSON decoding accounts
for only milliseconds. This does not prove that duplicate work caused the
incident or identify all remaining elapsed time.

An isolated production-mode Next 16.3.8/Turbopack fixture copies the actual route
source and replaces its data, translation and view dependencies with controlled
fixtures. It reproduces two resolver executions without React request
memoization and one with it, with all 1,000 synthetic cards still rendered.
Small-fixture request timings do not establish a material latency improvement.
This validates request sharing in the actual route; full-application load and
production benefit remain unverified.

## Candidate implementation

Use one module-scoped React `cache` wrapper in the server route module and call
it from both metadata and page rendering. Keep the shared inventory module
unchanged because client components import its pure helpers. Preserve persistent
cache keys, tags, TTLs, webhook invalidation, route admission, language identity,
metadata, every rendered card, player behavior, and analytics.

Do not change deployment configuration, replica count, timeouts, or cache
freshness. Do not merge, deploy, or make production changes. Existing mitigation
work in Forge PR 2816 and attribution work in feat-750 remain separate.

## Validation before proposing a repair

1. Exercise the actual route through a production-mode Next fixture with
   controlled inventory data. Show metadata and body share one resolver call,
   different arguments remain separate, and later renders get a new request
   cache. The baseline must fail the one-call expectation.
2. Run the existing inventory route/resolver/component tests and Web type,
   lint, formatting, and relevant build checks. Preserve rendered output.
3. Compare route work and page-loading impact under identical controlled data
   and cold route-cache state. Keep full-application workload verification
   separate; distinguish operation-count reduction from demonstrated latency
   improvement.
4. Prepare a narrowly scoped PR only when the evidence supports the change.
   Keep FGE-293/feat-750 open and report production recovery as pending until
   it is separately verified.

## Current status

The actual route failed the production-mode one-call assertion before the
change (two resolver calls during one static render). A route-local React cache
wrapper now makes that assertion pass; no application change has been deployed.
Production proxy diagnostics from Core PR 9903 are deployed as Worker version
`655796e9-dc9b-4c11-9547-f4939d144d99`. The Watch Checkly run at 13:12:32 NZDT
passed, but this is not proof of sustained recovery or of the candidate repair.

## Verification — 2026-10-20

Baseline: `23029e4c6a7d2e8700ae1b9537c68f15331f7774`.

```sh
node apps/web/scripts/probe-inventory-request-memoization.mjs \
  --baseline-commit=23029e4c6a7d2e8700ae1b9537c68f15331f7774
pnpm --filter @forge/web exec vitest run \
  'src/app/[locale]/[htmlLang]/videos/[languageSlug]/page.test.tsx' \
  src/lib/watch-language-inventory.test.ts \
  src/components/watch-language-inventory --maxWorkers=2
pnpm --filter @forge/web typecheck
pnpm exec eslint --max-warnings=0 \
  'apps/web/src/app/[locale]/[htmlLang]/videos/[languageSlug]/page.tsx' \
  apps/web/scripts/probe-inventory-request-memoization.mjs
```

- The production-mode probe passed against the final source. First static
  render: one resolver call; subsequent route-cache hit: zero new calls.
  Dynamic renders use one call each, including repeated arguments on separate
  requests, different locales and different languages. RSC prefetch renders
  the final card and metadata with one call. A rejected language returns 404
  without resolving inventory. All sampled documents retain the title,
  canonical, footer and 1,000 cards.
- Eight alternating baseline/fixed cold-route pairs consistently use two/one
  resolver calls. Median response-header time was 35.44/34.75 ms; ranges were
  33.60–41.16/33.66–37.84 ms. They overlap. Synthetic bodies were 222,940/222,936
  bytes; fixture URL names differ, so the four-byte difference is not a claimed
  production payload reduction.
- Existing focused tests passed: 130 tests across eight files. Web typecheck
  and scoped ESLint passed. The probe builds the copied route using the
  repository's patched Next dependency; it is not a complete Forge build,
  browser interaction check or production load replay.

The probe is a manual regression command, not part of the existing Vitest CI
job. It needs installed Web dependencies and the baseline commit locally for
the optional comparison; omit that argument to check only the current route.

## Durable findings and remaining work

React request memoization must wrap the shared function once at module scope;
two separately created wrappers would not share their caches. Keep this wrapper
in the server route because the underlying inventory module also exports pure
helpers used by client components. Request memoization and the resolver's
persistent data cache have different lifetimes: this change does not alter
data-cache tags, TTLs or revalidation.

The production trace's overlapping cache spans must not be summed. Large
elapsed cache times with small codec durations do not distinguish scheduling
delay from Redis/network/tag work. The candidate removes duplicate resolver
work but does not address the complete inventory payload or prove the origin
of every slow request. Existing Forge PR 2672 also edits this route's metadata;
preserve the shared wrapper when reconciling that separate change.

After owner review and normal authorized rollout, verify the deployed source
and compare equivalent routes/cache states per replica in Datadog, including
tail latency, cancellations and cache operations. Keep feat-750 and FGE-293
open until the incident's production acceptance criteria are satisfied.
