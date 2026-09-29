# Feat-528 local implementation verification

All data and credentials in these checks were synthetic, in a disposable local
PostgreSQL 18/pgvector container. No production action, consumer onboarding,
shared-token migration or deployment was performed.

## Implemented behavior

- Exact stable-consumer admission counts; idempotent atomic completion; real
  Node HTTP finish/disconnect semantics; +3 then +2, consumer isolation and
  rotation continuity. Post-auth validation/retrieval errors count as attempts;
  health, pre-auth body limits and revoked denial do not count as consumer usage.
- Unsampled minute aggregates, pending state, durable gaps and operator crash
  reconciliation. Closed flushed windows stay complete after a later outage.
- Independent immutable deployment inventory with expected replicas; missing,
  extra or undeclared collectors and missing inventory force unavailable coverage.
  Serving and report readers cannot rewrite expectations.
- Fixed read-only HTTP/CLI report capability, independent of retrieval and
  ownership, initially Jaco/RAGBot only (superseded for human access by the 2026-09-29
  portal decision below). Unknown consumers fail; unavailable
  coverage is 503/nonzero; partial coverage is explicit.

## Verification results

| Check                                              | Outcome                                                                                         |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Full RAG suite after review fixes                  | 120 files, 898 tests passed                                                                     |
| New accounting, role/outage and inventory DB tests | 3 files, 4 tests passed                                                                         |
| HTTP search/disconnect and report tests            | 2 files, 3 tests passed                                                                         |
| Existing database integration regression run       | 44 passed; dedicated consumer-role regression subsequently passed all 51 cases with local roles |
| Fresh database applying every migration            | Passed                                                                                          |
| Prisma schema validation and schema/drift tests    | 9 tests passed                                                                                  |
| Migrated database drift check                      | Passed                                                                                          |
| Typecheck, lint and dependency import law          | Passed                                                                                          |
| Hidden-roadmap-lane check and its tests            | Passed, 2 tests                                                                                 |
| Actual report CLI over local HTTP                  | Complete/partial exit 0; unavailable exit 1; partial warning present                            |
| Standards review                                   | No remaining hard violations; duplicate test setup consolidated                                 |
| Spec review                                        | No remaining actionable findings                                                                |

The outage test revokes real PostgreSQL privileges to interrupt admission,
completion, checkpoint and gap writes. Retrieval can still finish 200 while
coverage becomes unavailable; recovery records partial uncertainty. The
multi-replica test declares two expected replicas and proves that one healthy
collector cannot claim complete coverage. Closing inventory/stopping collectors
proves reporting rollback leaves subsequent windows unavailable.

The compiler now includes DOM types needed by already-present browser tests and
Fetch APIs; this changes no runtime frontend behavior. No `/v1` contract changed,
so consumer contract regeneration was not needed.

## Activation still required

Provision the separate writer, report reader and independent inventory roles;
configure their receivers and maintain truthful deployment/replica inventory.
Register RAGBot through feat-530's portal UI before its separate report grant.
Feat-529 owns actual ops HTTP dogfood, migration grace and production cutoff.
Feat-563 tracks measured capacity before volume expansion. Implementation is proposed in [Forge draft PR #2455](https://github.com/JesusFilm/forge/pull/2455).

## 2026-09-29 portal reporting direction

Every admitted portal user can read every consumer report through `/portal/usage`
with their existing session, without consumer ownership or a new report secret.
The HTTP acceptance check covers another consumer's report, anonymous/retrieval-key
denial, removal, loss of live permission, unavailable admission and revoked session.
Internal machine authorization remains independent. Window validation and coverage
semantics are shared. Production has not been activated by this change.
Three synthetic layout options are supplied for selection; the Usage menu/page and
its browser/performance verification remain pending. Earlier full-suite results
above describe the initial accounting implementation.

Expanded-scope verification: 894 tests passed and 5 database-gated tests skipped
across 121 files (117 passed, 4 skipped). Typecheck, lint and import-law checks
passed. Separate Standards and Spec reviews reported no new findings. No database
schema or accounting behavior changed in the portal slice.
