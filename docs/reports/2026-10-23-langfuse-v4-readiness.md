# Langfuse v4 readiness — Forge

Audited October 23, 2026 against `main` at
`2bcf98e19d5052aa1c63abdee036e0e8c9a1d9ca`. This is a repository audit and
local verification record, not certification of the running deployment or
Langfuse project settings. Nothing was deployed, merged, or sent to Langfuse.

## Decision and scope

**Forge does not need an SDK version upgrade for the published v4 cutover.**
The lockfile resolves `@mastra/langfuse@1.5.4` to
`@langfuse/{client,core,otel,tracing}@5.10.0`, above the documented JS minimum
5.4.0. Langfuse Cloud's legacy-feature cutoff is November 16, 2026.
[Vendor upgrade requirements](https://langfuse.com/faq/all/upgrade-to-langfuse-v4).

The installed exporter already identifies itself with JavaScript SDK 5.10.0
headers, which the server accepts for direct ingestion. An absent explicit
version header does **not** establish legacy ingestion. This change makes the
selection explicit with `x-langfuse-ingestion-version: 4`, using the exporter's
supported `additionalHeaders` option. No dependency or lockfile changes are
necessary. [Server routing implementation](https://github.com/langfuse/langfuse/blob/c83198b03f6b63e7d57c0daf016bb4d3ab052913/worker/src/queues/otelIngestionQueue.ts).

Prompt provenance (`promptSource`, `promptName`, `promptLabel`, optional
`promptStale`) and `sendOrigin` now also use Mastra's Langfuse metadata namespace.
The adapter converts these to explicit `langfuse.trace.metadata.*` attributes on
every Seeker-turn observation. Existing generic metadata stays available for consumers.
This makes these dimensions filterable in v4; generic OTel catch-all attributes
are inspectable but not directly filterable. Fallback prompts never receive a
false managed-prompt version link. Separate follow-up generation retains its
existing user/session and trace-name stamps, but does not inherit Seeker-turn
provenance through external parent IDs; provenance filters will exclude those
follow-up observations.
[Custom ingestion semantics](https://langfuse.com/integrations/native/opentelemetry/migration-to-v4).

## Inventory

| Runtime surface                                                     | Current contract                                                                                    | Required action                                                                            |
| ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Mastra Seeker turns and follow-up generation                        | Opt-in `LangfuseExporter`, SDK 5.10.0, OTLP HTTP                                                    | Explicit ingestion header; metadata mapping and real-export regression test in this change |
| Mastra managed Seeker prompt                                        | `GET /api/public/v2/prompts/{name}`, exact version/hash pin, fallback/cache                         | Already supported; preserve pins, labels and fallback behavior                             |
| Chat Apologist comparison prompt                                    | `GET /api/public/v2/prompts/apologist-world-cup-chat`, production label/cache/fallback              | Already supported; no code change                                                          |
| Mastra 25-day retention                                             | `GET /api/public/v2/observations`, cutoff recheck, bounded cursor traversal, trace-ID deduplication | Already supported; operational backlog/visibility limits remain                            |
| Mastra user erasure                                                 | v2 observations filtered by user, local ownership recheck, DELETE batches and requery               | Already supported; verify eventual deletion on synthetic data                              |
| Trace deletion                                                      | `DELETE /api/public/traces`                                                                         | Supported: deprecated trace GET does not deprecate DELETE                                  |
| RAG service and other Forge apps                                    | No direct Langfuse runtime client found in tracked-source audit                                     | No migration found                                                                         |
| Evaluators, dashboards, blob exports, PostHog/Mixpanel integrations | Account-side configuration is not stored in these runtime sources                                   | Owner must inspect Migration Assistant; code audit cannot establish whether these exist    |

The API audit used repository-wide `git grep -i langfuse` and `/api/public/`
searches, manifests and the lockfile. Historical evaluation artifacts and docs
are not active ingestion clients. Forge's own repository-native experiments
are not automatically Langfuse legacy dataset-run API usage.
[Deprecated API map](https://langfuse.com/faq/all/deprecated-api-migration),
[prompt API definition](https://github.com/langfuse/langfuse/blob/c83198b03f6b63e7d57c0daf016bb4d3ab052913/fern/apis/server/definition/prompts.yml).

## Automated verification

`apps/mastra/src/mastra/langfuse-v4-export.test.ts` runs the production config
builder, actual Mastra registry/converter, and installed Langfuse/OTel SDK against
an ephemeral loopback HTTP collector with synthetic keys and content. Both
production batching and development immediate mode are exercised. It checks:

- OTLP endpoint, Basic authentication, SDK minimum and explicit ingestion header.
- Root/generation/tool parentage and exactly one export per completed span.
- Root observation input/output, generation model, token counts and model I/O.
- User/session/environment/trace-name/prompt linkage on every Seeker-turn observation.
- Filterable prompt provenance and send origin on child observations.
- Error status, excluded token chunks and absence of the private routing marker.

Existing tracing, prompt/cache/fallback, environment, Seeker-route, retention and
erasure suites complement this boundary test. Verified locally: **324 test files passed, 3,879 tests passed; 15 files / 45
credentialed or opt-in tests skipped**. Mastra typecheck and lint passed. The
original two-case loopback suite is included in those totals. Independent review
found no blocking runtime/security issues; its documentation wording correction
was applied. Six additional fallback/stale/follow-up wire cases were then
retained: **all eight wire tests**, targeted lint and Mastra typecheck pass.
Repository-wide formatting also passed. Commands (Node 24, per `.nvmrc`):

```bash
pnpm --filter @forge/mastra exec vitest run src/mastra/langfuse-v4-export.test.ts src/mastra/langfuse-tracing.test.ts src/mastra/langfuse-trace-retention.test.ts src/mastra/ai-chat-erasure.test.ts src/services/langfuse-prompt-client.test.ts src/services/seeker-prompt-health.test.ts src/mastra/agents/seeker-route.test.ts src/mastra/agents/seeker-production-config.test.ts src/config/env.test.ts
pnpm --filter @forge/mastra test
pnpm --filter @forge/mastra typecheck
pnpm --filter @forge/mastra lint
```

## Practical verification before a future authorized rollout

1. An organization owner opens Langfuse's Migration Assistant for `forge-mastra`.
   Record any evaluator, API, export or analytics migration flags. Inspect all
   actual Langfuse projects used by deployment variables; source configuration
   alone does not identify the currently deployed credentials or version.
2. Compare the deployed commit/lockfile and Node runtime with this audit. Preserve
   the existing region/base URL, keys, allowed hosts, default-off tracing flag,
   media-upload setting and exact managed-prompt version/hash. No new keys or
   prompt label changes are required by this code change.
3. In an explicitly authorized test environment/project, send synthetic Seeker
   turns: typed input, tool retrieval, video path, follow-up click and follow-up
   generation. Compare streamed answer completion, citations, follow-up chips,
   history persistence and latency against the baseline. Exercise tracing both
   disabled and enabled. Compare multiple runs rather than requiring identical
   nondeterministic model text.
4. In Langfuse, locate the unique synthetic session/user. Check root, generation
   and tool observations, hierarchy, timestamps, I/O, model, token usage/cost,
   prompt name/version and environment. Query observations v2 as well as checking
   the UI. Verify child-level filtering by user/session and the new provenance
   dimensions; check observation counts for missing or duplicate spans. Confirm
   error traces remain visible. Follow-up spans may share the turn trace or use
   the existing sibling-trace fallback, but must retain the same user/session.
5. Test prompt success, cached/stale behavior, missing version/hash mismatch and
   provider outage with synthetic configuration. Confirm reviewed fallback text
   and provenance, no false prompt links, and no failures of chat solely because
   trace export is unavailable. Check the Apologist prompt reader if enabled.
6. Exercise retention and erasure **only against isolated synthetic data**.
   Check paginated discovery, cross-user refusal, cutoff guards, rate-limit
   handling and eventual absence of deleted observations. Do not treat a DELETE
   200 as physical completion: deletion is asynchronous, usually within 15
   minutes. Existing API-history limits can hide older backlog; inspect the
   project's plan and retention separately. Existing deletion is trace-wide,
   even when discovery matches only one observation.
7. Migrate any trace-level evaluators to suitable root observations and legacy
   dataset evaluators to experiments. Confirm variable mappings and execution on
   known synthetic cases. Update any configured exports/integrations to enriched
   observations, then compare dashboard counts/costs/error rates over a matched
   period. These settings cannot be validated by unit tests.

[Deletion behavior](https://langfuse.com/docs/administration/data-deletion),
[Cloud migration checklist](https://langfuse.com/faq/all/upgrade-to-langfuse-v4).

## Limits and publication

Local tests validate the emitted contract and application regressions, not Cloud
indexing, evaluator execution, billing/cost interpretation or a live outage.
No paid model calls, real trace writes, retention deletions or production access
were performed. Account-side actions and live verification remain operator work
after separate rollout authorization.

Read-only Railway inspection on October 23, 2026 confirmed `prDeploys=false`
for Forge and `main`/`stage` as the only configured branch deployment triggers.
Historical GitHub deployment records still contain old PR environments; these
are not the live toggle state. The PR can therefore be opened from this feature
branch without changing shared settings or triggering the inspected deployment
paths. Recheck the toggle immediately before publication. Draft status itself is
not a deployment safeguard. GitHub hook enumeration was unavailable, so this
inspection does not certify undisclosed external webhooks.
