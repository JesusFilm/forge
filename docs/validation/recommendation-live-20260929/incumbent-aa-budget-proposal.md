# Incumbent A/A workload budget: bounded planning proposal, still NO-GO

Prepared 2026-09-29 from integration checkout `/home/nisal/.codex/worktrees/recommendation-live-integration-20260929/forge`, HEAD `0a70712399bf99e10d88477b98cc34c8ababcc6b`. This is analysis only: no new test, production query, enrollment, protocol write, or activation was performed. It does not replace the storage owner's admission decision.

**Conclusion:** the current implementation supplies a fixed enrollment window, deterministic fractional admission, and per-request limits. It supplies neither a maximum assignment count nor a maximum number of requests per assigned profile. A complete numerical storage/transient budget cannot be established from the existing receipts. The smallest legal fraction below is a concrete lower-workload proposal for review, but the available historical traffic suggests it would be statistically unproductive. Do not activate it merely because its fraction is small.

## 1. Concrete minimum protocol envelope to price, not to activate

| Field                     | Fixed planning value                                                                                                                                  |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Mode / comparison         | `calibration` / `incumbent-aa`                                                                                                                        |
| Control                   | `hybrid-profile-viewing-mode-v1`, exact immutable manifest digest resolved before preparation                                                         |
| Challenger                | `hybrid-profile-viewing-mode-aa-v1`, exact immutable digest from the current registry                                                                 |
| Cohort                    | `human-en-english-durable-client-cowatch-mmr-v1`                                                                                                      |
| Graph / composition       | Both null; no graph build, shadow runs, MMR observation, or co-watch trial qualification                                                              |
| Admission                 | `admissionBps=2`: 0.02% of otherwise eligible profile-generation units                                                                                |
| Arm split                 | Independent deterministic 50/50; nominal 0.01% per arm; pointer challenger ceiling 1 basis point                                                      |
| Enrollment                | Start inclusive `2026-09-30T00:00:00.000Z`; end exclusive `2026-10-02T00:00:00.000Z`                                                                  |
| Follow-up                 | Each enrolled unit's own 24 hours; final possible follow-up ends before `2026-10-03T00:00:00.000Z`                                                    |
| Earliest mature analysis  | `2026-10-03T06:00:00.000Z` (end + 24h + 6h)                                                                                                           |
| Study / assignment expiry | Proposed `2026-10-05T00:00:00.000Z`; no extension after preparation                                                                                   |
| Sample parameter          | `plannedAssignmentsPerArm=200`, **evaluation minimum only**                                                                                           |
| Other protocol fields     | `minimumUsefulDelta=null`, `calibrationEvaluationId=null`, `evidenceMaxAgeHours=24`, fixed-window stopping rule                                       |
| Operator operations       | One prepare, one reviewed readiness receipt, one activation, one mature outcome receipt and evaluation; no automatic repeated evaluation or extension |

The start must still be in the future when prepared, with fresh readiness valid through start. If release/admission misses this start, do not silently slide dates: leave inactive and price/review a replacement proposal. The short study expiry leaves only 42 hours after earliest mature analysis. It is deliberately not a promise that a later efficacy study can fit; later use must independently fit the retained calibration authority and all dependencies. No permanent/default authorization follows from calibration.

The protocol minimum is 2 complete UTC days; maximum enrollment is 14 days. Expiry must be strictly later than end + 30h and strictly before start + 29 days. These dates satisfy that shape. Sources: `experiment/study-protocol.ts:93-136`, `experiment/usefulness-offline.ts:80-104` (paths below are relative to `apps/admin/src/services/recommendations/`).

### Why the smallest legal fraction is not yet a useful calibration

The existing `20260929T0103-compact-trace-rate/growth.json` receipt recorded **8,420 candidate runs in the preceding 24 hours**, all compact, with the 20,001-row query sentinel not reached. This is a historical all-traffic observation, not a current eligible-profile arrival rate. It omits arrivals that never persisted a candidate run.

As an explicitly illustrative assumption only, if that issued-run rate repeated for two days and every run were a distinct eligible profile generation, it would give 16,840 observed units. At 2 bps, expected assignments would be 3.368 total, or 1.684 per arm. Achieving merely an expectation of 200 per arm at that fraction requires 2,000,000 eligible distinct units over the two days. In the same optimistic historical illustration, 238 bps would be the first even whole-bps fraction giving an expectation of at least 200 per arm; actual eligibility, repeat visits, randomness, and the positive-outcome floor would require a separate assessment. **238 bps is not a proposed or approved activation rate.**

Calibration additionally requires at least 20 nonzero-outcome units per arm, mature and healthy original denominators, and guardrails. Sample expectations do not guarantee those conditions. After obtaining usable cohort rates, choose and freeze a useful fraction/dates in a new review before preparation; do not seek a favorable assignment hash by trying identities, increase exposure mid-study, or extend a sparse run. Evidence: `experiment/usefulness-offline.ts:149-169`.

## 2. What is actually enforced

| Enforced contract                                                                                                                                   | What it does not bound                                                                                                                                               |
| --------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Admission hash below `admissionBps/10000`, then independent arm hash                                                                                | Not an exact traffic percentage, number of units, bytes, or request rate. Heavy repeat visitors are clustered within assigned units.                                 |
| Unique `(experiment_id, unit_digest, generation)` assignment and profile privacy-generation validation                                              | One assignment for that unit in that experiment generation, not a global person cap; new privacy generations are distinct units.                                     |
| Enrollment end; assignment's own 24h follow-up; active authority rechecked at issuance                                                              | A user can make multiple requests during follow-up; no request-count cap per assignment was found.                                                                   |
| One active usefulness study accepted by routing (`take: 2`, require exactly one); activation rejects overlapping follow-up                          | No independent serving concurrency allowance or study-owned database pool.                                                                                           |
| 64 nominations; 6 response items; 64 KiB response; evidence batch <=16 events/8 KiB; <=128 facts per episode                                        | These do not bound total calls, retries, audit rows, outcome revisions, JSON metadata bytes, or an entire cohort. Response bytes are not trace-storage bytes.        |
| Complete delivery budget 1,500ms; remaining-time DB transaction/statement limits                                                                    | Not a host RSS or total fleet concurrency cap. Successful commit acknowledgement is deliberately not raced against an extra timeout.                                 |
| Usefulness extraction selects at most 100,001 assignments and refuses above 100,000; 15s SQL/2s lock, 20s transaction/maxWait 2s                    | This is an analysis refusal threshold, **not enrollment admission**. Per-assignment descendants and subsequent dependency-expiry scan are not row-capped by 100,000. |
| Raw request expiry 29 days; intended propagation <=24h/hard ceiling 30 days                                                                         | Not proof that loaded retention keeps up or that DELETE returns filesystem bytes.                                                                                    |
| Retention defaults 500 selected roots, accepted max batch 5,000; request deletion chunks 50; 5s shared phase deadline, advisory phase serialization | Not a 500-total-descendant-row cap. Cascades, request-link updates, index/WAL work, and some aggregate deletes have different fanout.                                |

`plannedAssignmentsPerArm` is parsed in [200, 50,000] and consumed by evaluation, not checked before assignment insertion. Assignment implementation: `experiment/assignment.ts:172-208,263-369`; routing/profile row lock: `experiment/usefulness-routing.ts:24-76`; delivery enrollment predicate: `delivery.service.ts:510-547`; constants: `contracts.ts:26-37`, `candidate.ts:18`; transaction behavior: `delivery-runtime.ts:143-217`.

The actual pool configuration is main `max=10` / connection establishment timeout 20s, sync `max=5` / 60s, **per process/client configuration** (`apps/admin/src/db/prisma-pool-config.ts`). It is not a cluster-wide limit, not an A/A pool allocation, and not evidence of spare connections. Replica/process count, competing traffic, queue time, and rollback/commit settlement still need current measurement.

## 3. Incremental work compared with ordinary incumbent delivery

Both A/A arms execute the same incumbent retrieval/ranking/viewing-mode policy. There is no second recommendation slate or co-watch/MMR retrieval. Ordinary requests already persist request/items, candidate trace, personalization decision, delivery audit, and accepted render/impression/selection/playback/outcome/eligibility data. Do not charge all of that as newly created by A/A; also do not assume its byte/call cost or demand is unchanged without measurement.

| Trigger                                                                                                        | Incremental work to account for                                                                                                                                                                                                                                                                                                                                                                                            |
| -------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Study configured and a human English/en request carries a profile token, including cold/ineligible projections | Existing study discovery now finds a study; profile `FOR UPDATE`, experiment/pointer/profile/assignment reads and protocol/admission validation run even if that viewer is ultimately unadmitted. Thus the read/lock budget is driven by routing-path traffic, not just the 0.02% sample.                                                                                                                                  |
| Newly admitted unit                                                                                            | One assignment INSERT plus assignment indexes/FKs; accounting trigger increments `study.enrolled_count` and `privacy_revision` in a shared study row; authority checks before transaction completion. Assignment can persist even if later delivery fails, and must remain in the denominator.                                                                                                                             |
| Assigned request, including operational fallback / older-tab follow-up                                         | Active-authority read transaction and final profile/assignment/experiment/pointer/approval/study locks and revalidation; non-null request assignment FK/index entry, changed manifest/bypass metadata. Base request, items, candidate trace, and decision still exist; marginal bytes require comparison.                                                                                                                  |
| Accepted eligible impression                                                                                   | Up to one exposure row per served item, enforced by unique item key; indexes/FKs and source-fence work. Thus exposure rows <=6 times issued assigned requests on the current six-item path. Duplicate attempts still cost reads/uniqueness work. Promotion first-exposure event is deduplicated per pointer generation, but the attempt/read occurs on new exposures.                                                      |
| Study-linked request/evidence mutations                                                                        | Migration 0107 source-fence trigger performs targeted lookup and shared advisory study lock. **It does not increment the epoch on every request before evaluation**: source epoch UPDATE is conditional on a current unsuperseded evaluation at the current epoch. After authority publication, a relevant change can revoke it by incrementing the epoch. Assignment and profile accounting updates have their own rules. |
| Preparation/activation/analysis                                                                                | Experiment + study; readiness/outcome evidence JSON; possibly one approval; pointer/experiment/study updates; activation/first-exposure events; one evaluation run, experiment evaluation and study-evaluation authority; publication epoch update. Operation IDs provide replay identity, not permission to perform unlimited new operations.                                                                             |
| Privacy reset/erase and expiry                                                                                 | Assignment fences/deletes and accounting; exposure cascades; request assignment FK `SET NULL` updates; index/dead-tuple/WAL and dependent-trigger work. These costs persist after enrollment closes.                                                                                                                                                                                                                       |

Sources: `delivery.service.ts:1098-1322`; `evidence.service.ts:348-405`; `experiment/active-study-authority.ts:47-196`; migration `0107_recommendation_governed_study/migration.sql:78-180`; `promotion/service.ts:816-860`; `experiment/study-service.ts:107-143,343-416,633-709`.

### Retention and stop costs that cannot be omitted

- Assignment expiry is min(study expiry, assigned-at + 29d). Proposed assignment/study expiry is October 5; deletion also cascades exposure rows and clears request assignment links. Exposures nevertheless carry the request's original expiry, so do not count early cascade reclamation until successful retention is demonstrated.
- Request-root raw rows retain their ordinary 29-day lifetime. Last possible associated request is before October 3 00:00 UTC; its ordinary expiry is before November 1 00:00, and intended propagation ceiling before November 2 00:00. Existing ordinary traffic continues beyond all study dates. Study expiry does not purge request roots.
- Newly created promotion approval and event audit records use **2,555-day** expiry, not the short study expiry. Evaluation/study rows follow governed expiry. Retention run records last 90 days; ordinary scheduler/workflow audit overhead and any additional catch-up activity must also be counted.
- Normal `endsAt` closes enrollment without interrupting already assigned 24h follow-up. An early emergency stop changes analysis validity; retain the original denominator and interruption evidence.
- Supported emergency action is authenticated `POST /api/recommendations/promotion`, `action=set_kill_switch`, current `expectedPointerGeneration`, `enabled=true`, bounded reason. This is **not a constant-cost flip**: in the same transaction it fences active assignments, fences pending runs, increments experiment generation, and inserts up to one fence for each retained assigned request. No per-call cohort row limit is applied. Pointer change only becomes visible when that transaction commits. Budget its worst observed fanout, lock time, and WAL before relying on it as the storage brake. Source: `promotion/service.ts:647-741`, `promotion/workflow.ts:38-151`.
- Current retention scheduler targets 10:30 UTC daily with a 60s catch-up continuation; that configuration is not measured throughput. `retention/job.ts:18-26,90-111`; `retention.service.ts:19-26,198-249,692-737`. No loaded retention-cycle capacity is established by empty/local correctness tests.

## 4. Fill-in budget ledger and present measurement gaps

Use actual counts and measured byte costs, keeping normal baseline and incremental A/A separate:

- `U`: distinct eligible profile-generation arrivals in the frozen window; `A`: actual admitted assignments. `E[A]=f*U` under the deterministic uniform-hash model, **not** `A<=f*U`. The deterministic upper bound is `A<=U` for those eligible units; no useful absolute `U` bound is currently established.
- `R_gate`: all attempts reaching configured assignment routing, including unadmitted viewers; `D`: persisted assigned requests during their follow-up; `I`: unique assigned eligible impressions/exposures (`I<=6*D` for successful current-path issued requests). Include failed/orphan-assignment attempts and retries separately.
- `B_retained_incremental = A*b_assignment + I*b_exposure + D*delta_b_request_metadata + B_governance + B_stop_fences + B_index/deadtuple_headroom`. `b_*` must include relevant heap/index/TOAST allocation and lifecycle updates rather than only serialized bytes. Do not add the whole incumbent trace twice. Any measured incremental demand/trace-format change adds a separate term.
- `W_incremental` must cover assignment/accounting, exposure inserts, conditional authority revocation, governance, emergency fences, privacy operations, `SET NULL`, cascades, vacuum/checkpoint effects. WAL **generated** is not simultaneous WAL-directory allocation; no assumed one-byte-per-row ratio is valid.
- `peak_storage = current_used + baseline_growth_until_cleanup + peak_retained_increment + concurrently_resident_WAL/temp + maintenance_headroom`. Compare to the owner's still-current reserve after accounting for other workloads. No reclaim credit until evidenced.
- Serving transient budget requires peak `R_gate` and assigned-request concurrency, incremental transaction/query/lock latency, process RSS and event-loop/GC behavior. The separate isolated co-watch runner's 1 GiB/45s envelope does **not** constrain live A/A requests or DB server execution.
- Analysis transient budget requires observed `A`, request/episode/fact/revision fanout, query plans, SQL temp, DB memory, application snapshot heap, and actual evaluation/stop/retention time and WAL. A/A skips efficacy bootstrap computation, but still extracts the full reconciled cohort and all dependency-expiry sources.

Existing evidence and its limits:

1. `docs/validation/recommendation-live-20260929/local-trace-size.json`: a synthetic 64-candidate incumbent produces 326 stages and 228,894 serialized trace bytes; serialization p95 3.62ms. It is one payload distribution, not a response-size bound or full request memory measurement.
2. `local-trace-storage.json`: 100 payload-only incumbent rows consumed 4,194,304 relation bytes including TOAST; stored column 38,329 bytes/row. It omits request/items, principal indexes, telemetry, and attributed WAL. The co-watch/MMR payload cases are not A/A overhead.
3. Historical compact production receipt at `20260929T0103-compact-trace-rate/growth.json`: 8,420 runs/day, mean 122.39 observations/run, mean stored payload 13,292.74 bytes. These are historical all-traffic means, not current exact cohort traffic, worst-case payload, or marginal study bytes.
4. Storage-owner `20260929T0616-integration-capacity-review/decision.json`: measured available 10,190,995,456 bytes, 5,190,995,456 above its 5 GB reserve; no complete transition budget or loaded retention proof. Its growth receipt has differing historical positive rates about 0.87–1.21 GB/day and a short negative interval. Those are neither a new allocation allowance nor a stable future forecast. Do not convert the nominal volume into current free space or assume the retained legacy trace allocation will shrink on DELETE.
5. `local-cowatch-envelope-storage.json` is graph storage only. It contributes no direct graph cost to this graph-free A/A and proves neither A/A write amplification nor live concurrency capacity.

**Missing numerical inputs:** current complete attempted-request rate and failures (provider traffic counter previously failed); capability-equipped eligible profile-generation counts; English-audio/human/both-source eligibility coverage; profile repeat-request distribution and peak rate; nonzero outcome rate; deployed trace format and byte tails; assignment/exposure/governance/index/update/fence WAL and allocation; per-enrollment profile/study lock contention; active fleet/pool occupancy; stop completion latency/fanout; and loaded expiry/erasure/retention throughput with real filesystem evidence. No complete numerical clearance is possible until those are supplied. If capacity policy requires a strict maximum `A` or byte ceiling rather than a measured rate envelope and emergency stop, the current code cannot meet it; a reviewed admission-cap change would be separate work, not an assumed existing feature.

## 5. Smallest useful next population/rate query proposal — DO NOT EXECUTE

One preapproved, immutable **closed 24h** window is the smallest proposed query yielding both an arrival proxy and repeat-visit distribution useful for a two-day protocol. A short five-minute count can measure instantaneous requests but cannot price distinct profile enrollment. Reuse the already demonstrated 20,001-root sentinel shape; do not scan profiles or all retained history. No automatic retries, date changes, partitioning into unlimited pages, or wider windows on overflow.

Proposed admission: one read-only connection; `BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY`; session-local statement timeout 5s, lock timeout 1s, transaction timeout 10s on verified PG18; `work_mem=4MB` if allowed. These are **proposed query controls**, not measured success guarantees. Reject on timeout/cancel, unavailable index, excessive plan, or 20,001 roots. Set the dates externally to one exact closed UTC interval and bind parameters; never return identifiers.

Before executing, inspect named index metadata and run plain `EXPLAIN (FORMAT JSON)` for the exact constants, **without ANALYZE**. Require a bounded range access through `recommendation_request_created_idx(created_at,id)` before downstream work, and indexed unique lookups for personalization `request_id`, candidate-run `request_id`, and projection-generation `id`. Refuse root/descendant sequential scans or an unbounded pre-limit sort. Do not force a bad plan with `enable_seqscan=off`. LIMIT bounds returned live roots, not physically visited MVCC/dead entries; database admission/time limits still apply.

```sql
-- Shape only. $1/$2 must be fixed and exactly 24 hours apart.
WITH roots AS MATERIALIZED (
  SELECT id, created_at, locale, expected_item_count, state, result
  FROM recommendation_request
  WHERE created_at >= $1::timestamptz AND created_at < $2::timestamptz
  ORDER BY created_at, id
  LIMIT 20001
), guard AS MATERIALIZED (
  SELECT count(*) AS n FROM roots
), observations AS MATERIALIZED (
  SELECT r.created_at, r.locale, r.expected_item_count, r.state, r.result,
         d.projection_scope, d.interest_count,
         g.profile_id, g.privacy_generation,
         c.id IS NOT NULL AS has_candidate_run,
         c.trace_format_version,
         COALESCE(pg_column_size(c.trace_payload), 0) AS stored_trace_column_bytes
  FROM roots r
  CROSS JOIN guard
  LEFT JOIN recommendation_personalization_decision d ON d.request_id = r.id
  LEFT JOIN recommendation_profile_projection_generation g
    ON g.id = d.projection_generation_id
  LEFT JOIN recommendation_candidate_run c ON c.request_id = r.id
  WHERE guard.n <= 20000
), proxy_units AS MATERIALIZED (
  SELECT profile_id, privacy_generation, count(*) AS requests
  FROM observations
  WHERE locale = 'en' AND projection_scope = 'durable'
    AND interest_count > 0 AND profile_id IS NOT NULL
    AND privacy_generation IS NOT NULL
  GROUP BY profile_id, privacy_generation
)
SELECT guard.n AS root_count_or_lower_bound,
       guard.n > 20000 AS refuse_population_overflow,
       CASE WHEN guard.n <= 20000
         THEN (SELECT count(*) FROM observations WHERE locale = 'en') END
         AS english_locale_requests,
       CASE WHEN guard.n <= 20000
         THEN (SELECT count(*) FROM observations
               WHERE locale = 'en' AND projection_scope = 'durable'
                 AND interest_count > 0) END AS durable_positive_interest_requests,
       CASE WHEN guard.n <= 20000
         THEN (SELECT count(*) FROM proxy_units) END AS retained_proxy_units,
       CASE WHEN guard.n <= 20000
         THEN (SELECT count(*) FROM observations
               WHERE projection_scope = 'durable'
                 AND (profile_id IS NULL OR privacy_generation IS NULL)) END
         AS unresolved_durable_lineage_requests,
       (SELECT max(requests) FROM proxy_units) AS max_observed_requests_per_proxy_unit,
       (SELECT percentile_disc(0.95) WITHIN GROUP (ORDER BY requests)
          FROM proxy_units) AS p95_observed_requests_per_proxy_unit,
       (SELECT sum(stored_trace_column_bytes) FROM observations)
         AS stored_trace_column_bytes_in_window,
       (SELECT max(stored_trace_column_bytes) FROM observations)
         AS maximum_observed_trace_column_bytes,
       (SELECT count(*) FROM observations WHERE NOT has_candidate_run)
         AS requests_missing_candidate_run,
       (SELECT count(*) FROM observations WHERE trace_format_version IS NULL)
         AS null_trace_format_requests
FROM guard;
```

The result is a **retained historical proxy**, not an exact enrollment count: `clientDeliveryContract`, request actor/human classification, and request English-audio context are not all persisted as direct request columns, and erased/expired projection lineage cannot be recreated. Do not convert unresolved lineage to anonymous eligible units. Healthy semantic/profile nominations are request-dependent; this query deliberately does not deserialize private trace payloads to invent eligibility. `pg_column_size` covers the trace datum, not table/index/WAL allocation.

For total traffic budgeting use all-root counts and separate complete attempt/failure counters; the assignment-routing predicate checks a profile token before projection eligibility, so cold or ineligible projections still contribute discovery/profile-lookup work; for cohort feasibility use the proxy only with explicitly measured capability/eligibility coverage. Current-state profile checks can be added as bounded PK lookups if separately approved, but cannot reconstruct historical consent or missing capabilities. If existing telemetry cannot supply capability-at-enrollment coverage, treat it as unknown; adding that measurement is a separate reviewed change. Extending to an exact 48h distinct cohort needs its own fixed root/work budget and owner review, not two summed daily distinct counts advertised as exact.

The same bounded root set could later support <=7-row-per-request item/impression probes to measure audio/exposure fanout, with a sentinel refusal above the service's six-item contract and verified request indexes. That is a separate expansion, not part of the minimal query above. Actual incremental A/A row/WAL/stop costs need a separately authorized representative fixture or a reviewed measurement design; they cannot be derived by dividing an unrelated graph WAL total by its row count.

## 6. Gate sequence and owner decision needed next

1. Finish normal code release and deployment identity checks; keep study inactive.
2. Obtain approval for the single bounded aggregate population/rate query and repair the missing complete traffic counters. No query is authorized by this document.
3. Reassess whether a useful fixed A/A fraction/window can meet the 200/arm and 20-positive/arm floors. Freeze the chosen protocol once; reject the minimum proposal if it is merely an inconclusive traffic trickle.
4. Fill every incremental and transient budget term, including study-wide discovery cost, emergency fencing, expiry cascades, baseline growth through cleanup, and retained audit records. Obtain current capacity admission and prove loaded retention can keep up. Leave NO-GO if any material term remains unknown.
5. Agree an operator/monitor and explicit stop thresholds before activation. Any polling adds its own read load; a polling/human-response promise is not a hard code cap. Measure stop completion rather than assuming immediate visibility. Normal window closure remains the only predeclared automatic enrollment stop in this proposal.
6. Only an independently approved activation can enroll. Mature real outcomes, complete denominator, retained current authority, real guardrails and loaded-retention evidence remain necessary for subsequent gates. Permanent/default behavior is a later decision and cannot be inferred from this plan, local tests, or an A/A PASS.
