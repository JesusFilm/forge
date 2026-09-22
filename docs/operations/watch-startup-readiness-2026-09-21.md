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

## Module-reuse release and independent local boundary checks

PR [#2363](https://github.com/JesusFilm/forge/pull/2363) merged normally at
05:33:34 UTC as `850cd7b5b582c327deac8fa50a9e5ebd85abd438`. Fresh main
`1cb15d6…` was already incorporated. The final CI run, `35564631997`, passes
all required checks, including 7,288 Admin tests, 113 PostgreSQL checks, two
Redis checks, lint/types, build, schema drift and repository guards. One earlier
run was cancelled by the repository's concurrency rule after a delayed PR event;
its cancellation-induced gate failure is not a code-test failure. No source
change or check bypass occurred between runs.

A separate owned-database drill uses `createRecommendationDeliveryDependencies`
with the real Prisma client, Redis admission, runtime signer, serving authority,
retriever and persistence. Wait for the standalone Redis client to become ready
before invoking the service; the initial standalone attempt omitted this setup
and correctly returned `admission_unavailable`. This is not a production failure.
A normal control returns six served cards. Override only `orchestrate` to throw
an owned local failure, then call the complete service with a new local session.
The result in 60 ms has six unique last-known-good semantic cards; PostgreSQL
records an issued FALLBACK request, six items, no experiment assignment,
`candidate_platform_unavailable` and `evidenceComplete=false`. The effective
manifest remains the fixture's `semantic-transcript-pgvector-v1`.

Independently invoke the real profile projection service with expected pointer
`{generationId: null, pointerGeneration: 0}` on a fresh local session. The first
publisher succeeds. Reusing that stale expectation returns
`profile_projection_pointer_fenced`; the current pointer stays unchanged and
exactly one generation exists. Neither drill changes production records or
settings. These complete-service/database checks strengthen local evidence;
they do not replace feat-447's operational production and authorized Admin gates
or its restored-production-snapshot performance requirement.

After the readiness release, **05:10–05:20 UTC** primary HTTP metrics report
37 seeded delivery HTTP 200s and 55 HTTP 403s. All 92 final envelopes reconcile;
none contains a delivery/retrieval timeout. Playback records 422 HTTP 200s,
53 HTTP 403s, two HTTP 401s and two HTTP 400s, with no 5xx. There are **zero
selection requests** in this window. It spans Web `ec6bf167…` and `1cb15d6…`
and is not evidence that selection has recovered. Web deployment
`eacd4352-e2a4-4f20-bea0-9be5ac57d95c` is now successful; SSH confirms exact
revision `1cb15d6fc2b5cb0387e23b02afc24a05d4c1acaa`.

At 05:37:41 UTC the running Web `1cb15d6…` application returns HTTP 200
`{enabled:false}` for the anonymous homepage-recommendation availability route
through a read-only loopback request. The preceding public diagnostic GET
returned HTTP 403, which is an HTTP rejection and not a flag evaluation result.
A bounded production SQL read at 05:38:36 UTC finds one published English
`watch-home` locale and zero authored `homepageRecommendations` blocks.
`packages/feature-flags/src/registry.ts` still declares the flag default false.
No settings, content or curation were changed by these checks.

At **05:40:29 UTC**, independent SSH verification confirms Admin revision
`850cd7b5b582c327deac8fa50a9e5ebd85abd438`, deployment
`83224823-62b9-4a26-a991-4c9b553fa361`, runner false, and the built configuration's
exact external-package list `[@mastra/core, @mastra/memory]`. The actual health
route returns HTTP 200 `{status:ok}`. Production runs Node 24.21.0; the owned
matched local experiments use Node 24.16.0. The health read is an initialization
check, not a selection performance result.

The **05:40:31.898 UTC** repeatable-read canonical audit finds **168,701 current
pointers and zero ineligible**, in 1,509 ms. Five-second statement and 500 ms
lock limits remain unchanged; rollback/disconnect restores the transaction-local
JIT setting. This is a timestamped convergence snapshot, not a permission-checked
Admin trace or continuous-zero claim.

At **05:42:40 UTC**, independent SSH verification confirms worker revision
`850cd7b5b582c327deac8fa50a9e5ebd85abd438`, deployment
`ac3b8b79-ff08-4996-a912-46b5f2dfee47`, runner true, Node 24.20.0 and the same
built external-package list. The **05:46:32.312 UTC** reconciliation batch
completes 48 classifications and one affected-pointer rebuild without failures,
exhaustion or stale dispatch. That batch belongs to the newly verified worker;
the shared 05:41 workflow record predates this verification and is not attributed
to the replacement process merely because it is visible in the same database.

## Repeated handover failure and bounded diagnostic

A second playback HTTP 503 occurs at **05:40:18.471 UTC**, trace
`6ab0c34200000000686c2d4d2bb03d5e`, on Web `1cb15d6…`. The complete request
takes 159 ms and its upstream `fetch failed` span takes 154 ms; no Admin span is
retained. The new Admin logs server startup at 05:40:10.170 and Next readiness
at 05:40:10.865; the old Admin logs `Stopping Container` at 05:40:20.063.
These timestamps support testing a handover hypothesis but do not identify
DNS failure, refusal, socket closure or the mutation's commit outcome. Next's
startup log is also distinct from the application's awaited healthcheck.

The fixed **05:41–05:49 UTC** population has 68 seeded-delivery requests:
33 HTTP 200 and 35 HTTP 403, exactly matched by final envelopes. The 200s are
27 served responses and six six-card `seed_embedding_unavailable` fallbacks;
there are zero `delivery_timeout` or retrieval-timeout fallbacks. Selection has
two HTTP 200s. Playback has 197 HTTP 200s and 27 HTTP 403s, with no 5xx.
An eight-minute window and two selections cannot establish sustained recovery.

The transport diagnostic preserves `networkErrorCode` on existing Web evidence
observations for 5xx responses. It accepts only nine named Node/Undici codes plus
`unknown`, traverses at most four cause objects, and catches malformed-property
access. The mirrored Admin/Web contract keeps the field optional. Existing
outcome, reason, timeout stage, HTTP response, retry policy and deadlines remain
unchanged. No message, URL, address, stack, capability or arbitrary code is logged.

Failure-sensitive unit tests distinguish the allowed code from raw/private
properties and bound cyclic, throwing and over-depth errors. Real local native
fetch failures prove socket closure (`UND_ERR_SOCKET`) and refusal
(`ECONNREFUSED`) reach the observer. The playback route test exercises adapter
propagation, the unchanged 503 body, a single mutation attempt and the exact
finite log. This is a diagnostic correction, not a proven transport fix. Verify
its production field only when a natural failure occurs; do not force an outage.

Validation passes **4,493 Web tests** and **7,288 Admin tests**, both lint and
typechecks, both production builds, workflow registration guards and roadmap
lint. The initial Web run had one unchanged home-carousel render-count failure
(expected three, received four); its complete 70-test file passed alone, and the
full Web suite passed unchanged afterward. A final full run including the new
route-boundary test also passes. Preserve the initial failure rather than calling
every run green. Fresh main `fa5a836003f3294d8cccc6eac453c74e56b3ec37` is
incorporated; its additional changes are RAG planning/roadmap documents.

A quiet Node 24.16.0 microbenchmark executes the actual observer, request-header
classification, normalization and formatting, with a length-counting log sink
instead of I/O. Seven alternating baseline/candidate trials each make 100,000
calls after warmup. HTTP 200 median cost is 3.628/3.591 microseconds; HTTP 503
with a nested reset cause is 3.672/4.015 microseconds. The measured added failure
cost is about 0.34 microseconds per call. This does not measure console transport,
HTTP latency, database work, cold initialization or production percentiles.

Sequential Compound Engineering review checks correctness, bounded work, privacy,
wire compatibility, route propagation, malformed-error controls and deployment
scope. It finds no introduced code blocker and does not claim independent agents.
The durable result extends the existing
[outcome-accounting learning](../solutions/logic-errors/recommendation-outcome-accounting-boundaries-20260921.md).

## Current closure gates

| Ticket   | Evidence still required                                                                                                                                                                                                                                                |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| feat-464 | Installed transport/reconciliation alerts under approved access, matching authorized Admin reconciliation, and real browser terminal-409 behavior without retry amplification. Preserve the repeated fast transport failures and their unproven causes.                |
| feat-459 | Completion of feat-464 and the matching authorized Admin evidence; complete SQL snapshots and repaired batch performance are already recorded.                                                                                                                         |
| feat-447 | Matching authorized Admin lifecycle trace and independent operational last-known-good/stale-publication evidence. Retain the existing September 9 restored-snapshot performance proof under its documented scope; this continuation's small fixture does not rerun it. |
| feat-496 | Attribution and correction of any remaining capability-budget/pool/WAL or handover failure, followed by a representative sustained population of selection and delivery outcomes on verified revisions.                                                                |

Keep all four tickets in progress while these requirements are unmet. Do not
weaken them, transfer them to a new ticket merely to close the originals, or
count healthy navigation/HTTP 200s as proof that semantic timeouts are resolved.
