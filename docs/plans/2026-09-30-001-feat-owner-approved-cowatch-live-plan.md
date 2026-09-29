---
title: Owner-approved co-watch and MMR activation
type: feat
status: in-progress
date: 2026-09-30
roadmap: feat-565
---

# Owner-approved co-watch and MMR activation

The owner explicitly instructed: “I don't think we need a trial lets just activate it you have my approval to do so.” This supersedes the A/A, calibrated efficacy and mature-study prerequisites in the September 29 live plan. Usefulness remains unmeasured. No study, assignment, shadow PASS, calibration or evaluation is manufactured for this release.

## Scope and decisions

- Activate the already implemented co-watch plus source/interest/theme MMR algorithm, with its existing weights and bounds, for measured human English/English-audio Watch requests with a current active durable profile, published positive-interest projection and `cowatch-mmr-v1` client capability. Preserve existing semantic/profile/viewing-mode delivery outside this cohort and as operational fallback.
- Add one immutable `RecommendationOwnerRelease`, selected by the existing CAS promotion pointer in explicit `OWNER_APPROVED` stage. Keep semantic serving control as the global gate. Seed a new exact manifest `hybrid-profile-viewing-mode-cowatch-mmr-owner-live-v1`; existing trial manifests and authority retain their meaning.
- Owner release pins exact graph/source window/as-of, manifest/configuration digest, qualification/dependency deadlines and approver. The exact reviewed MMR configuration and runtime input validation provide structural composer checks. Neither historical shadow/composition promotion decisions nor a trial protocol are prerequisites on this separate path. Source qualification still validates every score-affecting dependency, full counts and supported edges under the existing graph lock.
- Use existing authenticated promotion API/UI for preparation, activation, exact operation-ID reconciliation, refresh and stop. Activation/refresh is a bounded transaction, no new workflow engine. Enforce operator plus permanent-approval permission and recent authentication in the service. Activation refuses an overlapping active experiment/study authority and uses expected pointer generation plus exact prepared binding digest.
- Each graph has ordinary maximum 24-hour publication freshness, further limited by actual dependencies; no source retention extension or frozen-study exception. Refresh is explicit: publish a new complete finite generation and atomically replace the exact release through the same operator. No automatic graph rebuild/retention expansion is authorized in this change. UI reports expiry and incumbent fallback honestly; durable scheduled refresh is a follow-up requiring measured capacity. Activation is a configured live policy with an expiring data dependency, not a causal trial.
- Persist nullable owner-release ID and pointer generation on issued requests; existing request/release primary keys support authority lookups, without a new hot-table index or foreign-key validation scan; keep experiment assignment null. Final issuance locks/rechecks current profile/projection/privacy and graph/release/pointer in compatible order. Source update/delete/append and graph deletion irreversibly revoke the release; retained tombstones prevent resurrection. Ordinary graph retention remains unchanged.
- Reuse bounded edge retrieval, hydration, candidate union, ranker and MMR kernels with separately typed direct authority. No permissive skip-study flag. Missing inputs, unplayability, expiry or source failure discards graph candidates and preserves the prepared incumbent. A final issuance fence failure aborts the response; no stale signed slate escapes.
- Stop/rollback immediately fences subsequent influence from existing direct requests through indexed authority checks, including evidence, integrity and learning readers. Clearing stop cannot revive a revoked release. First eligible exposure must match exact release and pointer generation, never just the manifest.

## Acceptance and validation

1. Exact authorized activation works without study/evaluation rows; stale/conflicting replay, wrong manifest/window/config, absent/invalid/expired graph, sparse support and overlap refuse. Same operation ID reconciles without reactivation.
2. Actual direct source/MMR execution and request persistence use truthful direct provenance, no assignment, existing public response contract. Old/unknown clients and out-of-scope requests retain compatible output. Native fixture exercises the real operator, authority, scoring and issuance path.
3. Native privacy/source/graph/rollback/retention races follow the shared lock order, including pool size one and lost acknowledgement. Refresh never mixes bindings; revoked graph identity cannot regain authority. Retention does not retain raw inputs for the release.
4. Existing request deadline, source 50,000/session 256/attempted-pair 250,000 bounds and integrity thresholds remain. Measure complete incremental retained bytes/WAL and deadline latency against matched incumbent requests. Actual atomic publisher proof must use the admitted production population shape.
5. Repair safe CLI diagnostics; retain fixed failure classes without raw SQL, error messages, identity or credentials. Before production source reads, review a fresh single-invocation isolated aggregate preflight with a fixed window/as-of and existing container/database limits. Previous allowance was consumed; no blind retry or favorable-window search.
6. Coordinate fresh capacity admission with the existing storage task. Preserve >=5 GB peak free and >=7-day runway using actual graph, transient costs, ordinary growth and incremental serving; no credit for unproven future purge. No A/A writes or new trial evidence gate. If actual graph cannot fit, retain an explicit operational refusal.
7. Run focused code review, type/schema/format/native checks, normal reviewed green PR-to-main merge and verify HTTP/worker/Watch fleet compatibility before activation. Authorized production operator receipts plus real serving provenance distinguish configured, executed, selected and fallback states. Synthetic or machine-excluded traffic is not proof of viewer influence.

## Ownership

Parent owns plan, dependency/index updates, migration-number coordination, safe preflight runner, capacity coordination, integration validation and release. Authority work owns the exact manifest, schema/migrations, source qualification and issuance authority, invalidation/retention. Delivery work owns bounded adapters and delivery integration. Operator work owns authenticated controls, activation/refresh/reconciliation, rollback influence fencing and exposure attribution. All implementation is in the isolated direct-live worktree; agents preserve concurrent edits.

## Follow-up and truthful closeout

Feat-505 remains optional unperformed causal measurement, no longer a feat-565 activation dependency. Feat-566 remains accepted historical telemetry remediation. Feat-373's dormant coverage gaps and full feat-393's additional signals remain unresolved. Automatic graph refresh and capacity sustainability must be recorded as a concrete follow-up if not delivered; report the initial live graph deadline rather than implying perpetual useful graph coverage.

## September 30 operator confirmation repair

After the reviewed implementation merged in PR #2478, native browser confirmation
blocked the supported emergency-stop interaction: the prompt was not visible in
the in-app browser, and a fresh authenticated inspection still showed generation
1/control with no committed stop audit. Replace `PromotionControls` native
confirmation with an in-page, keyboard-accessible Confirm/Cancel panel. Preserve
the exact text, request bodies, permission/CSRF/generation checks and uncertain
acknowledgement behavior; consume confirmation synchronously to prevent duplicate
POSTs. The closed panel adds no initial network request or rendered dialog.

Verify cancel and Escape without POST, exact single confirmed submission for
stop/clear/rollback/permanent actions, stale-generation and authorization errors,
keyboard focus, and bounded initial-render cost. Production publication and
activation remain unrecorded; this repair does not imply capacity admission or
successful operator execution.

## September 30 canonical-origin repair

PR #2488 deployed the accessible confirmation to both Admin processes at
`3abde2aa564e30c16631979b5d9403fc4c265403`. The supported stop POST then returned
403 without changing generation 1/control or adding a stop audit. A separate
unauthenticated POST with the canonical Admin Origin, exact CSRF header, JSON
content type and empty body returned `csrf_failed` before authentication. The
client incorrectly presented every 403 as permission denial.

Use the existing configured canonical Admin origin for the promotion endpoint's
exact Origin comparison. Do not derive trust from the internal transport URL,
Host or forwarded headers, and do not add a second allowed origin. Preserve the
custom CSRF header, JSON content type, session, role, recent-authentication, body
size and generation checks. Report an explicit CSRF refusal separately from
permission denial in both promotion clients. Test canonical HTTPS Origin with an
internal HTTP request URL, attacker/missing/null/malformed origins, forged
forwarded headers, and normal authentication/permission refusals. No permission
grant or production authority change is part of this repair.
