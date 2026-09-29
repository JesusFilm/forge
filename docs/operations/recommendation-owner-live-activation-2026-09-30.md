# Owner-approved co-watch and MMR activation

The owner approved direct activation without a trial. This release implements
that decision without creating study assignments, shadow/composition PASS records,
calibration or efficacy evidence. Usefulness remains unmeasured. The wider
unimplemented ranking roadmap is outside this release.

**Current disposition: owner-approved co-watch and implemented MMR are enabled;
direct natural execution is not yet observed.**
Authenticated Admin recorded activation at **September 29 23:00:26.512 UTC**
(September 30 12:00:26 NZDT), then a reload confirmed pointer generation **4**,
stage **OWNER_APPROVED**, and the exact current release. No trial was created.
The initial owner release expires **September 30 22:59:20.343 UTC** (October 1
11:59:20 NZDT); refresh is manual and expiry serves the compatible incumbent.
Causal usefulness remains unmeasured. Natural issuance is reported separately
below; an active pointer alone does not prove viewer exposure or improvement.
Earlier pending/refused sections are chronological evidence, superseded by this
current disposition and the activation receipt below.

[PR #2478](https://github.com/JesusFilm/forge/pull/2478) carries the direct path
through the normal release flow. Its initial CI run passed build, unit tests,
lint, formatting and CodeQL. Native regression tests exposed historical fixture
migration lists that omitted 0111–0112; the missing columns also caused two
concurrency fixtures to time out before reaching their expected locks. Nine
runtime-backed fixtures now share the complete recommendation migration chain;
historical upgrade tests retain their fixed chains. All seven original failures
passed locally. The repaired Admin/profile scope passed 18 checks and the later
retriever scope passed nine (one intentional Redis drill skipped), with no runtime
or timeout changes. All 25 checks were successful or intentionally skipped
at reviewed head `d0bb991969f01adf669ce6d1af3fff64864970af`, including the CI gate.
The PR merged normally as `85656b946c7519cb39d501d44ce6d1d998ec7d9b`.

## September 29 production deployment and operator repair

At 21:23 UTC, both Admin HTTP and worker ran `85656b946` and returned health 200;
Watch remained healthy at compatible revision `0a707123`. A later storage revision
was already building, so this is a point-in-time observation. The 21:20 read-only
catalog check passed all 17 checks for exact migrations 0111/0112, their constraints,
triggers and manifest. It found no owner release and pointer generation 1/control.
The deployed CLI probe matched all 16 pinned source files, found the private
database connection and reported approximately 23 GB of available cgroup memory.
Neither probe published a graph or activated authority. Receipts:
[runtime health](../validation/recommendation-owner-live-20260930/production-runtime-health-20260929T2123.json),
[owner migrations](../validation/recommendation-owner-live-20260930/production-owner-migrations-20260929T2120.json),
[CLI probe](../validation/recommendation-owner-live-20260930/production-deployed-cli-probe-20260929T2120.json).

The supported emergency-stop action opened a native browser confirmation that
automation could neither inspect nor accept, and the owner could not see. A fresh
authenticated page still showed generation 1/control and no stop audit. Normal
reload recovered the original tab; temporary recovery tabs were closed. Replace
the native prompt with an explicit in-page Confirm/Cancel panel while preserving
the action, generation, authentication and CSRF contract. No committed stop, graph
publication or owner activation is claimed from those interactions.

The replacement passed 20 focused component tests, scoped lint, a fresh full
Admin typecheck and independent review. An
isolated local browser fixture at 1,100 and 390 pixels showed the confirmation,
focused Cancel, produced no initial or cancelled POST and exactly one confirmed
POST, with no horizontal overflow. Fifty server-render samples per version had
median 0.525/0.548 ms and p95 0.762/0.781 ms before/after; initial HTML grew by
14 bytes. These component measurements are not full-page production Web Vitals.
See the [local receipt](../validation/recommendation-owner-live-20260930/local-confirmation-browser.json),
[desktop](../validation/recommendation-owner-live-20260930/confirmation-desktop.png)
and [mobile](../validation/recommendation-owner-live-20260930/confirmation-mobile.png)
screenshots.

A separate bounded read at 21:25 UTC found 8,611,950,592 bytes free, 1,073,741,824
bytes of resident WAL, no lock waiters or replication slots, one transaction older
than 30 seconds and 7,265 requests in the prior 24 hours (cap not reached). There
were zero graph generations and owner releases. The latest completed retention
run had deleted zero roots; no expired request was found. Charging measured graph,
temporary and extra WAL reserves, a concurrent margin and the matched-fixture
serving increment to every request leaves 8.096 GB at the projected peak and
approximately 6.25 days at the previous ordinary growth rate. This satisfies the
5 GB peak floor but not the prior seven-day projection. At that time publication remained pending
storage reconciliation; no future purge, index-drop or packed-format savings were
credited. The serving fixture is not a universal upper bound. See the
[capacity observation](../validation/recommendation-owner-live-20260930/production-capacity-observation-20260929T2125.json)
and [explicit calculation](../validation/recommendation-owner-live-20260930/production-capacity-disposition-20260929T2125.json).

## September 29 final deployment and canonical-origin refusal

[PR #2488](https://github.com/JesusFilm/forge/pull/2488) merged normally as
`3abde2aa564e30c16631979b5d9403fc4c265403` after all 25 checks completed
successfully or intentionally skipped/neutral, including the successful CI gate.
At 22:02 UTC, Admin HTTP and worker both ran that exact revision, the earlier
workers were absent from the active inventory, and all three services returned
health 200. Watch remained at `0a707123`. The deployed CLI probe matched all
16 source files and found the private database host and over 22 GB of cgroup
headroom. Separate metadata-only checks passed exact migrations 0116, 0117 and
0118, including shared-vector reader dependencies and immutable served payload
constraints. None of these probes imported the publisher or changed authority.

Receipts: [runtime health](../validation/recommendation-owner-live-20260930/production-runtime-health-20260929T2202.json),
[CLI probe](../validation/recommendation-owner-live-20260930/production-deployed-cli-probe-20260929T2202.json),
[0116 metadata](../validation/recommendation-owner-live-20260930/production-profile-vector-0116-20260929T2202.json),
[0117/0118 metadata](../validation/recommendation-owner-live-20260930/production-storage-catalog-0117-0118-20260929T2202.json).

The 21:47 [capacity observation](../validation/recommendation-owner-live-20260930/production-capacity-observation-20260929T2147.json)
found 10,658,566,144 bytes free, no lock waiters, long transactions or replication
slots, and 7,194 requests over the previous day. Charging the same measured
reserves leaves 10.142 GB at the projected peak and 7.835 days of conservative
runway. The [calculation](../validation/recommendation-owner-live-20260930/production-capacity-disposition-20260929T2147.json)
credits no future savings and makes no storage-owner approval claim. This restores
the declared capacity targets for that observation; repeat the bounded admission
near actual publication if deployment delays make it stale.

After normal OAuth refresh, the in-page stop confirmation displayed and submitted
correctly. The page then reported a role refusal, with generation 1/control and
no new stop audit. An independent unauthenticated POST with canonical HTTPS
Origin, the required custom CSRF header, JSON content type and empty body returned
`403 csrf_failed` before authentication. The endpoint compared Origin to its
transport-derived request URL; the client reported every 403 as permission denial.
Use the existing configured canonical Admin origin while retaining all other
CSRF, permission and operator guards. Do not trust forwarded headers or grant
additional access. The [sanitized refusal receipt](../validation/recommendation-owner-live-20260930/production-promotion-csrf-refusal.json)
is not graph publication, a committed stop or an owner activation.

The repair passed 56 focused route/component/origin tests, a fresh nonincremental
full Admin typecheck, scoped lint and independent review. Initial markup is byte-identical at 1,499 bytes and component
tests still observe zero initial fetches. The isolated minified component bundle
grows by 664 bytes (170 bytes gzip), with no new dependency; the added response
decoder runs only after a submitted mutation returns 403. See the
[bounded load comparison](../validation/recommendation-owner-live-20260930/local-origin-repair-performance.json).

## September 29 reviewed origin repair and stop footprint

[PR #2494](https://github.com/JesusFilm/forge/pull/2494) merged normally at
22:27:41 UTC as `4455fa50e18902d326b64ec4abcd8285ab0574de`, with all 26 checks
complete and the CI gate successful at reviewed head
`b884eb06b3895e84c2dfbea54950bd7ae10167d6`. This section records the release
decision; the production cutover receipt below determines actual live status.

Before using emergency stop to close the bootstrap A/A row, a bounded read at
22:16 UTC verified the exact stop selector matched only `semantic-aa-v1`. The
pointer was generation 1/control without an owner release. There were **zero
assignments and zero linked retained requests**, with neither cap reached. Thus
there were no existing bootstrap request roots to fence at that observation;
CONTROL already prevents new A/A enrollment. The native zero-assignment stop/clear
fixture covers this observed root population. Pending evaluation/promotion run
cost, mutation latency and concurrent lock changes were not measured by the read.
Any unknown acknowledgement still requires current-state reconciliation before
retry. See the [stop footprint](../validation/recommendation-owner-live-20260930/production-stop-footprint-20260929T2216.json).

A nonempty stop could have changed the co-watch source population by fencing
retained requests. The complete zero-root observation removed that specific
concern, so no second source preflight was dispatched merely for stop/clear. The
publisher must still match the exact admitted generation and count/byte bounds
before any inserts; natural source changes may legitimately refuse publication.

## September 29 supported cutover and exact-source refusal

At 22:41 UTC, both Admin processes ran `4455fa50` with health 200 and all older
processes drained; compatible Watch remained healthy. The deployed CLI matched
all 16 pinned files and dependencies, used the private database host and had more
than 21 GB of memory headroom. The exact 0119 migration ledger checksum passed
with no unfinished migration. An unauthenticated canonical-origin POST now reached
`401 authentication_required`; the attacker-origin control remained `403 csrf_failed`.

After normal OAuth refresh, supported Admin stop committed generation 2 at
**22:42:21.303 UTC**. Clearing the hold committed generation 3/control at
**22:42:51.890 UTC**. Both immutable audit entries were visible in Admin. This
closed the empty bootstrap authority without reviving it or any old release.
The final capacity read at 22:42:58 UTC found **11,164,520,448 bytes free**, no
lock waiters, long transactions or replication slots, and 7,219 requests in the
prior 24 hours. The unchanged reserves leave 10,648,232,026 bytes at projected
peak and 8.224 days of projected runway; no future savings are credited.

The first explicit publication attempt `d4607158-17c7-4ae8-8e47-d32882971995`
finished at 22:43:47 UTC with `admission_refused` /
`publication_admission_generation_changed`, before inserts. All aggregate counts
were unchanged, but the exact generation was now
`1939c3e3580419d7f9771594a6aa3a65e47299c6cacf4dceeeeda63d23f263bc`.
No graph was published and no activation was attempted. The generation includes
source identities, revisions, current eligibility decisions and viewer ownership;
equal counts do not prove equal inputs. The exact changed fields were not collected.
This demonstrated drift justifies one fresh bounded read of the same fixed window;
it does not permit automatic retry, relaxed bounds or a favorable-window search.

Receipts: [runtime health](../validation/recommendation-owner-live-20260930/production-runtime-health-20260929T2241.json),
[CLI probe](../validation/recommendation-owner-live-20260930/production-deployed-cli-probe-20260929T2242.json),
[0119 ledger](../validation/recommendation-owner-live-20260930/production-migration-ledger-0119-20260929T2242.json),
[origin checks](../validation/recommendation-owner-live-20260930/production-canonical-origin-20260929T2242.json),
[capacity observation](../validation/recommendation-owner-live-20260930/production-capacity-observation-20260929T2243.json),
[publication decision](../validation/recommendation-owner-live-20260930/production-publication-decision-20260929T2243.json),
[refused publication](../validation/recommendation-owner-live-20260930/production-publication-refused-20260929T2243.json).

The single replacement read completed at 22:46:42 UTC through the pinned deployed
read-only CLI. The source window and aggregate counts stayed unchanged; all JSON
widths remained under the original measured ceilings, with 613 supported edges.
Its generation was `aabb668443e4152c03f0052b6f80123595d101a2c10180ce861098a2afdcd98f`.
Independent review confirmed the replacement admission changed only that exact
generation; source bounds and all resource allowances were unchanged.

The second distinct attempt `8ca78d2b-ceee-4909-b073-6348ff1c6f1f` again refused
before inserts at 22:48:17 UTC. Its current generation was
`54be78f2de9afd874ebf56911cb3898a092135d34824b35ca0fd8d533f634145`, with the same
aggregate counts. Neither attempt published a graph. Recurring drift now requires
a focused cause investigation before another publication; repeated hash rebinding
without that investigation is not an accepted execution strategy.

See the [replacement preflight](../validation/recommendation-owner-live-20260930/production-replacement-preflight-20260929T2246.json),
[replacement admission](../validation/recommendation-owner-live-20260930/replacement-publication-admission.json)
and [second refusal](../validation/recommendation-owner-live-20260930/production-publication-refused-20260929T2248.json).

Code investigation found that discovery links last 24 hours, independently of
the fixed seven-day source window. Before a first graph is retained, crossing a
link deadline can change a qualified source's viewer identity from profile to
session without changing aggregate counts. Published durable graph lineage retains
that ownership and does not depend on keeping discovery links alive. Eligibility
reclassification can also change decision identities without changing verdicts;
no exact production cause is inferred from the aggregate refusals alone.

A focused two-clock read-only diagnostic will compare the same current database
snapshot using the earlier and current wall clocks. It returns aggregate component
changes only and cannot reconstruct historical metadata. If this confirms clock
expiry, the bounded operational remedy is one fresh preflight followed immediately
by one exact-generation publication after automatic verification of the unchanged
scope and ceilings. This removes the manual review delay while retaining the
publisher's in-transaction refusal. It does not guarantee stable inputs or permit
retry loops. Capacity and runtime admission remain separate requirements.

At 22:55 UTC, normal storage release [PR #2495](https://github.com/JesusFilm/forge/pull/2495)
had moved both healthy Admin processes to `8ecca9c7`; old processes were drained.
Its only runtime change defaults future served snapshots to the already supported
packed format. All 16 co-watch publication source/dependency pins were identical,
with no new migration or source/authority change. Mixed readers and 0117 had
already passed their exact checks. No future packed-storage savings were credited.
The fresh capacity read found **11,037,495,296 bytes free**, no lock waiters,
long transactions or replication slots, and 7,180 requests/day: 10.521 GB projected
peak free and 8.129 days of runway using the unchanged conservative reserves.

The read-only diagnostic completed at **22:58:33 UTC**. Within the same database
snapshot, moving the clock from 22:46:31 to 22:58:28 changed exactly **three
qualified sources from profile to session identity**, with no eligibility
membership, outcome, decision, weight or session changes. Every population count
was unchanged and repeated builds from identical loaded inputs were deterministic.
Clock expiry therefore demonstrably changes the hash without changing counts.
The earlier-clock hash did not reproduce the retained preflight hash: additional
intervening metadata changes remain unresolved. This is not a reconstructed
historical snapshot or proof that expiry was the sole cause of either refusal.

Independent review and 18 local control-flow tests passed for a one-use wrapper
that calls the unchanged preflight once, verifies complete results against every
original scope/count/byte ceiling, then immediately dispatches the unchanged
publisher once with that exact new fingerprint. It has no retry loop; stale,
truncated, overflowing or uncertain reads never publish. Existing operation claims,
private-host checks, process/transaction deadlines and in-transaction generation
revalidation remain. The reviewed decision was dispatched at 22:59 UTC; its actual
publication receipt below determines the result.

Receipts: [runtime](../validation/recommendation-owner-live-20260930/production-runtime-health-20260929T2255.json),
[capacity](../validation/recommendation-owner-live-20260930/production-capacity-observation-20260929T2255.json),
[calculation](../validation/recommendation-owner-live-20260930/production-capacity-disposition-20260929T2255.json),
[clock diagnostic](../validation/recommendation-owner-live-20260930/production-clock-diagnostic-20260929T2258.json)
and [one-use decision](../validation/recommendation-owner-live-20260930/production-once-batch-decision-20260929T2259.json).

## Successful graph publication and direct activation

The one-use batch completed successfully at **22:59:29 UTC**. Its fresh preflight
and publisher agreed on exact generation
`7a0df065a6562c562ea49809e4db4fd68d3a112729368bcfd0033679ea7270fa`.
The publisher retained **51,313 rows** from the unchanged fixed window: 6,680
sources, 35,632 contributions, 9,000 edges and one generation. The preflight found
613 supported edges; all original count and byte ceilings passed. Publication
was recorded at **22:59:20.343 UTC** through the actual deployed CLI/private DB,
with existing transaction/process limits. The temporary admission file was removed.
The publisher's `no_promotion` / `controlled_evaluation_required_feat_505` remains
its truthful shadow-publication decision; it does not itself grant live authority.
The separate explicit owner-approved path below does that without claiming a PASS.

Authenticated Admin prepared that graph with exact manifest
`hybrid-profile-viewing-mode-cowatch-mmr-owner-live-v1`, binding digest
`af6083ffbe53380d5f5cc16cd2d0c7fb117a5f983f4c8755fd43c241289c30a2`
and expected generation 3. The prepared release deadline was
**2026-09-30T22:59:20.343Z**, earlier than its dependency deadline
**2026-10-21T19:00:53.714Z**. The already approved activation used operation/release
ID `4459344d-202b-4665-aab3-75fa17920c10` exactly once.

The response reconciled **Recorded release: active**. Reloading serving state
showed generation **4 / Owner Approved**, the exact active manifest and release,
no emergency hold, and immutable **Activation Effective / Owner Approved Without
Trial** audit at **23:00:26.512 UTC**. The existing `Not ready` readiness badge and
absence of a retained evaluation refer to the unperformed measured promotion path;
they do not override this separately recorded owner-approved authority. Causal
usefulness remains unmeasured. The supported restore/stop controls remain available;
the native authority/issuance/rollback fixtures cover their direct-release fences.

Receipts: [final preflight](../validation/recommendation-owner-live-20260930/production-final-preflight-20260929T2259.json),
[exact admission](../validation/recommendation-owner-live-20260930/final-publication-admission.json),
[publication](../validation/recommendation-owner-live-20260930/production-graph-publication-20260929T2259.json),
[binding](../validation/recommendation-owner-live-20260930/production-publication-binding-20260929T2259.json)
and [authenticated activation/reload](../validation/recommendation-owner-live-20260930/production-owner-activation-20260929T2300.json).

## First natural issuance observation

One bounded read of retained requests created from activation through
**23:04:08 UTC** found **16 issued requests**, with the 50-root cap not reached.
All had no experiment assignment. **Zero** carried the exact owner release and
direct composer provenance. Three had the shared co-watch/MMR incumbent fallback
marker without owner attribution. Those markers alone do not identify an owner
attempt or establish an owner fallback rate. No expired roots were in the sample;
deleted/unissued requests and older prepared requests are outside its coverage.

This proves the configured active release separately from natural direct execution,
which was not observed in this first window. It does not prove human exposure,
selected co-watch cards or usefulness. Inspect the bounded recorded fallback reasons
to distinguish sparse graph coverage from a demonstrated runtime failure; do not
manufacture viewer traffic or silently reinterpret the empty direct count as PASS.
See the [natural issuance receipt](../validation/recommendation-owner-live-20260930/production-natural-issuance-20260929T2304.json).

The targeted reason read extended that same activation window through **23:10:08
UTC**. It found **38 issued roots**, with the cap not reached and no experiment
assignments. Direct owner provenance remained absent. Of eight shared fallback
markers, **seven reported `composition_required_input_unavailable`** and **one
reported `cowatch_supported_edges_sparse`**; no deadline, source-unavailable,
authority-unavailable or unplayable reason appeared. These markers still lack
release attribution and do not establish an owner-specific attempt rate. See the
[fixed reason aggregates](../validation/recommendation-owner-live-20260930/production-fallback-reasons-20260929T2310.json).

The missing-input reason is a concrete investigation item before closing feat-565.
The structural gate requires source and profile-interest evidence, recent-history
availability, and nonblank themes on every composed item. Failed owner composition
retains the incumbent candidate platform, so historical retained candidate rows
cannot reconstruct which input was missing in that attempted co-watch composition.
Trace the actual adapters and obtain discriminating bounded evidence; do not weaken
the required-input contract or label enabled authority as verified viewer influence.

## Serving and operation contract

The exact manifest is
`hybrid-profile-viewing-mode-cowatch-mmr-owner-live-v1`. It serves the existing
measured human, English/English-audio, active durable-profile cohort with a
published positive-interest projection and `cowatch-mmr-v1` capability. It combines
at most 64 semantic/profile/co-watch nominations, including at most 12 co-watch
nominations, and selects at most six results with the existing source, interest,
theme and recent-history MMR inputs. The complete request deadline remains
1,500 ms.

An immutable owner release binds the exact graph, source window, manifest and
composition configuration. An authenticated Admin operator with permanent-approval
permission and recent authentication prepares and activates through
`/api/recommendations/promotion`; the dashboard exposes the same operations.
Preparation writes no release. Activation uses an expected pointer generation and
binding digest. Keep the original operation UUID after an unknown acknowledgement
and reconcile it through `GET ?ownerOperationId=...`; reconciliation does not
reactivate historical authority. Refresh publishes a new graph and replaces the
release with the same operator contract.

There is no causal trial window. A graph has an ordinary maximum freshness of
24 hours after publication, shortened by earlier dependency expiry. Refresh is
manual in this release; expiry, insufficient graph support or invalid composition
serves the current compatible incumbent. Feat-573 tracks sustainable automatic
refresh. Clearing emergency stop does not revive a revoked release.

Final issuance revalidates the current profile, receipt, projection and exact
bounded source lineage under fail-fast locks. This applies to personalized
incumbent fallback too. Graph/release/pointer checks add direct provenance only
when the direct policy actually executed. Stop advances a monotonic influence
floor, immediately fencing historical direct requests from subsequent learning
without scanning all retained requests. Ordinary refresh preserves valid earlier
influence. First eligible exposure matches the exact release and pointer generation.

## Migration and retention

0111 adds the owner-approved enum stage; 0112 adds the empty release table,
nullable request provenance, pointer/floor metadata, source invalidation and the
inactive manifest registration. Neither migration activates a release. Normal
Prisma deployment was exercised on a fresh disposable PostgreSQL database.
The hot request table receives no new index or validated foreign key; the paired
nullable-column check is `NOT VALID` for existing rows and enforced for writes.
Migration lock/statement budgets are 1/15 seconds.

Release approval metadata records the authenticated operator for the existing
2,555-day promotion audit lifetime. It includes aggregate configuration/source
identity, not copied viewer history. Graph deletion/revision revokes authority;
release tombstones do not extend source retention. Existing request/projection and
raw-source retention applies. No serving-state override or raw production SQL
repair is part of activation.

## Review and local validation

Independent review found and resolved missing final profile lineage validation,
the equivalent fallback race, graph/pointer lock inversion during emergency stop,
unbounded operator JSON parsing, incomplete legacy stop-cohort selection and
first-exposure attribution against the base rather than effective manifest.
Targeted cross-review found no remaining defect in those fixes.

- Combined recommendation, operator-route/UI, CLI and migration checks:
  **854 passed**, 288 opt-in database cases skipped in this unit invocation.
- Separately executed native fixtures: **10 authority**, **2 full delivery**,
  **2 stop-lock concurrency**, and **1 capacity** test passed. The capacity test
  executed 200 actual persisted requests. Source/privacy changes outside the
  selected graph window prevented both composed and fallback issuance.
- Scoped ESLint, full Admin typecheck, production build and workflow bundle
  registration checks passed. Schema/security and migration-recovery tests added
  2,248 passing checks; the public GraphQL schema was unchanged.
- Local Admin component preparation worked at desktop and 390-pixel mobile
  widths without horizontal overflow. No initial API call is added. A minified
  component comparison was 200,271 bytes before and 206,190 after (+5,919 bytes);
  five alternating local renders per arm were 11.9–84.9 ms before and 12.1–36.1 ms
  after. These noisy component timings are not full-page or production Web Vitals.
  The UI avoids importing the full client validation library; server validation
  remains strict.

## Measured incremental storage and latency

[Local capacity receipt](../validation/recommendation-owner-live-20260930/local-capacity.json)
and [resource/cleanup proof](../validation/recommendation-owner-live-20260930/local-capacity-resources.json)
retain exact measured source hashes and table/heap/index/TOAST deltas.

| 100 matched requests         |          Incumbent |             Direct |
| ---------------------------- | -----------------: | -----------------: |
| Complete retained allocation |        4,702,208 B |        6,135,808 B |
| Bytes per request            |          47,022.08 |          61,358.08 |
| Isolated interval WAL        |        4,690,720 B |        6,438,920 B |
| First request                |          150.11 ms |          332.15 ms |
| Subsequent median            |           99.08 ms |          265.90 ms |
| p95 / maximum                | 114.91 / 150.11 ms | 468.51 / 569.07 ms |

The measured increment is 14,336 retained bytes per request (1.305×). Both arms
had 64 candidates and six outputs; direct had 12 actual co-watch nominations and
one selected co-watch card. The actual publisher, qualification/operator, profile
authorization/session-link refresh, co-watch scorer, MMR, final fences and issuance
ran. Synthetic retrieval, admission, history and signing remain explicit harness
boundaries. The profile has one lineage contribution, not the 64-source ceiling;
no HTTP, Redis or future viewer-event cost was measured. First request does not
mean cold database cache. WAL interval totals are not resident WAL demand.

The separate graph fixture had 70 sources, 390 contributions and 78 edges; graph
allocation was 843,776 B and release allocation 32,768 B. This is not maximum graph
capacity or production population proof. The dedicated database had two CPUs,
2 GiB memory, no swap and no OOM; its exact child databases, container and volume
were removed. No production cleanup savings are assumed.

## Production sequence and pending evidence

1. Complete the normal reviewed PR-to-main deployment and verify Admin HTTP,
   worker and Watch revisions/health plus migrations before activation.
2. Obtain one bounded read-only graph preflight for the fixed complete source
   window **2026-09-22 19:00 to September 29 19:00 UTC**, with the same evaluation
   cutoff. Preserve source 50,000, per-session 256 and attempted-pair 250,000 bounds.
3. Size and exercise the actual atomic publisher against that aggregate population
   locally; obtain fresh capacity/lock/retention admission from the storage owner.
4. Publish the admitted graph through the reviewed application operator. Prepare,
   activate and reconcile the exact owner release through authenticated Admin.
5. Record configured authority separately from actual direct viewer execution and
   fallback. Preserve unknown observations; never manufacture viewer evidence.

The public database proxy refused certificate validation (`P1011`) during the
previous read-only attempt. Its one-shot allowance is consumed. A new transport
uses Railway's supported authenticated SSH tunnel, fixed loopback binding,
independent deadlines and exact process/container cleanup. The initial local
process-group tests did not model Railway's detached SSH child: a production
transport-only check timed out without running the source query and left its
loopback listener alive. The exact PID, start time, executable and forward were
verified before cleanup; port 55439 was then confirmed closed. The replacement
supervisor passed nine local cases and independent review. A separate production
transport-only check then established the owned tunnel and verified complete
cleanup in 11.49 seconds; it ran no database/source query. See the
[production transport receipt](../validation/recommendation-owner-live-20260930/private-tunnel-production-v4.json).
Raw tunnel output and credentials are not retained. No public TLS downgrade,
automatic retry or reduced source window is permitted.

A narrow read-only catalog/filesystem check at September 29 20:10 UTC found
9,622,683,648 bytes free, 134,217,728 bytes of allocated WAL, no lock waiters and
no other transactions older than 30 seconds. This check did not scan source
payloads and is not graph publication or direct-serving capacity clearance.

Historical D1–D9 telemetry limitations remain owner-accepted with future fixes
tracked by feat-566. Dormant exposure surfaces remain explicit gaps. Feat-373,
full feat-387 shadow acceptance and feat-505 usefulness are not falsely closed or
reintroduced as activation prerequisites.

## Complete population and atomic publication proof

The single admitted read-only production run completed at September 29 20:24 UTC
in **10.493 seconds**, with **39,551 raw sources**, **6,680 qualified sources**,
**42,060 attempted pairs**, **35,632 contributions**, **9,000 edges** and **613
supported edges**. Publication would retain **51,313 rows**, including the
single generation. It used the fixed complete source window above and changed
no production data. The container peaked at 572,698,624 bytes; its removal and
owned SSH tunnel cleanup were verified. See the
[aggregate population receipt](../validation/recommendation-owner-live-20260930/production-population-preflight.json).

A synthetic fixture matched or exceeded every observed count and encoded row-width/total
bound without copying production values. The unchanged atomic publisher committed
**51,956 rows in 21.647 seconds** under its existing 30-second transaction,
5-second statement and 1-second lock limits. Allocation including all graph
heap/index/fork families was **68,231,168 bytes**; generated WAL was
103,812,800 bytes. Resident WAL remained at its 256 MiB baseline, and total
temporary data was 45,371,302 bytes. These measurements are different quantities;
adding generated WAL and temporary-file totals is not a measured simultaneous
peak. The app used one CPU/1 GiB with a 512 MiB Node heap; peak RSS was
614,973,440 bytes. PostgreSQL used two CPUs/2 GiB and peaked at 776,126,464 bytes.
Neither process ran out of memory. All owned containers and their volume were
removed. See the [publication receipt](../validation/recommendation-owner-live-20260930/local-publication-capacity.json)
and [resource receipt](../validation/recommendation-owner-live-20260930/local-publication-resources.json).

The local result does not establish completion across a remote database tunnel.
Five bounded read-only transport probes measured roughly 144–146 milliseconds
per round trip. The actual graph requires 104 row batches plus the generation
insert; this WAN latency would exhaust the transaction budget. Run the reviewed
CLI from the deployed Admin checkout using its existing private database
connection, after verifying exact revision, dependencies and process headroom.
No timeout expansion or local runtime upload is authorized by this result.

A fixed outcome cutoff does not freeze current integrity decisions: later
classification can add eligible sources. Publication must bind the exact
preflight generation and source scope, and check the measured finite size
ceilings inside its transaction before the first write. Refuse changed input;
do not silently publish a new graph or select a smaller favorable window.
At that earlier preflight stage, production publication and owner activation remained pending; the successful cutover above supersedes that disposition.

The [initial admission contract](../validation/recommendation-owner-live-20260930/initial-publication-admission.json)
binds the production generation to the dominating fixture ceilings. The reviewed
CLI accepts `--admission-file PATH` only with `--execute`; it validates a bounded
16 KiB regular JSON file and exact source scope before loading the database
runtime. A changed generation or exceeded ceiling returns `admission_refused`
and inserts no graph rows. Existing shadow callers without this optional contract
retain their behavior. This release must pass the pinned contract; the contract
itself does not grant production authority or replace the final capacity check.

The admission change passed 49 focused unit checks, scoped lint/format and the
full Admin typecheck. Its native PostgreSQL regression applied all 114 current
migrations (including the independently merged storage index change), proved
that a later eligibility decision and an exceeded ceiling each retain zero new
graph rows, then published with a fresh exact admission. Independent scoped
review found no actionable defects. These are local checks, not a production
publication receipt.
