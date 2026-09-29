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
At this earlier access-only checkpoint, three synthetic layouts were supplied
and the Usage menu/page awaited selection. Jaco subsequently chose option A;
the selected-page verification is recorded below. Earlier full-suite results
above describe the initial accounting implementation.

Expanded-scope verification: 894 tests passed and 5 database-gated tests skipped
across 121 files (117 passed, 4 skipped). Typecheck, lint and import-law checks
passed. Separate Standards and Spec reviews reported no new findings. No database
schema or accounting behavior changed in the portal slice.

## Selected option A: portal comparison page

The Usage menu and lazily loaded comparison table are implemented. Existing
real-PostgreSQL management browser journeys both passed after the change (2/2),
including creation, members, key replacement, revocation and registry navigation.
HTTP checks cover bounded 20-consumer batches, duplicate/invalid/oversized inputs,
per-report partial/unavailable coverage and whole-batch read failure without zeros.

Manual local-browser inspection used `local-other`, a non-owner of the report
consumers, with real session and aggregate-reader adapters: 16 reports loaded in
232 ms after opening Usage. This isolated DB's historical coverage was correctly
unavailable. Synthetic presentation fixtures then exercised complete zero (0/0),
partial labels and report-detail watermark, unavailable dashes, 20+5 pagination,
name search, invalid >31-day window (zero extra reads), 503 clearing and 401
session clearing. No browser errors or whole-page horizontal overflow at 390 px.
Leaving a section clears its report data and invalidates in-flight responses.
Screenshots and machine-readable local metrics are in ignored `apps/rag/output/usage/`;
all depicted data is synthetic. No production screenshots or credentials.

Initial Consumers loading was compared with commit `6150341ca` in three cold
browser contexts per version using the same local server/DB and identical static
asset interception on both versions. Payload was 129,389 bytes before and 133,200
bytes after (about +3.8 KB, below the existing 140 KB guard). Median page-ready
was 150 ms before / 126 ms after; DOM ready 46 / 36 ms; load 91 / 74 ms. Neither
version fetched `usage.js` or report data on the initial Consumers page. These
are controlled local timings, not production network/capacity measurements.
The final relative module URL is 14 bytes shorter than the measured URL.

Final Standards review found no hard violations and one minor duplication in
report error mapping; the mapping was consolidated. Spec review found no issues.

Final selected-page verification: 896 tests passed, 5 database-gated tests skipped,
across 121 files (117 passed, 4 skipped). Typecheck, lint and dependency/import-law
checks passed. The relative lazy import was exercised in the browser; a delayed
report response released after navigation could not repopulate the cleared table.
No browser errors. No database schema changes in the selected-page slice.

## SPC-001 terminal reconciliation retry correction

The public usage-store regression first failed because a stopped collector's
reconciliation retry resolved after the 30-second lease timeout. Reconciliation
now selects only collectors with `stopped_at IS NULL` under the transaction lock;
a terminal retry fails with `UsageError("unavailable")` before any pending deletion,
gap insertion or stop/watermark update.

`apps/rag/src/adapters/postgres/consumer-usage-reconciliation.integration.test.ts`
reconciles a crashed collector with an unresolved admission, closes its independent
inventory and opens a healthy replacement deployment. Before and after retrying
at two minutes past the terminal stop, public reports remain byte-for-byte equal
for a flushed complete window (1/1), the crash-partial window (1/0), and the
replacement complete window (1/1), including watermarks. The old collector still
rejects admissions. The regression is included in `db:verify`, which CI's
`rag-postgres-integration` job invokes; the regular test command excludes this
DB-only test. A separate file respects the 300-line ESLint limit.

Validation: all four accounting/reconciliation/roles/inventory integration files
passed (5 tests) on synthetic `forge_rag_fresh`; the full RAG suite passed 896 tests
with 5 database-gated skips across 121 files. Typecheck, lint and depcruise passed.
The older synthetic `forge_rag` database had no inventory guard trigger despite
recorded migrations; the fresh database had enabled `guard_inventory`, and the
unchanged role assertions passed there. No production or schema change was made.
