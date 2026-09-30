# Bounded legacy-detail session validation

The session CLI was exercised on a disposable loopback PostgreSQL 18 database
with the current Admin schema. It was not run against production. The native
fixture contains exactly ten waves of 100 original legacy runs, in 100 sorted
ten-run batches. Nine hundred runs carry a protected owner link and must be
converted; 100 unprotected runs satisfy selective retirement. A separate
64-run quality fixture has 8,621 typed observations, including three already
compact traces, to exercise the mixed-format parity gate.

The native test drives the same NDJSON state machine as the CLI: start,
freeze, private manifest, archive acknowledgement, execute, batch proof,
wave proof and wave acknowledgement. It asserts exact parent, item, expiry,
stage/compact and durable-ledger outcomes. A stale external permit stops
before freeze. A wrong private-manifest ACK stops with no new retirement
ledger. A near-deadline batch can freeze and receive an ACK, but cannot begin
execution when less than 40 seconds remain on its wave deadline; no ledger is
written. The client-side transport has a separate synthetic 100-batch proof;
that local pipe test does not prove Railway connectivity or fleet health.

The final owned-database run passed (`1/1`, 130.00 seconds including seeding).
Its 100 new durable batch ledgers completed over 75.26 seconds. The run ended
with 900 compact conversions and 100 selective retirements. Admin typecheck,
targeted ESLint and formatting passed. The local operator client is a separate
private artifact with its own synthetic 100-batch receipt; it is not part of
this PR.

At 05:05:46 UTC, the root operator independently verified that the deployed
Admin database role can read `pg_ls_waldir()` inside a bounded read-only
transaction with the target hash checked. The private operational receipt is
`outputs/heartbeats/20260930T0352-legacy-ten-wave/admin-role-wal-permission.json`.
This proves the current role permission only; it does not activate the session.

The work preserves the published v2 writer's ten-run, 4,000-row, 16 MiB,
1-second lock, 10-second statement and 30-second transaction limits. The
session is default-off and requires a pinned target and reviewed cohort digest
at invocation. Before any production use, independently review both server
and client, prove
actual Railway stdin/stdout behavior read-only, and admit a new private cohort
with fresh hold/source/fleet evidence. Native fixture timing is not a
production throughput forecast.
