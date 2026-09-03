# Semantic Recommendation Tracer Operations

This runbook covers the production semantic recommendation path from the
automatic Watch block through the authorized Admin request trace, plus current
direct anonymous-profile delivery. Ordinary profile delivery does not consult
experiment assignment, shadow evaluation, or promotion state. The historical
evaluation and promotion procedures remain below for reconciling old records
and for explicitly governed future experiments; they do not authorize or block
current direct-profile delivery. The legacy `sceneRecommendations` and
`WatchEvent` contracts remain compatible.

## Pinned Contracts and Bounds

Treat these identifiers as persisted protocol versions, not display labels:

| Concern            | Version                           |
| ------------------ | --------------------------------- |
| Delivery envelope  | `semantic-recommendation-v1`      |
| Browser evidence   | `recommendation-evidence-v1`      |
| Watch surface      | `watch-below-player-v1`           |
| Semantic strategy  | `semantic-transcript-pgvector-v1` |
| Outcome classifier | `legacy-position-v0`              |
| Active proxy       | `active-watch-proxy-v1`           |
| Playback context   | `playback-context-v1`             |
| Outcome handoff    | `playback-outcome-v1`             |

The semantic delivery returns at most six items and at most 64 KiB. Evidence
requests are at most 8 KiB and 16 events; an episode accepts at most 128 facts.
Fresh retrieval has a 1.5-second Admin budget and the lazy Watch boundary has a
2-second budget. Delivery capabilities live for ten minutes. Episode
capabilities accept ordinary facts for four hours and only declared terminal
facts through the six-hour hard horizon, provided their client occurrence time
is inside the active window. All clocks allow five minutes of skew.

The U1 outcome remains provisional: `legacy-position-v0` records the named
30-second/25-percent comparator, keeps `viewQualityWeight` null, and always
sets `learningEligible=false`.

## Activation Gate

Deploy in expand-then-activate order:

1. Run `prisma migrate deploy` through
   `0072_recommendation_source_neutral_playback_episodes` while serving remains
   disabled. Confirm `prisma migrate status` (or `_prisma_migrations`) reports
   every recommendation migration from
   `0052_production_semantic_recommendation_tracer` through `0072` as applied
   successfully before deploying application code. Migration `0052` registers
   the immutable bootstrap manifest and a disabled singleton
   `recommendation-serving-control` row; later migrations add profile,
   experiment, hybrid-composition, consent, and assignment-generation state
   required by this release. Before `0072`, reconcile episode capability
   budgets with:

   ```sql
   SELECT b.capability_jti, b.request_id
   FROM recommendation_capability_submission_budget b
   LEFT JOIN recommendation_playback_episode e
     ON e.capability_jti = b.capability_jti
   WHERE e.id IS NULL;
   ```

   Unmatched rows are valid delivery/evidence budgets and remain request-owned.
   Matched episode rows move to episode ownership. After the migration, this
   invariant query must return zero rows:

   ```sql
   SELECT capability_jti
   FROM recommendation_capability_submission_budget
   WHERE (request_id IS NULL) = (episode_id IS NULL);
   ```
2. Deploy Admin and Web with generated GraphQL artifacts in parity. Keep
   `sceneRecommendations` and the legacy Watch recorder available.
3. Configure one active recommendation capability signer, the Web consumer
   bearer, durable Workflow Postgres, the retention scheduler, and production
   Redis admission. `RECOMMENDATION_SEMANTIC_SERVING_ENABLED=true` is only a
   startup ceiling; it cannot override an unhealthy or disabled database
   control.
4. Confirm the bootstrap manifest is exactly
   `semantic-transcript-pgvector-v1`, retention has a fresh successful run, the
   database probe is healthy, and Admin reports no overdue roots.
5. Enable the singleton serving-control row with a bounded reason code and
   increment its version. Every delivery rereads this row; do not replace it
   with an environment-only switch or cache it per viewer.
6. Reconcile an anonymous Watch selection and target playback at
   `/dashboard/recommendations` before broadening traffic.

## Historical/Future Exact Hybrid Shadow Evaluation

The procedure in this section is not part of ordinary current hybrid delivery.
Use it only to inspect historical experiment evidence or when a future rollout
ticket explicitly places a new manifest behind governed experimental exposure.

The hybrid manifest is `semantic-profile-hybrid-v1`; its generator set is
`semantic-profile-hybrid-generators-v1`. Creating the manifest does not expose
it to viewers. Before any bounded exposure, an authorized Admin operator must
run the exact manifest through a closed-window shadow evaluation and preserve
its real terminal decision. `revise`, `retire`, and `inconclusive` are blocking
outcomes, not states that an operator may relabel.

From an authenticated Admin page on the deployment being evaluated, run this
same-origin browser-console request. Keep `evaluationId` unchanged if the
request must be retried: it is the idempotency identity for the immutable
evaluation. Use an event window wholly inside the 29-day raw retention period;
`windowEnd` must already be closed. `minimumRuns` cannot exceed
`requestedSampleSize`.

```js
const evaluationId = crypto.randomUUID()
const response = await fetch("/api/recommendations/shadow-evaluations", {
  method: "POST",
  headers: {
    "content-type": "application/json",
    "x-forge-csrf": "recommendation-shadow-evaluation-v1",
  },
  body: JSON.stringify({
    action: "start_exact_hybrid_shadow",
    evaluationId,
    windowStart: "2026-08-29T00:00:00.000Z",
    windowEnd: "2026-08-30T00:00:00.000Z",
    requestedSampleSize: 500,
    minimumRuns: 200,
  }),
})
console.log(evaluationId, response.status, await response.json())
```

The endpoint requires `operate:recommendation-experiments`, same-origin CSRF
proof, a UUID evaluation identity, and bounded strict input. It locks the
manifest, context, eligibility, and generator versions server-side; callers
cannot supply or substitute those values. The evaluation row is committed
before durable workflow dispatch. A retry returns the existing queued/running
workflow, or retries a failed dispatch against the same active evaluation.
Conflicting immutable parameters fail with HTTP 409.

Reconcile the operator and workflow identity without reading raw profile
history, vectors, cookies, or viewer identifiers:

```sql
SELECT id, manifest_id, generator_version, context_version,
       eligibility_version, state, generation, window_start, window_end,
       requested_sample_size, sampled_count, processed_count, failed_count,
       coverage, overlap, novelty, diversity, rejection, latency_p95_ms
FROM recommendation_shadow_evaluation
WHERE id = '<evaluation-id>';

SELECT id, runtime_run_id, trigger, actor_id, status, summary, created_at,
       started_at, finished_at
FROM workflow_run
WHERE workflow_key = 'recommendation-shadow-evaluation'
  AND subject_type = 'recommendation-shadow-evaluation'
  AND subject_id = '<evaluation-id>'
ORDER BY created_at, id;
```

For an explicitly governed future experiment, only an unexpired exact
`promote_to_experiment` decision can be offered to its bounded-approval flow.
This rule does not apply retroactively to current direct-profile delivery.
Historical assignments and exposures remain immutable and inspectable when
present; their absence is normal on current requests.

Production must have Redis available. Redis loss fails new attributed delivery
closed before retrieval; only non-production uses the process-local admission
adapter. A missing keyring, disabled environment ceiling, disabled/mismatched
manifest control, or overdue retention also issues no attributed slate. None
of these conditions may block the source or target player.

## Serving Disable and Recovery

For an ordinary rollback or instrumentation incident, first set the shared
`recommendation-serving-control.enabled` value to `false`, record a bounded
`reason_code`, and increment `version`. Set
`RECOMMENDATION_SEMANTIC_SERVING_ENABLED=false` in the next Admin deploy as a
second fail-closed ceiling. This stops new attributed slate issuance across
replicas while Watch remains playable and the compatibility query remains
available.

Do not delete the manifest, request records, or capability key immediately.
Allow already accepted episodes to finalize within their fenced horizon and
retain their traces through normal expiry. If a key is compromised, add its
`kid` to the serving-control row's bounded `emergency_revoked_kids` set instead;
issuance and verification reread this set on every request, so revocation takes
effect on each replica's next use. Record only a reason code, never key
material.

After remediation, require all activation gates again. In particular, clear
retention backlog with the bounded purge, verify the oldest overdue root is
gone and a fresh successful retention ledger exists, then re-enable the shared
control. Do not infer recovery from an empty request window.

## Capability Key Rotation

`RECOMMENDATION_CAPABILITY_KEYRING` is a JSON document with exactly one
`active` key and up to seven `previous` verify-only keys. Each `kid` is unique
and allowlisted by syntax; each base64url-decoded HMAC key is random and at
least 256 bits. Admin accepts only HS256 with the expected type, issuer,
audience, identity, time, and stored bindings. Invalid or ambiguous
configuration disables attributed serving without exposing key material in an
error.

Perform a planned rotation in this order:

1. Deploy the new key as `previous` while the old key remains `active`.
2. Verify every replica has the two-key ring, then deploy the new key as
   `active` and the old key as `previous`.
3. Wait the six-hour episode hard horizon plus five minutes of clock skew.
4. Remove the old key in a later deploy.

Do not shorten the overlap to the ten-minute delivery lifetime: an already
claimed episode may still submit a terminal fact through the longer hard
horizon. Emergency revocation is the only immediate invalidation path and may
reject outstanding capabilities by design.

## Retention, Purge, and Privacy

Each request gets one immutable expiry 29 days after creation. Served items,
render/impression/selection facts, episodes, playback facts, outcomes, and
request-linked audit/conflict records inherit that root expiry and cannot
extend it. Source-neutral standalone playback episodes receive the same
29-day horizon and are purged as bounded roots with their cascading facts and
outcomes. Reads hide expired roots immediately. The daily advisory-locked
purge runs at 10:30 UTC in batches of 500 (hard maximum 5,000), deletes request
roots under database cascades, and fences late finalizers from recreating or
publishing deleted generations.

The purge has a 24-hour propagation SLA and a 30-day hard ceiling. Retention is
overdue when a request or standalone playback root is more than 24 hours past
expiry, a bounded run leaves an overdue root, or no successful run exists for
36 hours. Strategy manifests do not expire automatically. Sanitized
retention-run records and privileged
trace-access audits retain for 90 days; root purge sets the access audit's
request link to null atomically so the retained row cannot be joined back to a
request or session.

Never store or retain raw capability tokens, session cookie values, claim
nonces, IP addresses, user identifiers, consumer bearers, embeddings, or
vectors in this ledger. Session, tab, claim, payload, and event authority are
stored only as bounded identifiers or one-way digests where required. Admin
detail projections remain scalar and privacy-safe. Browser proof may retain
only allowlisted URL path, status, timing, and request ID; delete raw Playwright
traces before a PR because they can contain bodies and cookies.

## Health Interpretation

Admin health is a truth table over recommendation-owned durable evidence:

| State                 | Meaning and response                                                                                                     |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `healthy`             | Durable success exists and no known problem state is present.                                                            |
| `zero_activity`       | Current DB probe and retention are healthy, a durable success watermark exists, and the selected window has no requests. |
| `unavailable_unknown` | DB/dependency read failed or no durable success watermark exists. Never report this as zero or as an exact loss count.   |
| `loss_suspected`      | A committed rejection or write-failure audit exists; inspect its bounded reason.                                         |
| `replay`              | An identical event digest was submitted again; the first accepted fact remains canonical.                                |
| `conflict`            | The same event identity arrived with a different digest and was quarantined.                                             |
| `late`                | A fact that occurred inside the active window was received later, before the hard horizon.                              |
| `classifier_lag`      | A terminal/deadline episode has no outcome, or an open episode is past its deadline.                                     |
| `retention_overdue`   | Purge propagation or success-watermark freshness failed; attributed serving stays disabled.                              |

Selection without an impression and valid out-of-order facts stay visible as
facts; they are not manufactured into loss. Read counters together with the
delivery/evidence/retention watermarks, oldest pending/overdue age, latest
purge, retrieval latency, effective manifest, and fallback reason.

Aggregate access (`read:recommendation-aggregates`) never includes request IDs,
cursors, or detail links. Trace access (`read:recommendation-traces`) is
separate, paginated at 50 rows, and every detail read creates a 90-day sanitized
access audit.

The durable 11:00 UTC control-readiness scheduler also runs the bounded
seven-day `active-watch-proxy-v1` offline evaluation after a six-hour maturity
lag. Each attempt has its own workflow ledger and immutable evaluation
revision. Its `rankingInfluence` remains false for every decision; readiness
can authorize later shadow evaluation, never live ranking.

## Migration and Application Rollback

The schema is additive and forward-only. An application rollback keeps
migration 0052 and all recommendation rows readable by the newer service while
N-1 code ignores them. Disable serving before rolling application code back;
do not edit or delete an applied migration, and do not contract the tables in
the rollback deploy.

If `prisma migrate deploy` fails before migration 0052 is successfully applied,
inspect the partial schema and repair it before using `prisma migrate resolve
--rolled-back`; that command is only for a failed migration row whose cleanup
is understood. Reversing a successfully applied migration requires a new
forward migration. Destructive contraction belongs to a later ticket after the
29-day raw lifecycle, 90-day operational audit requirements, and N-1 readers
have been accounted for.

## Isolated Local Preview

Start from `apps/admin/docs/worktree-preview-setup.md`: create a disposable
database copy, apply this worktree's migrations, install Workflow Postgres, and
use a worktree-specific Admin cookie prefix. Never migrate the shared source
database.

Use matching local origins and a dedicated local consumer bearer. The minimum
recommendation-specific Admin shape is:

```bash
WATCH_CANONICAL_ORIGIN=http://localhost:3000
WEB_CANONICAL_ORIGIN=http://localhost:3000
CORS_ALLOWED_ORIGINS=http://localhost:3000
WEB_ADMIN_API_KEYS=<local-consumer-bearer>
RECOMMENDATION_SEMANTIC_SERVING_ENABLED=true
RECOMMENDATION_CAPABILITY_KEYRING='{"keys":[{"kid":"local-preview","status":"active","key":"<random-base64url-32-bytes-or-more>"}]}'
WORKFLOW_RUNNER_ENABLED=true
WORKFLOW_TARGET_WORLD=@workflow/world-postgres
WORKFLOW_POSTGRES_URL='postgresql://forge:forge@db:5432/<disposable-db>?connection_limit=4&pool_timeout=20'
```

Web must use the same bearer and origin:

```bash
ADMIN_GRAPHQL_URL=http://localhost:3003/api/graphql
WEB_ADMIN_API_KEYS=<local-consumer-bearer>
NEXT_PUBLIC_CANONICAL_ORIGIN=http://localhost:3000
WEB_BASE_URL=http://localhost:3000
```

When the preview is exposed on a forwarded port, replace every `localhost:3000`
origin above with that exact browser origin. Keep it in Admin's
`CORS_ALLOWED_ORIGINS`: Watch search calls Admin GraphQL directly after language
resolution, so a delivery-only preview can appear healthy while search is
blocked by the browser if the forwarded origin is omitted.

Start Admin first. The durable workflow runner performs an initial bounded
retention run and then sleeps until the daily schedule. Confirm the bootstrap
rows and retention watermark before enabling the shared control:

```sql
SELECT id, strategy_version, contract_version, surface_version, generator,
       max_items, enabled
FROM recommendation_strategy_manifest
WHERE id = 'semantic-transcript-pgvector-v1';

SELECT status, completed_at, oldest_expired_at_after
FROM recommendation_retention_run
ORDER BY started_at DESC
LIMIT 1;

UPDATE recommendation_serving_control
SET enabled = true,
    reason_code = 'local_preview',
    version = version + 1,
    updated_at = now()
WHERE id = 'recommendation-serving-control'
  AND manifest_id = 'semantic-transcript-pgvector-v1';
```

Then start Web, open an eligible production Watch route in a fresh anonymous
context, expose a recommendation card long enough to satisfy the 50%/one-second
visibility policy, select it, and start playback on the target. In a separate
cookie-isolated authorized Admin context, reconcile the same request at
`http://localhost:3003/dashboard/recommendations`. Before handing the preview
over, also disable or stall recommendation delivery/evidence independently and
confirm both source and target players remain usable.

When finished, stop both servers before dropping the explicitly named
disposable database.
