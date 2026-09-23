# Watch authored-block dub fanout — September 23, 2026

## Proven scope

One retained `GetWatchSettings` operation at 02:02:38 UTC contains 62 separate
`VideoDub.findFirst` calls. Four authored block fields bypass the existing
preferred-dub loader and query independently for each video/language identity.
The ten-connection main pool is shared with recommendation requests.

The same primary-log ingestion second has 60 slow acquisitions, maximum
pending count 102 and maximum acquisition 102 ms. Those events are not
request-correlated: the production trace identifies a competing workload,
not the cause of the historical selection 503 or delivery timeout fallback.

Trace `6ab3333c000000006c62ce4aacd4fd55`, settings span
`7604331360358271055`, completes in 183.430176 ms. The trace is linked to an
ordinary Watch page request. No production load generator was used.

## Controlled result and fix

The isolated PostgreSQL fixture has 62 synthetic videos, two playable dubs
per video and nested language selection. Five simultaneous requests reproduce
the observed lookup shape against the production ten-connection pool. A local
TCP proxy adds an explicit three-millisecond server-response delay; this is a
network-delay model, not a measured reconstruction of the historical incident.
Twenty rounds per phase run in ABBA order with the same records and pool limit.
An unrelated `SELECT 1` starts five milliseconds into each burst.

| Measurement            | Scalar phases | Batched phases |
| ---------------------- | ------------- | -------------- |
| SQL commands per round | 621           | 16             |
| Peak queued calls      | 301           | 0              |
| Unrelated read p95     | 200 / 311 ms  | 6.84 / 8.81 ms |
| Complete workload p95  | 406 / 547 ms  | 29.6 / 30.6 ms |

The change batches each request's authored video/language pairs by Pothos
selection. At most 100 keys enter a batch. SQL selects one winner per exact
pair, then Prisma hydrates the requested relations. Keep the original duration
DESC null ordering and ID tie-break, publication/deletion checks and nonnull
HLS/DASH/share eligibility. This is distinct from preferred-language fallback.
Availability and identity are rechecked after hydration; withdrawn or reassigned
winners return null. Original database errors propagate.

Artifact: `docs/validation/watch-block-dub-batch-20260923/comparison.json`.
The query count includes nested-language SQL and the competing read, not just
Prisma method calls. The latency result proves avoidable queue contention in
this workload; it does not establish sub-200 ms production recommendations.

## Reproduce safely

Use a new, owned PostgreSQL 18/pgvector container and a database named
`watch_q7n`, bound to loopback on an unused port. Never use a shared database.
Set `DATABASE_URL` only for these commands to that disposable fixture, then:

```bash
pnpm --filter @forge/admin exec prisma db push --skip-generate
BLOCK_DUB_DB_TEST=1 pnpm --filter @forge/admin exec vitest run src/services/selected-block-video-dub.db.test.ts
CI=1 pnpm --filter @forge/admin exec tsx --tsconfig tsconfig.json ../../docs/validation/watch-block-dub-batch-20260923/reproduce.ts
```

The benchmark refuses a non-loopback host or different database name, seeds
synthetic `q7n-*` catalog rows and closes its clients/proxy. Stop the owned
container afterward; do not delete or change another task's service. The
baseline-only option is `--baseline-only`; complete execution compares scalar
and batched code without changing the source tree.

## Regression, review and release gates

Four actual GraphQL regressions fail with 62 scalar calls each on the original
code and pass with one batched selection/hydration pair, preserving requested
nested fields. Service tests cover pair identity, order, duplicate/missing
keys, request isolation, selection groups, bounds, withdrawal/reassignment and
error identity. Real PostgreSQL tests compare scalar and batched results for
language separation, ties, null duration, missing/deleted/unpublished/unplayable
rows and HLS/DASH/share eligibility. All 141 focused tests pass, including the
two real PostgreSQL checks.

All 7,348 Admin tests pass in the separate rerun, and typechecking, lint,
production build, schema generation and consumer introspection generation pass.
The generated schema and consumer contract are unchanged. An initial local full-suite run had one UI timeout while an
incorrectly invoked typecheck exhausted Node's default heap. The repository's
configured typecheck script and separate full-suite rerun both passed; no test
or API deadline was increased.

Sequential Compound Engineering review covers correctness, testing,
maintainability, project standards, agent access, past learnings, security,
performance, API compatibility, reliability, adversarial races and TypeScript.
The review added coverage for missing block identity. No blocking finding
remains. The two-query selection/hydration path adds a round trip for a lone
lookup; the proven improvement applies to sibling fanout. No database mutation,
schema, UI, flag, deadline, retry or pool-size change is included. Fresh-main
incorporation and normal PR CI passed: Mobile PR #2367 was incorporated at
`3494f42ee4e678451a6dd60768a1295b751497c5`, all 24 focused regressions passed
again, and all applicable CI gates passed on the combined branch. PR #2401
merged normally at 03:19:54 UTC to
`911ad005874f2ee84e8d265f79b4d07d40863ce6`.

Verify the exact automatic Admin/worker revision and production settings query
shape after release. Report selection HTTP failures separately from delivery
HTTP 200 timeout fallbacks. A short quiet window remains insufficient for a
recovery claim. The user requested one final bounded pass; if the historical
fault remains unresolved, close the investigation with that limitation explicit
and move on, rather than continuing indefinite observation.

## Production query and response verification

Admin deployment `9d6a59e3-4815-4245-9850-5b0ee4ab1843` runs
`911ad005874f2ee84e8d265f79b4d07d40863ce6`; the 03:28:05 UTC runtime check
returned health HTTP 200 with the workflow runner disabled. Worker deployment
`e3e66a80-e6c5-4c0f-82cd-5cb9562ed6d9` was independently verified at
03:32:55 UTC on the same revision, health HTTP 200, runner enabled. The
post-merge main CI run also passed.

The same two public read-only settings queries used before deployment return
HTTP 200 without GraphQL errors. English preserves all 43 populated dub fields;
Spanish preserves all 21. Complete parsed payloads match, including nulls,
nested fields and ordered arrays. Raw hashes differ only because JSON object
keys occur in a different order; canonical-key hashes match and byte lengths
are unchanged. The two post-release reads took 81.4 and 42.2 ms, compared with
128.8 and 66.5 ms before. These are smoke samples, not latency percentiles or
an API recovery claim.

A separate natural `GetWatchSettings` trace at 03:28:54.218 UTC confirms the
changed execution shape on this exact revision: trace
`6ab34776000000001d597cf87d43da8d`, settings span
`6237385266821987906`, duration 51.443848 ms. The expanded settings subtree
has one raw winner-selection call and one `VideoDub.findMany` hydration,
with no scalar `VideoDub.findFirst` method spans. These are method-span
counts; nested driver/SQL spans are collapsed, so this is not a claim of two
total SQL statements. Different natural requests are not a controlled latency
comparison. Full before/after query cardinality is measured by the local ABBA
experiment above.

## Fixed-window outcomes and closure

The complete 03:29–03:39 UTC window contains 433 uncapped Admin log rows and
751 uncapped structured Web delivery/evidence rows. Datadog HTTP counts match
the primary delivery/evidence classifications:

| Surface         | HTTP result                                 | Semantic result / limitation                                                                                      |
| --------------- | ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Seeded delivery | 53 HTTP 200; 57 HTTP 403; zero observed 5xx | 45 served; 3 `no_candidates`, 3 `seed_embedding_unavailable`, 2 `cooldown` fallbacks; **zero `delivery_timeout`** |
| Selection       | No requests observed                        | No selection acknowledgment or reliability conclusion                                                             |
| Evidence        | 115 HTTP 200; 77 HTTP 403                   | 403 records are crawler rejections                                                                                |
| Playback        | 382 HTTP 200; 66 HTTP 403; 1 HTTP 409       | 36 crawler and 30 forbidden rejections; 409 is terminal `invalid_binding`, separate from latency recovery         |
| Profile         | 61 HTTP 200; 209 HTTP 403                   | HTTP population only; this capture does not classify profile rejection reasons                                    |

Delivery's 57 HTTP 403s comprise 33 invalid-fetch-metadata and 24 invalid-origin
rejections. The completed Admin records account for all 53 delivery HTTP 200s;
none marks a timeout fallback. Admin service elapsed time has p50 252.18 ms,
p95 464.53 ms and maximum 572.90 ms. The 48 evidence INSERT observations have
p95 166.08 ms and maximum 179.30 ms. There are no slow pool-acquisition or late
operation events in this slice. This does not imply all acquisitions are zero,
and these Admin timings are not browser acknowledgment latency. No for-you
traffic was observed.

Both running revisions and health were rechecked at 03:39:24–25 UTC. No
production settings were changed, and the source-timing observer cleanup
remains recorded separately. Sanitized release evidence is in
`docs/validation/watch-block-dub-batch-20260923/release.json`.

Per the owner's one-final-pass instruction, close feat-496's investigation
with its residual cause unresolved. The authored-block contention bug is
proven, fixed and verified in production. The historical 1.19-second evidence
write and selection capability-budget timeouts are **not** causally assigned
to that workload, and this window does not establish full recovery or
consistent sub-200 ms service. Separate evidence-transport work under feat-464
is not closed by this result. Reopen latency investigation only when new
matched evidence or a new scope decision warrants it; do not turn this
bounded closure into an indefinite observation loop.
