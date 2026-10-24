---
title: Restore co-watch composition and bounded release continuity
type: fix
status: active
date: 2026-10-01
---

## Scope and decisions

Restore valid co-watch operation under the owner's existing direct no-study
authorization in feat-565. Feat-573 owns sustainable refresh. Preserve immutable
revocation, privacy/deletion fences, expiry, source integrity, exact population,
single publication, atomic replacement, truthful provenance and incumbent fallback.
Release only through reviewed PR-to-main and normal autodeploy. Existing unrelated
workspace work is preserved in its original checkout.

The October 1 health audit reports revoked generation 6 and a separate missing-theme
composition failure. Measurement-only eligibility reuse is already on current main;
its presence does not establish the cause of generation 6's revocation. Retained
successors may identify a transition but cannot recreate an unrecorded transaction.
No experiment, usefulness PASS, or synthetic human evidence is required or created.

The October 2 owner decision supersedes a positive-card completion gate in this
plan. Apply `docs/analytics-and-recommendation-policy.md#delivery-health-and-accepted-coverage`:
unavailable eligible content and sparse co-watch with successful fallback are
accepted coverage limitations and do not block proceeding or delivery-health
sign-off. Record actual contribution only when supported by exact provenance.
Server errors, timeouts and reproduced contract failures remain actionable;
automatic refresh lifecycle verification stays separate.

## Implementation units

### U1: Preserve available composition themes

**Files:** `apps/admin/src/services/recommendations/cowatch/candidate.service.ts`,
`apps/admin/src/services/recommendations/composition/mmr.ts`,
`apps/admin/src/services/recommendations/composition/mmr.test.ts`,
`apps/admin/src/services/recommendations/cowatch/trial-authority.db.test.ts`.

Read a bounded usable theme from the first matching active-contract transcript
chunk that actually has a label. Resolve composition themes from the selected
presentation, then an eligible nomination for the same exact video, playback and
request locale/audio. Keep selected presentation, action, ranker and MMR weights.
Never borrow labels from rejected candidates or merely canonical dedup siblings.

**Tests:** first empty/later labeled chunk; inactive contract and wrong
edition/locale excluded; same-video alternate nomination restores real inputs;
different video/playback/rejected nomination cannot supply themes; genuinely absent
themes still fail closed; SQL hydration and real union/composer integration.

### U2: Diagnose revocation and implement bounded refresh

**Entry points:**
`apps/admin/src/services/recommendations/integrity.service.ts`,
`apps/admin/src/services/recommendations/cowatch/projection.service.ts`,
`apps/admin/src/services/recommendations/cowatch/source-window.ts`,
`apps/admin/src/services/recommendations/promotion/owner-operator.ts`,
`apps/admin/src/services/recommendations/promotion/owner-authority.ts`,
`apps/admin/src/services/recommendations/retention.ts`.

Reconcile deployed revisions and bounded retained eligibility successors before
choosing a producer remedy. A changed positive verdict alone is not sufficient to
reuse a receipt. Keep the existing non-measure digest equality requirement. The exact proven
historic omission of `directInfluenceAllowed` is accepted only when current
influence is allowed and every retained guard still matches; unexplained hashes
continue to supersede and revoke.

If automatic replacement is feasible within the verified storage envelope, persist
an explicit narrow refresh authorization through the recent-auth owner operator.
Bind exact approved manifest/configuration/population and influence floor; worker
execution must reference this authorization instead of impersonating a human.
Use a fixed finite event-window/cutoff policy, serialized publication, a durable
attempt identity, qualification and pointer CAS. Refuse oversized inputs without
shrinking the window. Reconcile unknown acknowledgements before another attempt.
Stop/floor changes must fence both in-flight and future replacement.

**Resolved policy:** a whole seven-day event window with seven-hour maturation,
five-minute scheduler checks and at least 12 hours between new attempts or
publications; explicit grant expires after 29 days. Retained-overlap admission
requires at least 60 reserved generations, with a hard count ceiling of 64. The
operator supplies reviewed row/JSON width, physical graph allocation and database
ceilings after fresh storage/WAL/transient observation. Capacity ceilings do not
credit unobserved future purge. Missing physical admission remains a production
blocker even when code and native fixtures pass.

**Tests:** native PostgreSQL qualification/publication/replacement; concurrent
attempt exclusion; lost acknowledgement replay; source/privacy invalidation;
unchanged graph age; expired inputs; stop during refresh; retention lock order;
capacity/source refusal preserves incumbent authority and honest fallback.
Extend existing colocated owner-operator and cowatch database fixtures. New
refresh and integrity suites create isolated databases and apply the complete
current migration chain. The four PostgreSQL suites passed locally; automatic
CI wiring is deferred to feat-591 at the owner's request so this release retains
the existing workflow unchanged.

### U3: Verify, release and compound

Record aggregate SQL and timestamped sanitized evidence in
`docs/validation/cowatch-restoration-20261001/`. Establish exact Admin HTTP/worker
and compatible Watch revisions, current graph and release IDs, source/eligibility
state, physical storage/WAL/headroom and retained overlap. All diagnostic production
transactions are read-only, serial, UTC and bounded by statement/lock deadlines.

Run focused behavior/native tests, format, lint, typecheck and the CI-sensitive
scope. Review correctness, contracts, privacy/reliability and maintainability;
resolve findings before normal PR merge. If UI changes are required, verify loading
performance as well as behavior. Regenerate GraphQL artifacts only if schema changes.

After normal autodeploy, use supported owner-authenticated prepare/activate with
fresh exact graph/capacity qualification. Preserve old revoked audit history.
Verify real issuance and truthful fallback, and attribute any co-watch cards to
their exact owner release/generation. Verify replacement/stop fences separately.
A pointer, build or HTTP success alone cannot establish card contribution or
error-free delivery. Accepted sparse coverage does not block sign-off. Update feat-565
and feat-573 according to demonstrated outcomes; record durable learnings and any
remaining explicit blockers without claiming unobserved success.

## Production execution, October 1

PR #2529 is merged with the CI workflow unchanged as requested. Both Admin and
worker normally autodeployed and subsequently advanced to `58cf00928` including
PR #2527. The supported deployed CLI published the full admitted seven-day graph;
normal SSO and the owner UI activated G7 and recorded the reviewed 29-day refresh
grant. Exact identifiers, physical overlap budget and receipts are in
`docs/operations/recommendation-cowatch-refresh-2026-10-01.md`.

At the recorded October 1 check, first automatic replacement was not yet due.
Initial natural traffic showed honest sparse-edge fallback, with no missing-input
fallback or exact owner execution. The October 2 owner disposition accepts this
coverage and permits proceeding; zero contribution is not a delivery blocker.
The requested 24-hour check will verify refresh lifecycle and report actual
contribution separately, then switch to weekly reviews. Do not infer usefulness
from operational counts or report these dated receipts as current authority.

## References

- `docs/roadmap/content-discovery/feat-565-implemented-shadow-recommendation-promotion.md`
- `docs/roadmap/content-discovery/feat-573-sustainable-cowatch-live-refresh.md`
- `docs/operations/recommendation-owner-live-activation-2026-09-30.md`
- `docs/solutions/database-issues/recommendation-eligibility-measurement-churn-20260930.md`
- `docs/solutions/database-issues/recommendation-retention-cascade-lock-order-20260929.md`
- `docs/solutions/best-practices/recommendation-storage-semantic-and-physical-proof-20260930.md`
