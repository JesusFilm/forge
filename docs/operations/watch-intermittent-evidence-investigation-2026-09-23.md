# Intermittent recommendation evidence investigation - September 23

## Conclusion

The subsequent owner-authorized implementation now fixes the verified browser
fact-recovery gap locally. Three serialized attempts remain, but their waits are
1-1.25 seconds and 8-10 seconds instead of 100 and 200 ms; exact fact identities
remain in memory and attempted facts expire after a 30-second monotonic recovery
window. No production deployment has occurred. See [bounded fix](#bounded-fix-and-verification).

No fresh playback server failure occurred in the settled diagnostic windows.
That does not close feat-464 or disprove its retained deployment/Redis incidents.
The authorized restart experiment now reproduces the historical Redis failure
mechanism and identifies a browser recovery gap: disconnected Redis makes the
mandatory GraphQL limiter reject before playback writes, while three fast browser
attempts exhaust at 0, 100, and 300 ms. Facts retired at exhaustion do not return
when Redis recovers. This is a confirmed local failure chain consistent with the
sampled production incident, not proof that every historical failure or missing
fact had this cause. See [controlled recovery experiment](#controlled-recovery-experiment).

Two additional local mechanisms are characterized without changing application behavior:

1. **Readiness blind spot, confirmed locally:** production health can return 200
   while the mandatory Redis-backed GraphQL rate-limit store rejects reads and
   writes. GraphQL module initialization is not dependency availability.
2. **Device-clock sensitivity, confirmed locally:** an otherwise valid delivery
   capability does not make browser-generated event timestamps valid. Events more
   than five minutes before issuance or later than the signed expiry are rejected.
   The production audit confirms the rejection category, not the device-clock cause.

The separate feat-496 latency/persistence work remains out of scope. No production
settings, rate limits, data, flags, credentials, or monitoring configuration changed.
No deployment, mutation replay, production browser canary, commit, or PR was made.

## Scope and source

**Latest authorization:** the owner subsequently requested the remaining bounded
recovery work and normal PR-to-main merge. The [release plan](../plans/2026-09-23-003-fix-playback-recovery-release-plan.md)
adds Redis admission/readiness bounds and exact-nonce claim pacing. Earlier sections
below retain the diagnostic and fact-only checkpoints; their no-release statements
describe those earlier stages, not the latest authorization.

This task uses its own clean-start worktree and `codex/feat-464-intermittent-failures`
branch at default-branch revision `77eb63fbb325f6279955f34cffd1f8994f9281dd`.
See the [investigation plan](../plans/2026-09-23-002-fix-intermittent-evidence-failures-plan.md).
The initial stages changed only diagnostic tests and documentation. The owner
subsequently chose "Investigate, then implement and test the supported fix" and
authorized installing `agent-browser`. That stage changes only the Web playback
fact recorder's recovery behavior, with tests and local verification tooling.
Shared Admin admission cancellation/readiness and context/claim issuance recovery
remain separate work. No commit, push, merge, deployment or production mutation
is part of this stage.

The original short-watch release monitor remains in its original task. These
windows overlap some of its observations but are diagnostic snapshots, not a new
monitor or an additional independent sample.

## Current production accounting

The fixed September 23 **00:00-02:00 UTC** window has **13,342 recommendation HTTP
requests**. Primary Datadog request metrics and bounded Railway Web outcome logs
reconcile as follows, with no traffic exclusions:

| Endpoint         |   200 | 400 | 401 |   403 | 409 | 5xx |
| ---------------- | ----: | --: | --: | ----: | --: | --: |
| Seeded delivery  |   679 |   0 |   0 |   545 |   0 |   0 |
| Playback         | 6,358 |   9 |   2 |   609 |   3 |   0 |
| Initial evidence | 2,247 |  24 |   3 |   485 |   0 |   0 |
| Profile          | 1,040 |   0 |   0 | 1,319 |   0 |   0 |
| Selection        |    13 |   1 |   0 |     0 |   0 |   0 |
| For-you delivery |     3 |   0 |   0 |     0 |   0 |   0 |
| Content actions  |     2 |   0 |   0 |     0 |   0 |   0 |

Playback has **0 / 6,981 5xx**. In the wider September 22 14:00 through September
23 02:00 UTC window, primary metrics show **0 / 46,364 playback 5xx**. The twelve-hour
indexed evidence-error query returns no 5xx rows; this is corroboration, not the
request denominator or proof that older unresolved failures are fixed.

### Semantic outcomes and collector gaps

All 679 seeded successes reconcile to 577 served and 102 fallbacks: 54
`no_candidates`, 42 `seed_embedding_unavailable`, five `cooldown`, and one
`session_hour`. All three for-you responses are served. No semantic timeout occurs
in the primary Web outcomes. The 545 seeded rejections are 375 invalid-fetch-metadata
and 170 invalid-origin responses, not upstream recommendation failures.

Indexed Datadog logs initially miss two seeded successes, two seeded rejections,
eight accepted facts batches, one accepted context, and two forbidden playback
responses. Railway fills all fifteen Web outcome gaps. Four adjacent half-hour
evidence slices return 3,416, 2,186, 2,910, and 1,242 rows, each below the 5,000-row
cap. Delivery returns 1,227 rows, below its 2,000-row cap. No missing Web outcome
remains after primary reconciliation. Admin indexed logs still lack the eight
accepted batches relative to primary Web outcomes; no durable-loss claim follows.

Primary playback successes are 5,582 accepted fact batches, ten all-replay batches,
384 claims, and 382 contexts. The three binding rejections are one claim and two
facts responses, all terminal HTTP 409. Recognized-crawler evidence observations
are 485 initial-evidence and 295 playback rejections, all HTTP 403; unknown or
browser-like user agents do not prove human provenance.

Admin logs contain 75 first-attempt, thirteen second-attempt, two third-attempt,
two fourth-attempt, and one fifth-attempt `transaction_busy` observations. These
are 93 attempts, not 93 HTTP failures. No exhaustion is observed. Individual retries
were not correlated to final acknowledgements in this investigation.

The [aggregate artifact](../validation/watch-intermittent-evidence-20260923/diagnostic-window.json)
preserves counts, collector slices, revision observations, and limitations.

## Timestamp rejection diagnosis

A bounded, five-second-guarded read-only SQL aggregate of committed rejections
finds **18 `delivery_timestamp_invalid`** observations, from 00:42:40.054 through
01:39:37.241 UTC. Six of the 24 initial-evidence HTTP 400s are not explained by
that aggregate. Eight playback-facts 400s have matching terminal Admin invalid-input
observations; one playback 400 is rejected before its action is classified. Their
individual input/token causes remain unclassified. The one selection 400 has no
matching committed timestamp audit in this window.

### Verified causal chain

- `apps/web/src/components/recommendations/WatchSemanticRecommendations.tsx`
  constructs render, impression, and selection timestamps using the browser's
  `new Date()`. `WatchForYouRecommendations.tsx` uses the same device-clock source.
- `apps/admin/src/services/recommendations/token.service.ts` issues a ten-minute
  capability and validates its signature, exact binding, revocation, and expiry
  against server time, with zero expiry tolerance for delivery capabilities.
- `apps/admin/src/services/recommendations/evidence.service.ts` then checks each
  event's floored timestamp against `iat - 300` and `exp` before business writes.
- A client clock at issuance minus 301 seconds or issuance plus 601 seconds
  therefore yields a committed timestamp rejection despite a valid capability.
  The exact boundaries (-300 and +600 seconds) and the correct-clock control pass.
- A genuinely expired capability fails earlier as `RecommendationTokenInvalidError`,
  before the submission budget or timestamp audit. Ordinary expiry is therefore
  ruled out as the sole explanation for this specific committed audit category.
- The Web characterization sends the device-clock timestamp unchanged, makes only
  one attempt after simulated terminal HTTP 400, and leaves the recommendation card
  available. This is not retry amplification or a player-blocking failure.

**Confidence:** high in the reproduced mechanism; insufficient evidence to assign
the eighteen production events to incorrect clocks rather than other invalid
client timestamps. Rejected payloads and clock provenance are intentionally absent
from the retained aggregate. Do not infer their values or relabel the observations.

The new Admin tests use genuine signed capabilities with synthetic keys and mocked
storage. The Web test simulates the separately verified Admin timestamp predicate;
it is not a real browser-to-production or cross-app integration test.

## Dependency availability diagnosis

The retained [September 22 release evidence](watch-contextual-distance-release-2026-09-22.md#longer-observation-caught-a-separate-redis-update-interruption)
already establishes one sampled fast playback failure during a Redis update:
Admin's rate-limit `getForIdentity` fails because the stream is not writable and
offline queuing is disabled. Web returns 503 after Admin's fast HTTP 500. The
nineteen-request burst remains in its original denominator. This does not explain
every old fetch failure, identify every mutation disposition, or implicate delivery
database latency.

Current code retains the relevant dependency chain:

- `apps/admin/src/infra/redis.ts` creates the shared client with
  `enableOfflineQueue: false` and `maxRetriesPerRequest: 1`.
- `apps/admin/src/graphql/plugins/rate-limit.ts` correctly propagates Redis failure
  in production; an in-memory limiter would violate the shared enforcement policy.
- `apps/admin/src/app/api/health/route.ts` waits for Next entry preloading and
  imports the GraphQL module, then returns 200. It does not check Redis availability.
- The new `rate-limit-availability.test.ts` loads the real Envelop store wrapper,
  supplies callback failures at its Redis boundary, and observes health 200 while
  both store operations reject. A connected/recovered control uses Redis successfully
  without switching to the in-memory fallback.

**Confidence:** high in the readiness blind spot and the historical sampled Redis
failure path. That initial test does not restart real Redis, execute a complete Yoga
mutation, or establish a fresh production outage. A readiness improvement protects
deployment admission; it alone cannot eliminate a Redis restart after admission.

During diagnosis, latest Admin/worker deployment metadata reported revision
`77eb63fb...` building. An independent Admin SSH read still reported serving
`4583c4ec...`; Web remained successful at `1cccac03...`. Building metadata is not
proof of the serving revision, and the fixed diagnostic population spans revisions.

## Controlled Recovery Experiment

The owner authorized this additional diagnostic stage after the initial report.
The fixture uses Redis **8.10.2**, ioredis **5.10.1**, Envelop rate limiter **10.0.1**,
real Node HTTP/Yoga, the unchanged production Redis singleton and rate-limit plugin,
genuine signed episode capabilities, and the actual episode/playback services
against owned disposable PostgreSQL. All sockets bind to loopback. No production
credentials or shared databases are used. Containers and their volumes are removed.

The GraphQL schema and already-authenticated consumer principal are deliberately
minimal fixtures. Authentication, the Next server, the complete Web HTTP hop, and
a real browser are not part of this integration. The real recorder is exercised
separately in jsdom. Web's 500-to-503 mapping is supported by the historical trace
and existing Web route tests, not a new full-stack live-browser claim.

### Results

Seven integration cases pass. The final run's three restart rounds show:

| Round | Three failed HTTP attempts, cumulative ms | Client ready after Docker start began | Facts before recovery | Facts after resend and replay |
| ----- | ----------------------------------------- | ------------------------------------- | --------------------- | ----------------------------- |
| 1     | 14 / 121 / 328                            | 517 ms                                | 0                     | 1                             |
| 2     | 7 / 112 / 321                             | 1,272 ms                              | 0                     | 1                             |
| 3     | 7 / 111 / 315                             | 476 ms                                | 0                     | 1                             |

Every failed request returns Admin HTTP 500 with the same underlying
`Stream isn't writeable and enableOfflineQueue options is false` error as the
retained production trace. No resolver executes and no fact is written during
these failures. Health still returns 200. The existing client automatically
reconnects; neither the Admin process nor its client is replaced. Recovery timings
include Docker startup and local scheduling, so they are not production predictions.
A preceding successful run also passed all three restart rounds.

The browser characterization confirms that immediate retryable 503s produce
attempts at **0, 100, and 300 ms**, with identical bodies. The third failure emits
`transport_exhausted` / `dropped` and removes those event IDs. Recovery at one
second does not retry them. A new terminal fact is accepted after recovery without
resurrecting the retired IDs. This distinguishes an individual lost batch from a
permanently broken recorder. Request latency adds to this 300 ms backoff total.

Two additional fault controls pass:

- **Silent stall:** pausing Redis without closing TCP leaves the client marked
  `ready`. A one-second pause delays admission and then succeeds (1,097 ms measured).
  A longer pause causes the caller's three-second fetch to abort (3,009 ms), while
  no resolver or fact exists yet. After unpause the server continues and commits
  one fact; exact replay returns `replay`, not another fact. The limiter's awaited
  store operations have no per-call deadline or caller-abort guard. The comment in
  `infra/redis.ts` mentioning per-call timeouts in `rate-limit.ts` is not supported
  by the current implementation. This late-commit mechanism is locally established,
  not assigned to any historical production timeout.
- **Lost acknowledgement:** the fixture destroys the HTTP response socket after
  the real playback transaction commits. Fetch rejects; PostgreSQL contains one
  fact. Resending the identical payload returns `replay` and still leaves one fact.

The [compact experiment artifact](../validation/watch-intermittent-evidence-20260923/recovery-experiment.json)
retains aggregate measurements, assertions and limitations, without capabilities,
credentials, viewer IDs or raw playback payloads.

### Root Cause and Scope

For the sampled production Redis incident, the infrastructure trigger is the
recorded automatic Redis image update. The application availability mechanism is
the synchronous, mandatory shared rate-limit dependency with immediate failure
while disconnected. Envelop performs that check before resolver execution, and
production deliberately propagates its errors rather than bypassing enforcement.

The newly verified persistence-of-loss mechanism is a **retry horizon shorter than
the dependency outage**: bounded attempt count alone permits all attempts to occur
within roughly 300 ms plus request latency. Once that budget is exhausted, recovery
cannot recover those in-memory facts. This explains how a temporary outage can
produce missing recommendation input without a stuck client or a broken ranking
algorithm. It does not establish which of the nineteen historical requests lost
facts or whether they were claims versus fact batches; that would need request-level
production evidence not available here.

**Ruled out in the fixture:** permanent reconnect failure, resolver writes during
disconnected admission, duplicate facts on exact replay, and a requirement to
restart Admin after Redis recovery. **Not ruled out globally:** other network
failures, clock/input rejections, database delays, or different runtime topology.
Readiness is an independent misleading signal, not the trigger for Redis downtime.

### Fix Direction Recorded Before Implementation

The supported next scope is transient-outage resilience, not a health-only patch:

1. Design a bounded in-memory recovery window for retryable playback failures,
   retaining exact event IDs/payloads across paced, jittered retries. Choose its
   time/attempt/size limits explicitly and test multiple tabs, recovery, unmount,
   privacy transitions, and final exhaustion. Do not persist capabilities in browser
   storage, retry terminal input/binding errors, or queue without limits.
2. Bound admission work and respect cancellation before starting mutations. A
   timeout is not proof of non-commit; preserve identical-payload receipt replay.
   Do not solve this by globally enabling ioredis offline queues or a memory limiter.
3. Correct readiness separately and evaluate Redis update availability without
   silently changing production topology or provider settings.

At that diagnostic stage no fix was applied. It validated 65 focused Admin tests, 97 focused Web
tests and seven real-dependency cases: **169 distinct passing cases**. Both app
typechecks, changed test lint and formatting pass. Ordinary runs skip the seven
Docker cases; opt in with both existing test flags. Example:

```sh
RECOMMENDATION_DB_TEST=1 RECOMMENDATION_REDIS_TEST=1 pnpm --filter @forge/admin exec vitest run src/graphql/plugins/rate-limit-recovery.db.test.ts
```

Fixture setup corrections are excluded from findings: PostgreSQL startup must be
checked over TCP (the temporary initialization server is not the final listener),
pgvector must be enabled in the empty database, progress input must include its
required wall elapsed time, and a randomly assigned Docker port must be pinned
across restarts. The first unpinned-port run was invalid evidence of reconnect
behavior. These issues were corrected before the two successful integration runs.

## Initial Proposed Next Actions (Before Experiment)

1. **Small, supported readiness correction:** make production readiness fail closed
   when its mandatory Redis dependency is not ready, using a bounded, non-mutating
   probe. Preserve Next preload checks, missing-config failure, and local development
   behavior. Test unavailable, slow, recovering, and healthy Redis, with no rate-limit
   writes or fallback. Coordinate with the other task before changing shared startup
   code. This corrects the health signal, not the whole intermittent-failures ticket.
2. **Redis restart resilience experiment:** in an owned disposable environment,
   test a bounded wait for dependency recovery before mutation execution, within
   the existing acknowledgement budget. Verify that no resolver runs before admission,
   no ambiguous write is reissued, no unbounded queue forms, and unrecovered dependency
   failure stays fail-closed. Do not implement a global offline queue, memory fallback,
   new mutation retry, or larger deadline based only on the current evidence.
3. **Clock decision before changing semantics:** establish whether valid interactions
   should survive a wrong device clock. If yes, design a server-time anchor plus
   monotonic elapsed time for both recommendation surfaces and playback evidence,
   preserving capability expiry, event ordering, and visibility duration. Do not
   clamp timestamps or weaken validation. Minimal allowlisted early/late rejection
   categories could improve attribution without exporting timestamps or identifiers.

These were proposed changes, not implemented fixes. The later authorization is
recorded below; it does not authorize shipping or widening shared Admin behavior.

## Initial Validation and Outstanding Gates

- 75 focused Admin tests pass, including six signed-token/timestamp cases and two
  production-store availability cases added here.
- 85 focused Web tests pass, including three device-clock/terminal-disposition
  cases added here. The selected baseline passed before additions.
- Changed test-file lint, whitespace validation, and both Admin/Web application
  typechecks pass. Formatting is checked across every changed or added file.
- No production behavior or frontend rendering implementation changed, so no
  page-load performance claim is made or required from these diagnostic tests.
- No complete fresh current-pointer audit was run. Prior release-monitor and
  repository audits retain their own dates and limitations.
- No new production browser terminal-409 journey was captured. Local component
  tests do not replace the ticket's production/browser lifecycle gate.
- Required Datadog monitoring remains a documented organization write-policy
  blocker; no installation or policy workaround was attempted.

Keep feat-464 and dependent production gates open. A passing two-hour request
population, a local characterization, and a truthful health signal are separate
pieces of evidence, not substitutes for the remaining acceptance criteria.

## Bounded Fix and Verification

### Implemented scope

`apps/web/src/components/recommendations/RecommendationPlaybackRecorder.tsx`
retains the three-attempt serialized fact budget and all existing count/body
limits. The first failed attempt waits 1,000 ms plus up to 25% jitter; the second
waits 8,000 ms plus up to 25% jitter. With immediate failures, the last attempt
begins 9-11.25 seconds after the first, spanning the observed roughly eight-second
interruption. The unchanged five-second per-request timeout keeps the normal
worst-case three-request schedule within 26.25 seconds. Timers delayed by browser
throttling cannot replay an attempted fact at or beyond 30 seconds since its first
send, measured with `performance.now()` rather than the device wall clock.

New player events join the bounded queue without bypassing an armed backoff.
Acknowledged/conflicting/exhausted facts retire their attempt and age metadata.
Unmount cancels retries and late failed requests cannot create replacement timers.
The existing separate best-effort terminal keepalive also works during backoff;
it does not accelerate the previously failed facts. That terminal fast path is
separate from the three serialized attempts, as it was for an in-flight batch.
Healthy sends remain immediate. No UI, schema, server deadline, rate limit,
profile eligibility, privacy generation, capability storage or consent prerequisite
changes. Context issuance and claim pacing are unchanged.

### Test evidence

The eight-second outage regression failed first against the baseline with attempt
times `[0, 100, 300]`, then passed with `[0, 1000, 9000]` and byte-identical payloads.
Additional tests cover both retry delays, queued player events, malformed/missing
receipts, exhaustion, jitter, throttled-timer expiry, wall-clock jumps, StrictMode,
unmount during backoff/in-flight failure, terminal keepalive and terminal rejection.
Existing mixed-version tests still prove optional observations can be stripped
without changing already-submitted baseline facts.

- 179 Web cases pass across recommendation components, playback route and browser
  deadline helper; 59 Admin cases pass across evidence, episodes, playback and
  limiter availability; seven owned Redis/Postgres HTTP cases pass again.
- Both application typechecks, changed-file ESLint, formatting and whitespace
  checks pass. Structured artifacts and 51 local documentation links validate.
- The implementation-stage dependency rerun reconnects after all three restarts, retains exactly
  one fact after replay, and reproduces a late commit after a 3,011 ms caller abort.
  No owned diagnostic containers remain.

`node apps/web/scripts/verify-playback-recovery-browser.mjs` builds the baseline
recorder and current recorder with production React and drives Chrome through
`agent-browser` against an ephemeral loopback HTTP server. It uses a synthetic
player and API, not Next, Mux, authentication or a complete Watch/Admin stack.
The retained [browser artifact](../validation/watch-intermittent-evidence-20260923/browser-recovery.json)
contains only counts, timing and degradation categories. In its eight-second
outage case the baseline sends at 0/105/309 ms and retires both initial facts.
The candidate sends at 0/1,069/9,709 ms and accepts both unchanged facts. These
are pre-departure snapshots; subsequent pagehide traffic is outside each window.

Five paired healthy runs each make exactly one claim and one fact request in the
measurement window. Median mount time is 35.4 ms baseline versus 29.5 ms candidate;
median DOMContentLoaded is 35.5 versus 29.7 ms. Both first runs have a startup long
task (56/57 ms), with none in subsequent healthy runs. The fixture bundle grows
459 bytes minified, 155 bytes gzipped. This small, noisy component benchmark finds
no healthy-path request or startup regression; it is not a full Watch page-load
benchmark or a statistically established speed improvement.

### Remaining boundaries

This fixes loss caused by exhausting fact retries before a brief outage recovers;
it does not make the underlying infrastructure continuously available. Leaving
the page still makes delivery best effort, and a longer outage can exhaust the
bounded recovery policy. Initial context/claim failure, shared pre-mutation
cancellation, Redis-aware readiness, timestamp attribution, installed monitoring
and feat-464's production acceptance gates remain open. A full browser through
the real Web/Admin stack and production rollout verification are not claimed.

The full Compound Engineering documentation pass uses this task and repository
learnings only. It adds a dedicated retry-horizon learning, qualifies the existing
startup-readiness guidance, and cross-references the playback boundary pattern.
The source-neutral history learning remains valid: it describes use of accepted
facts, whereas this fix concerns delivering those facts. No prior task history,
credential, viewer identifier or capability is copied into these artifacts.

### Review and documentation refresh

Two sequential review passes use the Compound Engineering correctness, testing,
maintainability, project-standards, agent-parity, learnings, reliability,
performance, adversarial, TypeScript and frontend-race lenses. Per repository
tool mapping these are main-thread checks, not independent reviewer agents.
The production behavior diff is confined to the recorder; the other application
files are diagnostic/regression tests and a loopback-only browser verifier.

The first pass corrected mutable browser-result snapshots and hardened verification
cleanup: HTTP-handler assertion failures reach the main browser runner so its
`finally` closes the owned session, and client cleanup failure no longer skips
container removal. The browser's twelve scenarios and the seven disposable-service
cases pass after those changes. The second pass finds no remaining blocking issue
within the fact-recovery scope. The full-stack, production and initial-issuance
limitations above remain; this is not a numeric confidence guarantee or approval
to close the complete ticket.

Refresh applied: the startup-readiness learning now explicitly excludes Redis
availability, and the recommendation boundary pattern points to the new bounded
retry-horizon learning. Keep, no rewrite: the source-neutral history learning
still describes accepted facts correctly. The new learning overlaps its playback
area and the boundary pattern but addresses a distinct transport failure, so
neither older document is consolidated or deleted. The root agent guide already
describes how and when to search `docs/solutions/`; no instruction-file change or
additional recommended documentation edit is needed. All changes remain local.

## Release continuation

The continuation retains the fact recovery contract and applies the same 1/8-second
jittered waits to three exact-nonce claim attempts, with unmount cleanup. Initial
context issuance is deliberately single-attempt: its server-generated binding is
not idempotent under a lost response. No schema or session/privacy contract changes.

Mandatory GraphQL admission now bounds each RedisStore operation at 500ms and checks
the request abort signal and a monotonic one-second admission deadline before
resolver execution. At most 1024 wire operations remain unresolved per process;
timed-out operations retain their slot until actual settlement. Production never
uses the in-memory fallback. This is pre-execution protection, not cancellation of
an already-running business transaction. Late limiter SETs may still update buckets.

Production health retains preload/import gates and adds a shared 500ms Redis PING
probe. A stalled probe cannot accumulate further wire commands. Restart and silent
stall controls now return 503, and readiness returns to 200 after dependency recovery.

Local verification: 182 Web tests and 95 Admin tests pass, including get/set stalls,
late settlement, cancellation, concurrent admission, pending-capacity recovery,
health failure/recovery, exact-nonce pacing and unmount. Seven real Redis/Postgres
HTTP scenarios pass. A 100ms stall succeeds; rejected stalled admission has zero
resolver calls and zero facts after Redis drains, then an explicit retry accepts
one fact. A separate post-commit socket-loss replay still retains exactly one fact.

Review uses sequential main-thread Compound Engineering lenses per AGENTS.md, not
independent agents. Shared timeout behavior, bounded outstanding work, unchanged
keys/identities, replay semantics, terminal behavior, and timer cleanup were checked.
No blocking implementation findings remain. Browser/release results will be recorded
after running them. Full deployed Watch/Mux/auth fault injection, context issuance
idempotency, timestamp attribution and installed-monitoring gates remain outside
this bounded fix; feat-464 stays in progress.

### Final local verification

The complete pre-sync suites pass: Admin 7,355 tests (337 skipped, one todo), Web
4,513 tests (10 skipped, one todo). Current main merged without conflicts; the
38 focused admission/readiness regressions pass again after sync. CI verifies the
combined tree. Skipped dependency suites are not credited as passes; the seven-case
owned Redis/Postgres fixture was run explicitly and passed separately.

The [release browser artifact](../validation/watch-intermittent-evidence-20260923/browser-release.json)
records 14 real Chrome/HTTP cases. Baseline retires facts at 308ms and claims at
507ms during an eight-second outage; candidate accepts identical facts at 10,206ms
and the identical claim at 9,733ms, then sends its two pending facts once. Five
paired healthy controls preserve one claim and one fact request. Gzip grows 200
bytes. Idle-run median mount/DCL is 27.8/28.1ms baseline versus 29.5/29.8ms candidate.
An earlier run overlapped full unit suites and had 111.1/132.4ms mount medians; it
is retained locally as a contention control, not used to claim improved loading.
These small component measurements show no material added startup work, not a full
Watch loading benchmark. No production fault injection was performed.
