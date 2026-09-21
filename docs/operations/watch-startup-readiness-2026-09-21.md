# Watch startup readiness investigation — September 21, 2026

## Scope and release state

The local production-build reproduction proves that Admin admits API traffic
while Next is still preloading route entries on the same event loop. The readiness
correction is under review. It does not establish the complete cause of the
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
