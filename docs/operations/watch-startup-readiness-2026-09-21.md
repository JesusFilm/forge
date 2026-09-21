# Watch startup readiness investigation — September 21, 2026

## Scope and release state

The local production-build reproduction proves that Admin admits API traffic
while Next is still preloading route entries on the same event loop. The readiness
correction merged in PR #2362 and is running in production. It does not establish the complete cause of the
historical selection HTTP 503s, and feat-496 remains in progress.

Work began in the dedicated `codex/watch-4xx-completion-20260921-k7m` worktree
from freshly fetched main. The startup branch is
`codex/watch-startup-preload-20260921-k7m`. All tests, fixture writes and CPU
captures use owned local processes and labelled PostgreSQL/Redis containers.
No production inspector, callback replacement, fault injection, control-row
changes, manual redeploy or direct local deployment was used.

## Production trigger: distinguish HTTP and semantic failures

The fixed **02:15–03:30 UTC** window contains 877 seeded-delivery requests:
580 HTTP 200 and 297 HTTP 403. All 877 have final delivery envelopes. Two of
the HTTP 200s contain six-card `delivery_timeout` fallbacks:

| Final envelope UTC | Full trace ID                      | Admin GraphQL duration |
| ------------------ | ---------------------------------- | ---------------------: |
| 03:11:09.184       | `6ab0a04a0000000036a4d38a42b7c790` |               1,521 ms |
| 03:11:25.138       | `6ab0a05a0000000013b5b619b4747e18` |               1,817 ms |

Selection separately records 16 HTTP 200 and one HTTP 400, with no 503 in
this window. No recommendation endpoint records an HTTP 5xx. Those facts do
not convert the two semantic timeout fallbacks into successful delivery.

Both traces reach newly started Admin revision
`34f19dd6b30c01a01b193e731dddefdeae8905a5` from older Web revision `4e31f822…`.
The startup runtime bucket reports 5.819 seconds maximum event-loop delay.
Later ten-second buckets range from about 20 to 343 ms. GC maxima are 18–57 ms.
This temporal association motivates the local experiment; it is not a production
CPU attribution to a particular module.

The first trace's preflight transaction takes 509 ms; parallel profile/seed
transactions take 580/446 ms, with BEGIN spans of 162/163 ms. Its retrieval
transaction takes 301 ms against a 131 ms remaining budget. The second trace
has a 565 ms preflight, 1,229 ms parallel transactions and 322 ms BEGIN spans.
Small SQL calls coexist with substantial application gaps. Client-observed
SQL spans and transaction BEGIN durations include scheduling/network effects;
they do not by themselves prove PostgreSQL execution, lock or pool contention.
Post-timeout Prisma P2028 messages are secondary and must not be named as the
initiating cause. The earlier capability-budget/WAL-sync observation remains a
separate unproven cause; selection does not use Redis admission.

## Controlled production-build experiment

Use a real Admin `pnpm --filter @forge/admin build` followed by a fresh
`node node_modules/next/dist/bin/next start --hostname 127.0.0.1 --port <owned-port>`
for every trial. Keep provider credentials absent, workflow runner false and
Datadog disabled. Use an owned PostgreSQL 18/pgvector database with the full
migration chain and owned Redis 7. No shared service settings change.

The runtime fixture contains one seed and twelve eligible Videos with English
locales, published Dubs, playable Mux references and compatible 1,536-dimensional
vectors. Local serving authority and retention health are initialized only in
that fixture. This corpus exercises real service transactions, capabilities and
selection acknowledgments; it is not production-scale retrieval-quality or
feat-447 restored-snapshot latency evidence.

For selection, bootstrap five genuine six-card deliveries through
`semanticRecommendationDelivery`, each with a new session digest. Start a new
Admin process for each returned capability. Poll `/api/health`, then immediately
send the actual `SelectSemanticRecommendation` operation from
`packages/admin-graphql/src/operations/recommendations.ts`, with fresh event,
timestamp and claim nonce. Measure the complete HTTP call, inspect its GraphQL
errors and require `status: accepted`. Do not replay an accepted capability as
a substitute for first-call timing. Stop each owned child in a `finally` block.

The matched baseline temporarily uses the original health handler. It retains
the dependency patch's unused promise assignment, which does not alter Next's
loading behavior. Restore the candidate and rebuild before comparison. These
final runs do not overlap the full test suite or a local build.

| Trial | Original readiness: selection ms | Awaited preload: selection ms |
| ----- | -------------------------------: | ----------------------------: |
| 1     |                           940.89 |                        346.51 |
| 2     |                           948.93 |                        322.15 |
| 3     |                           933.76 |                        402.46 |
| 4     |                           926.11 |                        350.49 |
| 5     |                           937.50 |                        307.00 |

All ten acknowledgments are HTTP 200, accepted, without GraphQL errors.
The baseline exceeds the unchanged 700 ms Web deadline in every trial;
these direct local calls deliberately observe the late response rather than
inventing Web 503s. Readiness moves from 2.17–2.32 seconds to 2.80–3.10 seconds
after process spawn. The existing Railway healthcheck limit remains 60 seconds.
Twenty subsequent actual delivery calls return six cards without fallback.

Node's supported `--cpu-prof` capture identifies module loading beneath
`NextNodeServer.unstable_preloadEntries → loadComponentsImpl → requirePage`,
including dashboard experience and embeddings entries during the first GraphQL
call. This establishes the competing local workload independently of the SQL
timings. The capture covers the owned child only and is stopped afterward.

## Rejected controls and remaining concurrency problem

- Warming only the schema: first GraphQL remains 882–922 ms.
- Importing the actual GraphQL route in health while the background preloader
  continues: first GraphQL remains about 843–907 ms.
- Disabling `experimental.preloadEntriesOnStart` plus warming GraphQL: first
  selection improves to 299–320 ms, but the first editor request delays a
  concurrent GraphQL request by 1,165–1,274 ms. Do not ship this relocation of work.
- Awaiting the existing preloader retains normal startup loading and corrects
  first-selection timing. It does not initialize every later SSR module graph.

An unauthenticated GET of `/dashboard/experiences/runtime-probe` still returns
the expected login redirect (307). Start it after one warm GraphQL call, then
send another GraphQL call 50 ms later. Three original-readiness controls take
823/858/868 ms for GraphQL; the candidate takes 804/806/875 ms. There is no
demonstrated material regression, but both exceed 700 ms. A separate local CPU
capture shows SSR module initialization, including Mastra and Prisma engine
loading. Further attribution and a discriminating fix remain necessary.

## Adjacent production evidence, separately scoped

PR [#2360](https://github.com/JesusFilm/forge/pull/2360) merged normally as
`475a5f2ed102909a6c1463d3f32e8ed4bcfffbf5`. Railway marks Web deployment
`2dfbd968-ffd2-4f74-9f4a-0e47a92a317e` successful; an independent SSH read
confirms that exact running revision. At **04:27:19–04:27:22 UTC**, six bounded
negative probes (two short Meta crawler user agents × evidence/selection/playback)
all return HTTP 403 `machine_evidence_rejected` at the public `/watch/api/` paths.
They carry no cookies or capabilities and cannot invoke Admin mutations. Six
earlier probes mistakenly omitted `/watch` and returned 404; these are diagnostic
path errors, not Watch endpoint failures. Keep all probes outside natural-traffic
recovery claims.

The **03:55–04:25 UTC** natural-traffic window contains 190 seeded-delivery HTTP
200s and 126 HTTP 403s. All 316 final envelopes reconcile, with zero delivery or
retrieval timeouts. Selection has only two HTTP 200s. Playback has 1,769 HTTP
200s, 121 HTTP 403s and one HTTP 400, with zero 5xx. This spans multiple Web
revisions and only a small tail on the new crawler release; it is not sustained
runtime recovery evidence.

At **04:07:28 UTC**, a repeatable-read, read-only snapshot of the complete
canonical predicate finds **168,374 current pointers and zero ineligible** in
1,488 ms. The five-second statement and 500 ms lock limits remain in place;
transaction-local JIT settings are restored by rollback/disconnect.

A natural **04:13:47 UTC** `profile_lineage_ineligible` envelope returns six
cards. A bounded read-only query confirms the unique matching request
`e35a5c18-f5b2-4e49-b1b4-476e44a999f9`: semantic fallback, six stored semantic
items, no experiment assignment and no contributing profile generation.
`evidence_complete=false` preserves the source failure honestly. This is
operational optional-profile fencing, not proof of the distinct last-known-good
manifest fallback or a matching permission-checked Admin trace.

Feat-464/459/447 still require their explicit authorized Admin checks; required
installed Datadog alerts remain absent under the owner's read-only restriction.
The already completed lifecycle and two-hour reconciliation evidence remains
valid. Do not close tickets by deleting or weakening these remaining gates.

## Startup release verification

PR [#2362](https://github.com/JesusFilm/forge/pull/2362) merged normally as
`1cb15d6fc2b5cb0387e23b02afc24a05d4c1acaa`. Railway reports successful Admin
`fc481eb3-574a-4bd4-bed8-0ae58f5fe453` and worker
`6e437b98-dade-425b-ae17-fc5833a36ba7` deployments. Independent SSH reads
confirm that exact revision on both, with the runner false on Admin and true on
the worker. The 05:10 UTC reconciliation batch completed 48 classifications,
queued one affected-pointer rebuild and recorded no failures or exhaustion.

All final PR checks passed before merge. The first Mobile CI run had a real-timer
PiP dismissal assertion failure (`PlaybackHost.test.tsx`, expected `exiting`,
received `none`). The unchanged file passed all 90 tests locally and the failed
CI job passed when rerun on the same head. No Mobile source changed; retain the
initial failure rather than presenting the first CI run as clean.

Release monitoring found one **playback HTTP 503** at **05:07:25.928 UTC**,
trace `6ab0bb8d00000000087216077763d140`, on Web `ec6bf167…`. Its upstream
HTTP span ends with `TypeError: fetch failed` after 330 ms; the complete Web
request takes 335 ms. No Admin span was retained. This is an observed transport
failure, not evidence of a 700 ms selection deadline or an HTTP 200 delivery
fallback. Its deployment-transition timing does not establish which network or
process event caused it. Do not retry an ambiguous mutation to conceal it.

## Follow-on: duplicated server module initialization

The first editor request remained a separate reproducible application workload
after readiness was corrected. In five fresh production-build processes, warm
GraphQL, start an unauthenticated editor GET, then send an actual selection
50 ms later. Baseline selections take **853.80, 862.85, 959.94, 915.83 and
893.24 ms**. The editor correctly returns the login redirect (307); no privileged
session is manufactured.

A local CPU profile identifies SSR loading of Mastra packages and Prisma engine
initialization. A temporary allocation counter inside the owned build's client
factory confirms **three main and three sync clients in each process** after
startup and the first editor visit. This counts client construction, not physical
open connections. The source reads `globalThis` but writes it only outside
production, so separate API/RSC/SSR module evaluations cannot reuse the clients.

The smallest measured correction has two parts:

- Cache the main and sync Prisma clients on `globalThis` in production too,
  preserving their separate 10/5-connection limits and embedding guard extension.
- Externalize only `@mastra/core` and `@mastra/memory` through Next's supported
  `serverExternalPackages` setting, so the server module graphs reuse Node's
  package cache instead of initializing bundled copies during first editor SSR.

Core alone leaves concurrent GraphQL at 565–631 ms; core plus memory gives
503–540 ms. Externalizing seven Mastra packages gives 461–470 ms for a trivial
query but no reliable advantage for actual selections (520–622 ms versus
559–625 ms with only core plus memory). Avoid broadening to all seven packages.

Combining the two-package setting with production client reuse creates **one
main and one sync client** in every trial. Actual editor-concurrent selections
are **492.97, 472.13, 529.30, 504.69 and 552.23 ms**, all accepted HTTP 200
without GraphQL errors. Fresh first selections without an editor are
229–251 ms. Twenty actual deliveries all serve six cards without fallback;
first deliveries take 285–297 ms and warm ones 69–89 ms. The temporary counter
is removed afterward and is not part of the committed change.

The new module-cache regression fails against production before the fix and
passes afterward; development remains covered. All **7,288 Admin unit tests**
pass. Production `$disconnect()` use is confined to standalone scripts; request
handlers do not disconnect the shared clients. No schema, authorization, API
contract, rate limit, mutation retry or transaction semantics change.

These local results prove duplicated initialization and its scheduling cost.
They do not prove that the historical 2.34-second capability-budget call was
caused by duplicate clients or Mastra, nor that every allocated client opened
its maximum number of database connections. Keep the unresolved database/WAL,
pool and production transport questions explicit in feat-496.

Final build validation removes the allocation counter and reruns the real HTTP
workloads without competing local test/build jobs:

| Workload                                       |                          Calls |           Complete HTTP latency | Outcome                    |
| ---------------------------------------------- | -----------------------------: | ------------------------------: | -------------------------- |
| First editor plus one selection                |              5 fresh processes |                      470–527 ms | all accepted               |
| First editor plus five simultaneous selections | 25 across five fresh processes |                      509–579 ms | all accepted               |
| First selection after readiness                |              5 fresh processes |                      229–263 ms | all accepted               |
| Delivery                                       | 20 across five fresh processes | first 289–338 ms; warm 69–86 ms | all six cards, no fallback |

Every selection has HTTP 200 and no GraphQL errors. The full Admin lint,
typecheck, production build and workflow-registration checks pass. Sequential
Compound Engineering review covered correctness, pool isolation, disconnect
ownership, contracts/security, failure-sensitive tests, production bundling and
scope. It found no introduced code blocker; it is not an independent-agent review.

At **05:17:30 UTC**, bounded read-only queries over retained records since
September 18 found no failed projection runs and no requests with
`last_known_good_semantic_fallback`, `candidate_platform_unavailable` or
`semantic_parity_mismatch`. Queries took 6/23 ms. This negative result does not
satisfy feat-447's independent stale-publication/fallback operational gate;
retention and non-persisted fenced outcomes limit what the tables can establish.
No production rows or control state were changed to manufacture that evidence.
