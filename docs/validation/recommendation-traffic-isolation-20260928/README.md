# Recommendation traffic isolation and selective conversion

## Scope and release state

This validates feat-559 and feat-560 against the approved
[implementation plan](../../plans/2026-09-28-002-fix-recommendation-traffic-isolation-plan.md).
The implementation preserves normal recommendations and attribution, excludes
recognized crawler persistence, defers speculative browsing until activation,
and provides selective lossless conversion of older candidate evidence.

Admin release [PR #2439](https://github.com/JesusFilm/forge/pull/2439) is open.
Web release and production exclusion verification are pending. No production
conversion has executed. Local test success is not a production rollout receipt.

## Local verification

Integrated main baseline: `6a49276079528cf637b7bae6b2caae6c643f95a6`.

| Check                                             | Result                                                      |
| ------------------------------------------------- | ----------------------------------------------------------- |
| Full Admin Vitest suite                           | 7,440 passed; 359 skipped; 1 todo                           |
| Full Web Vitest suite                             | 4,572 passed; 10 skipped; 1 todo                            |
| Final Admin traffic/resolver/conversion checks    | 39 passed, including 11 actual PostgreSQL cases             |
| Final Web contextual and For You component checks | 46 passed, including one/five/six contextual card cases     |
| Browser lifecycle fixture                         | 4 passed after final fixture fix                            |
| Admin and Web typechecks                          | Passed                                                      |
| Admin and Web lint                                | Passed after formatting and fixture hydration-marker repair |
| Admin SDL and gql.tada generation                 | Passed; no introspection output change required             |
| Previous deployed operation documents vs new SDL  | Both seeded and For You documents validate                  |
| Disposable database migrations                    | All 105 migrations through 0104 applied                     |

The PostgreSQL no-write proof reads real curated inventory and traps every
recommendation table mutation, including tables discovered dynamically from the
current migrated schema. It tests profile-backed crawler, speculative and legacy
false-eligibility inputs. A separate ordinary issuance control persists normally.
Resolver tests cover identity bypass and credential removal before service entry,
plus ordinary/older caller behavior and untrusted classification rejection.

Conversion proof covers exact typed stage equality, nested JSON and large numeric
values, full reader parity, preserved parent/item/expiry values, unsupported
precision/counts, frozen holds, late access evidence, dry run, replay, real
retention deletion and advisory-lock contention. Failure on the second run's
delete rolls back both runs in the manifest.

## Browser and loading evidence

The test fixture uses real recommendation, consent and playback-claim components
with synthetic catalog data and mocked APIs. It returns 404 in production and
without the Playwright flag. The ordinary and simulated-prerender paths prove:

- No delivery or automatic profile POST before activation.
- A reused deferred body causes one fresh ordinary delivery.
- Render, native visibility impression, selection and matching-nonce playback
  claim use the fresh delivery; capability values are absent from the DOM.
- One refresh follows a simulated persisted `pageshow` event.
- Contextual cards navigate without evidence, selection or playback-claim calls.

In the first local development timing sample, seeded ordinary HTML response/FCP
were 169/300 ms and delivery finished at 1,160 ms. For You was 95/268 ms with
delivery finishing at 1,113 ms. Inactive fixtures made zero profile/delivery API
requests; delivery began after the explicit activation event. Mocked 300 ms API
delays establish ordering, not a production latency delta. The test simulates
`document.prerendering` and persisted `pageshow`; it does not prove native Chrome
prerender activation or BFCache restoration.

## Independent review

Fifteen bounded review passes covered correctness, testing, maintainability,
project standards, agent accessibility, relevant prior learnings, security,
performance, API contracts, data conversion, reliability, adversarial scenarios,
TypeScript, frontend races and deployment verification.

Four introduced findings were fixed: contextual positions were one-based,
partial seeded slates omitted shortfall metadata, the test fixture omitted page
metadata, and conversion identity queries preceded transaction budgets. Focused
re-review found no remaining actionable issue in those changes. Plan review also
required Admin-first deployment; the two-release barrier is explicit in the plan.

Residual limits: UA declarations do not identify every robot; sampled indexed
logs are not complete traffic accounting; frozen investigation holds need operator
review; native browser cache behavior and production latency remain separate
observations. Conversion may safely skip changed/expired/already converted runs;
stop before further batches on any unexpected skip.

## Selective legacy preparation

The original 64 quality-audit run IDs were frozen privately before changing the
legacy population. The selector SHA-256 is
`c983ec02830d1b2df637c04e47fd75bdd66c26bd4e0caba0c38ff851561589a1`.
Quality and cleanup audit tasks identified no additional explicit investigation
run IDs. Direct experiment/shadow/promotion/conflict/access links are also
excluded. Existing expiry remains in force.

A read-only September 12–13 UTC inventory selected ten older runs: six semantic
and four hybrid, totaling 689 stage rows and 519,932 encoded bytes. Freeze took
7.18 seconds and dry run 8.04 seconds including startup/network, with zero skips.
Per-run encoded size ranged from 3,970 to 160,100 bytes. Parent/item hashes and
expiry remained unchanged after preparation. Private artifacts are mode 0600 and
are not committed. Manifest SHA-256:
`295f69c55677ecddfac4ad106bbbb451980682a3836a1d28ceb2940bc46d70ea`.

A separate synthetic ten-run disposable benchmark converted 2,720 stages in
2.56 seconds, adding 237,568 bytes of run/TOAST allocation and 1,771,896 bytes of
WAL after a local checkpoint. Stage allocation remained unchanged. See the
[runbook](../../operations/legacy-recommendation-trace-conversion.md) for the full
measurement limits and exact parity/rollback procedure.

At `2026-09-28T02:18:58Z`, production had 11,234,263,040 filesystem bytes available
(78% used). Both active Admin roles were healthy on `8ddd29c5b`, with compact trace
writers and the worker-only runner split. This is a preparation receipt, not the
fresh pre-execution capacity check.

No immediate filesystem recovery is promised by selective DELETE. The duplicate
index saving from the earlier storage release is separate and must not be counted
again; exact-empty legacy relation reclamation remains feat-555.
