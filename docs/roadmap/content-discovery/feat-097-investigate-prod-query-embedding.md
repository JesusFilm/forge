---
id: "feat-097"
title: "Investigate Production Query Embedding Degradation"
owner: "nisal"
priority: "P1"
status: "in-progress"
start_date: "2026-04-15"
duration: 2
depends_on: []
blocks: []
tags:
  - "cms"
  - "search"
  - "ai-pipeline"
---

## Resolution

**Diagnosed and operationally fixed:** 2026-04-15. Code-side hardening in flight (this PR).

**Root cause confirmed.** `OPENROUTER_API_KEY` was missing entirely from the Railway `forge-cms` service in the production environment. Verified via the Railway GraphQL API: 38 other variables were set on the service, zero matched `OPENROUTER_*`. The `@forge/manager` service in the same project had the key set correctly, which is why the enrichment pipelines worked while search silently degraded.

**Operational fix.** Set `OPENROUTER_API_KEY` on `forge-cms` (production env) to the same value already present on `@forge/manager` — both services now share a single OpenRouter key (tracked in the `project_cms_openrouter_key` memory; rotation affects both services). Railway auto-redeployed the service in ~62 seconds.

**Verification.** Post-fix behaviour matches the ticket's expectations:

| Query                        | Before fix                                                                                                                     | After fix                                                                                                                                                             |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `feeling alone in suffering` | 0 results                                                                                                                      | 20 results, 18 with scene-level `startSeconds`, top hit at scene startSec=0 on "Reality in a Virtual World - Stewart's Story"                                         |
| `Easter`                     | top-5 scores flat at 0.500 / 0.492 / 0.484 (single-list-fusion signature) with all `startSeconds: null` and `playbackId: null` | 20 results, scores distributed (0.500 / 0.492 / 0.488 / 0.480 / 0.474), populated `playbackId` on ranks 2-6, snippets contain themes, bible verses, and scene content |
| `resurrection`               | top score 0.500, null scene data                                                                                               | 20 results, rank-2 video at `startSec=115` ("3. The Meaning of The Resurrection")                                                                                     |
| `centurion at the cross`     | empty                                                                                                                          | 20 results, top video at `startSec=48` ("Jesus Carries His Cross")                                                                                                    |

The persistence of a `0.500` top score after the fix is expected structurally — with four fusion lists (video-semantic, video-keyword, experience-semantic, experience-keyword) a rank-1 hit in two of the four lists equals `(2/61) / (4/61) = 0.500`. The distinguishing signal for the bug is `startSeconds: null` across every result, which is now gone.

**Code-level hardening (in this PR).** The operational fix is necessary but insufficient: the same failure mode could recur the next time the key is rotated, invalidated, or accidentally unset on redeploy, and nobody would notice for weeks. This PR adds:

1. **Log level warn → error** with a structured `event=query_embedding_failure error_class=... message=...` format, so default Railway log retention captures it and alerts can target it.
2. **Process-local counters** (`attempts`, `failures`, `lastErrorAt`, `lastErrorMessage`, `lastErrorClass`) tracked in `apps/cms/src/api/search/services/search-health.ts` and incremented by the orchestrator around each `embedQuery` call.
3. **`searchMode` response field** (`"hybrid"` or `"keyword-only"`) on both REST and GraphQL, additive and non-breaking. Consumers (apps/web, apps/mobile) can opt in to render a "advanced semantic search temporarily unavailable" banner when the value flips.
4. **`GET /api/search/health` probe endpoint** that runs `embedQuery("health probe")` with a 5-second timeout and returns `{ status: "ok" | "degraded", ... }` plus the counter snapshot. Railway healthchecks and external uptime monitors can poll it at any cadence to detect regressions before users do.

## Problem

Production semantic search is silently degraded — the OpenRouter query-embedding call appears to fail or return non-overlapping results, leaving keyword search as the only contributing retrieval. The orchestrator's graceful-degradation `try/catch` around `embedQuery` swallows the failure, so the API still returns 200s with results. There is no visible 503 or error surfaced to consumers, but **the hybrid search promise is not being delivered**.

This is invisible in CI (tests mock `embedQuery`), invisible to the API contract (results still return), and invisible to monitoring (no error logs unless someone reads them). It only surfaces by inspecting RRF scores, which all carry the unmistakable signature of single-list fusion when 2-list fusion was attempted.

## Evidence

Discovered while validating feat-086 against production on 2026-04-15 (`https://cms.jesusfilm.org/api/search?q=...&locale=en`):

| Query                        | Top score | Has scene-level data? | Notes                                                   |
| ---------------------------- | --------- | --------------------- | ------------------------------------------------------- |
| `Easter`                     | **0.500** | No                    | All 5 results: `startSeconds: null`, `playbackId: null` |
| `forgiveness`                | **0.500** | No                    | Same pattern                                            |
| `Jesus heals`                | **0.500** | No                    | Same pattern                                            |
| `resurrection`               | **0.500** | No                    | Same pattern                                            |
| `centurion at the cross`     | empty     | N/A                   | Should hit scene embeddings; returns nothing            |
| `feeling alone in suffering` | empty     | N/A                   | Pure thematic; returns nothing                          |

The score `0.500` is mathematically the **exact** value for a result ranked #1 in keyword search and absent from semantic search, when 2 lists are passed to RRF:

```
score = (1/(k+1)) / (lists.length / (k+1))
      = (1/61)   / (2/61)
      = 0.500
```

Every "rank-2 score = 0.492", "rank-3 score = 0.484" pattern follows the same formula precisely (`(1/62) / (2/61) = 0.4918`, `(1/63) / (2/61) = 0.4836`).

If semantic search were contributing AND ranked the same items at rank-1, the scores would be `1.000`. They are not.

If semantic search were contributing AND ranked **different** items than keyword, those different items would appear in the top-5 with scores around `0.500` from the semantic side. They do not — top-5 is dominated entirely by keyword hits.

The **empty results** for thematic-only queries (`"feeling alone in suffering"`) are damning: keyword search legitimately returns nothing for that phrase, so the response should be filled by semantic. It isn't, which means semantic returned nothing too.

For comparison, the **same code paths run against a local DB return rich semantic results**. Local `Easter` query (with this PR's changes applied) returned scene-level data: themes (`new life, awe, meaning`), bible verses (`2 Corinthians 5:17, Revelation 21:5`), demographics (`adult, young adult`), spiritual context. Production returns none of this. The code is identical — the difference is the runtime environment.

## Hypotheses (Ranked by Likelihood)

1. **`OPENROUTER_API_KEY` env var missing or invalid in Railway.** The `try/catch` in `apps/cms/src/api/search/services/search.ts:154-166` swallows the failure with `strapi.log.warn(...)`. If Railway's env var is unset, every query embedding call rejects with `OPENROUTER_API_KEY is not set` (per `apps/cms/src/lib/openrouter.ts`). Most likely root cause.
2. **OpenRouter API outage or throttling on the production IP.** Less likely (we'd see intermittent rather than uniform degradation across all queries).
3. **Model deprecation or rename.** `text-embedding-3-small` could have been renamed/removed on OpenRouter.
4. **Network egress blocked from Railway → OpenRouter.** Possible but would manifest as timeouts in logs.
5. **Cold-start cache / instance restart loop** preventing the embedding client from initializing.
6. **Semantic search returning data, but for completely different videos** that never make top-5 because keyword consistently ranks higher. Unlikely given the empty-result thematic queries.

## Entry Points — Read These First

1. `apps/cms/src/api/search/services/search.ts:154-166` — the `try/catch` that hides the failure. Notice it logs `strapi.log.warn` (not `error`), which may be filtered out of production log retention.
2. `apps/cms/src/lib/openrouter.ts` — the `embedQuery` function and its env validation.
3. `apps/cms/src/api/search/services/fusion.ts` — confirm the RRF score math matches the observed evidence.
4. Railway dashboard → `forge-cms` service → Logs tab → search for `[search]` and `Query embedding failed`.
5. Railway dashboard → `forge-cms` service → Variables tab → confirm `OPENROUTER_API_KEY` is present and non-empty.

## Grep These

- `OPENROUTER_API_KEY` in `apps/cms/src/lib/`
- `embedQuery` in `apps/cms/src/`
- `Query embedding failed` in `apps/cms/src/api/search/`
- `[search]` log prefixes (the orchestrator uses these as a namespace)

## What To Build (Investigation Plan)

### Step 1: Confirm the diagnosis from logs

```bash
# Tail Railway logs for the embedding warning
railway logs --service forge-cms | grep -E "(embedding failed|OPENROUTER|\[search\])"
```

If the warning `[search] Query embedding failed, falling back to keyword-only: ...` appears every time a query is made, the hypothesis is confirmed. The error message will indicate the root cause (missing key, network error, HTTP status).

### Step 2: Fix the underlying issue

Most likely path:

```bash
# Verify the env var is set in Railway
railway variables --service forge-cms | grep OPENROUTER

# If missing, set it from Doppler:
railway variables --set OPENROUTER_API_KEY=<value-from-doppler>

# If present, validate the key works against OpenRouter:
curl -X POST https://openrouter.ai/api/v1/embeddings \
  -H "Authorization: Bearer $OPENROUTER_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"input": "test", "model": "text-embedding-3-small"}'
```

### Step 3: Make the failure visible going forward

The current `try/catch` is too quiet. It should still degrade gracefully (don't break the API) but should also:

- Log at `error` level, not `warn`, so it surfaces in default log retention.
- Increment a metric (e.g., `search_query_embedding_failures_total`) so degraded operation triggers alerts before someone notices missing scene data.
- Optionally surface a non-blocking signal in the API response (`degraded: true` flag in the response envelope, or an `X-Search-Mode: keyword-only` header) so consumers can render a banner like "advanced semantic search temporarily unavailable."

### Step 4: Add a synthetic health check

Add a startup or periodic job that runs a single test query embedding and reports failure to operational metrics. Catches the regression before it hits real users.

```ts
// e.g., in apps/cms/src/bootstrap/probe-openrouter.ts
async function probeOpenRouter(strapi: Core.Strapi): Promise<void> {
  try {
    await embedQuery("health-check probe")
    strapi.log.info("[probe] OpenRouter embedding healthy")
  } catch (err) {
    strapi.log.error(`[probe] OpenRouter embedding FAILED: ${err}`)
    // Optionally: emit to InfluxDB / monitoring
  }
}
```

## Constraints

- **Do not break the graceful degradation path.** Search must keep returning 200 with keyword results even when semantic fails. The `try/catch` stays — what changes is the noise level and visibility.
- **Don't add a hard 503 on embedding failure.** That would regress consumer behavior.
- **Don't modify the RRF algorithm.** The math is correct; the input is the problem.
- **No personalization or model swap.** Out of scope.

## Verification

After fix:

```bash
curl 'https://cms.jesusfilm.org/api/search?q=feeling%20alone%20in%20suffering&locale=en' \
  | jq '.results | length'
# Expect: > 0 (semantic returns thematically relevant scenes)

curl 'https://cms.jesusfilm.org/api/search?q=Easter&locale=en' \
  | jq '.results[0]'
# Expect: startSeconds and playbackId are non-null on the top result
# Expect: snippet contains scene-level themes/bible-verses prose

curl 'https://cms.jesusfilm.org/api/search?q=Easter&locale=en' \
  | jq '.results[0].score'
# Expect: ~1.0 if rank-1 in both lists, or ~0.95+ for rank-1 in one and rank-2 in the other.
# Should NOT be exactly 0.500 anymore.
```

Run a few thematic queries and confirm scene-level data appears (`startSeconds`, `playbackId`, themes/bible-verses in snippet).

## Out of Scope

- Replacing OpenRouter with a different embedding provider — that's a separate evaluation.
- Switching embedding model — `text-embedding-3-small` is fine if it works.
- Changing RRF k constant — orthogonal concern.
- Adding personalization signals to ranking (feat-091+).

## Related

- **feat-010** — original semantic search API. The graceful-degradation pattern was intentional but the silence is a known trade-off.
- **feat-086** (PR #777) — adds experiences to search. Will exhibit the same degraded behavior in production until this is fixed (experience semantic also depends on `embedQuery`).
- `docs/solutions/best-practices/hybrid-semantic-search-api-strapi-v5-pgvector.md` — documents the degradation strategy.
