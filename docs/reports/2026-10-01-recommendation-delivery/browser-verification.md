# Recommendation delivery browser verification

Verified on 2026-10-01 (Pacific/Auckland), branch `codex/feat-589-recommendation-delivery`, using headless `agent-browser` 0.38.1 against the real Web recommendation component and Route Handler. All four controlled scenarios passed the adapter and player-shell isolation checks. No browser page errors or console warnings/errors occurred.

## Scope and setup

The existing development-only route `/watch/demo-search/recommendation-traffic-fixture?surface=seeded` renders a synthetic player shell and the real `WatchSemanticRecommendations` component. Web ran on `127.0.0.1:3125`; a local GraphQL fixture ran on `127.0.0.1:3136`. The unrelated profile bootstrap endpoint was intercepted with an `essential_only` response. The recommendation delivery endpoint itself was not intercepted. Requests used an ordinary-browser User-Agent header so the real Route Handler retained the request receipt.

The upstream fixture delayed each delivery by 600 ms for empty, Admin-reported timeout, and GraphQL-error scenarios. A separate transport-timeout scenario delayed upstream by 5,000 ms, exercising the existing Web 3,500 ms upstream timeout and three bounded browser attempts. These are deliberately different from Admin's unchanged 1,500 ms complete-service deadline, which requires the separate database/service measurements.

## Results

All times below are milliseconds since navigation unless described as a duration. The application had already compiled; these are development-server samples, not production percentiles.

| Scenario                   | Shell in DOM | Hydrated | First delivery start | First delivery duration | Outcome                                                                                               |
| -------------------------- | -----------: | -------: | -------------------: | ----------------------: | ----------------------------------------------------------------------------------------------------- |
| Empty                      |        210.5 |    759.8 |                795.1 |                   935.9 | HTTP 200; `empty/no_candidates`; original request ID and 0/6 counts retained                          |
| Admin timeout receipt      |        179.5 |    818.8 |                859.6 |                   704.6 | HTTP 200; `unavailable/retrieval_timeout`; original request ID retained                               |
| GraphQL error              |        252.4 |    882.2 |                995.2 |                   707.7 | HTTP 200; `unavailable/delivery_unavailable`; request ID remains unknown/null; three bounded attempts |
| Upstream transport timeout |        231.5 |    755.8 |                838.5 |                 3,567.9 | HTTP 200; `unavailable/delivery_unavailable`; three bounded attempts, each 3,566–3,573 ms             |

The shell existed before every delivery attempt, remained visible after each outcome, and no recommendation cards appeared. The browser's `is visible` check also passed. Across ten upstream calls (including the independent Web Vitals reload and screenshot refresh), every operation was `SemanticRecommendationDelivery`; there were no legacy scene or collection fallback calls. Error retries remained calls to the same authoritative delivery endpoint.

An independent warmed empty-response reload measured TTFB 248.8 ms, FCP/LCP 468 ms, CLS 0, total React hydration 56.6 ms, and recommendation-component hydration 0.4 ms. The measured shell/rendering work finished before the deferred delivery. Initial on-demand development compilation took 19 seconds and is excluded from these warm samples.

[Sanitized measurements](browser-artifacts/measurements.json) contain request paths, status, timing, synthetic request IDs, and bounded outcome summaries. [Empty response](browser-artifacts/empty.png), [timeout](browser-artifacts/timeout.png), and [upstream error](browser-artifacts/upstream-error.png) screenshots show the preserved shell. The [pre-delivery screenshot](browser-artifacts/pending.png) was captured after hydration and before the delivery fetch began. The fixture's existing heading has low contrast; these screenshots establish the retained layout, while DOM visibility and timing establish shell availability.

## Reproduce

From the feature worktree, with ports 3125 and 3136 free:

```sh
printf 'empty\n' > /tmp/feat589-browser-mode
node docs/reports/2026-10-01-recommendation-delivery/browser-artifacts/upstream-fixture.mjs
```

Start Web in another terminal:

```sh
PLAYWRIGHT_TEST=1 \
NEXT_PUBLIC_CANONICAL_ORIGIN=http://127.0.0.1:3125 \
ADMIN_GRAPHQL_URL=http://127.0.0.1:3136/api/graphql \
WEB_ADMIN_API_KEYS=feat589-local-test \
REVALIDATION_SECRET=feat589-local-test \
pnpm --filter @forge/web dev --hostname 127.0.0.1 --port 3125
```

Launch an isolated headless browser, install the harmless profile response, and set a browser User-Agent header:

```sh
agent-browser --session feat589-verification \
  --allowed-domains 127.0.0.1,localhost --restore-save never \
  --init-script "$PWD/docs/reports/2026-10-01-recommendation-delivery/browser-artifacts/timing-init.js" open
agent-browser --session feat589-verification network route '**/watch/api/recommendations/profile' \
  --body '{"profile":{"consentContractVersion":"recommendation-consent-v1","consentChoice":"essential_only","erasureState":"none"}}'
agent-browser --session feat589-verification set headers \
  '{"user-agent":"Mozilla/5.0 Chrome/131.0.0.0 Safari/537.36"}'
agent-browser --session feat589-verification open \
  'http://127.0.0.1:3125/watch/demo-search/recommendation-traffic-fixture?surface=seeded'
agent-browser --session feat589-verification eval 'window.__feat589Timing'
agent-browser --session feat589-verification is visible '[data-testid=player-shell]'
agent-browser --session feat589-verification errors
```

After each result settles, change `/tmp/feat589-browser-mode` to `timeout`, `error`, or `slow` and reload. Allow about 12 seconds for all three transport-timeout attempts. Inspect only the sanitized timing object and the upstream fixture's operation-only log at `/tmp/feat589-browser-upstream.jsonl`. Close the named browser and stop only these two local servers when finished.

## Limits

This proves browser delivery behavior and shell independence in a controlled local fixture. It does not prove actual media startup/playback, real Admin retrieval latency, production rendering percentiles, Chinese card rendering, or a numeric before/after production performance delta. No real media, viewer data, cookies, capability bodies, HARs, or raw traces were retained. Production receipt and player checks remain part of the normal post-merge rollout verification.
