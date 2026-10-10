# Finite unattended cleanup validation

The owner requested a script that progresses without AI involvement between batches and one monitor every 24 hours. This receipt covers local implementation proof. Production admission, execution and filesystem measurements remain separate timestamped evidence.

## Session CLI change

An optional strict `unattended-finite-v1` lease binds one source-review timestamp to a fixed expiry of at most twelve hours. Manual sessions retain the exact thirty-minute lease and 120-second startup source-review requirement. All transaction, source/target, hold, capacity, serving and expiry guards remain.

The enabled disposable PostgreSQL test passed: one test, 178.957 seconds test time / 182.61 seconds wall time, exercising 1,000 runs, 100 batches and ten waves. It checks lossless conversion, authorized retirement, exact typed parent/item/run/expiry parity, durable ledgers, original quality observations and normal privacy expiry. New unattended controls reject stale permits, changed source and an expired-lease/child-deadline mismatch before any ledger increase. The last case rejects at cohort validation; direct clock-bound lease expiry is covered by the permit unit test. Manual stale-source and malformed authorization are rejected separately. Post-run manual replay fixtures receive a fresh synthetic source receipt so the unchanged two-minute startup gate does not mask the replay assertion.

The first attempt was skipped until `RECOMMENDATION_DB_TEST=1` was supplied; it is not counted as proof. The enabled run then exposed an outdated generated Prisma client in linked local dependencies. A separate generated client was built for the fixture; shared dependencies and production were untouched. The test permits only the two named loopback fixture databases.

Focused socket-free session tests pass 10/10; scoped ESLint, Prettier and diff checks pass. The full local Admin typecheck exhausted its default heap. An 8 GB attempt was stopped to avoid competing with another existing large typecheck on the shared host; it did not establish a typecheck result. Full Admin typechecking remains a CI release gate before merge.

## Local operator proof

The reviewed persistent operator adds a byte-pinned authority and exact ordered master-batch scope. Client and runner verify each child's contiguous membership and recheck authority, scope, source, registry, baseline and operator bytes. An OS service with `Restart=no` runs the supervisor; it has no model calls. Each child must finish independent read-only ledger and typed-state reconciliation before progress advances. Transport uncertainty stops the campaign without retry.

Tests passed: 27 existing manual client scenarios; nine unattended client scenarios including changed roster/authority, expired or overlong leases and historical reconciliation; five runner tests; nine supervisor tests. Supervisor tests include disjoint bounded groups, no replay, no advancement after failed preflight, changed pins, exact gzip round trip and a timeout without retry. Independent review found and resolved a historical cursor bug: the lower bound now includes both wave and batch, with a regression that rejects a previously committed midwave prefix.

The initial static production roster contains 186,969 unique runs in 18,697 original batches and 187 capped children. It starts after 34,100 previously verified runs and excludes all original quality/investigation records, including 47 whole future held waves. Static membership is not live eligibility or approval. A fresh production release, source/target/hold/capacity review and one fixed authority are still required before launch.

The persistent package's collector differs from its earlier reviewed version only in five helper paths moved out of temporary storage; helper contents are byte-identical. A root-owned read-only package acceptance passed at September 30 19:27 UTC on the existing production revision with 10.715 GB available, 134,217,728 WAL bytes, healthy compact writers and no lock waiters. No cleanup writer was invoked by that acceptance. It is not an admission for the new release.

## Remaining gates

This change does not prove production campaign completion or physical recovery. The legacy relation still allocated 16,431,259,648 bytes at the prior measured checkpoint. DELETE and local audit compression are not filesystem recovery. Feat-575, retention verification in feat-554 and physical reclamation in feat-555 remain open. Follow `docs/operations/unattended-legacy-recommendation-drain.md` for daily monitoring and stopped-operation handling.
