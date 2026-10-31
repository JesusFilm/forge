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

## CLI stdout protocol isolation follow-up

Two deployed start-only attempts stopped when the local client received an
unexpected JSON frame before `ready`; neither sent a freeze or execute command.
The exact historical frame was not retained, so its origin is unclassified. A
later start-only check at 05:50:24 UTC returned a clean `ready` for the original
64 holdouts and 8,621 observations, then intentionally ended at EOF. The
intermittent observation is not proof that the pool logger caused those two
failures.

A deterministic actual-CLI subprocess regression demonstrates the channel
hazard: a pool-shaped `console.info` emitted while the CLI is accepting stdin
previously appeared as an extra stdout JSON frame ahead of the protocol
response. The CLI now routes `console.info`, `console.log` and `console.debug`
to stderr, while its protocol emitter alone writes stdout. The regression
asserts one sanitized protocol frame on stdout and the diagnostic on stderr.
A separate local held-socket test exercises the real `ObservedPool` rejected
acquisition path and confirms that it emits its diagnostic through
`console.info`. The change does not alter the shared pool logger or any
retirement guard. A fresh deployed start-only handshake remains required
before production cleanup writes.

## Later fixed-cohort and expiry proof

The continuation change passed the same native PostgreSQL fixture (`1/1`,
152.38 seconds including seeding and the expiry-boundary wait). It exercised the original 1,000-run,
100-transaction path and then a separately fixed four-run cohort arranged as
two batches in one wave and one batch in the next. The receipts reported the
actual three batch ledgers, two waves and four runs. Start rejected an
eleven-run batch, a batch declaring more than 4,000 rows and a stop time past
the manual lease. A replay against already retired rows failed before a new
write.

The original 64 quality runs remained exact while live. A changed retained
run failed its parent fingerprint. On a disposable fixture, a deleted root
failed the quality gate just before its recorded expiry, then passed after
both original run and parent expiry with a 63-live/1-expired-purged partition
whose original observation counts still totaled 8,621. A deleted run whose
parent remained present failed even after both expiries. The fixture moves
its expiry clock only inside a local transaction with PostgreSQL replication
triggers disabled; production lifecycle triggers are unchanged.

Admin typecheck, scoped ESLint, Prettier, the CLI stdout regression (`2/2`)
and `git diff --check` passed. These are disposable-database and local-process
results, not production cleanup, filesystem recovery, client compatibility or
later-cohort admission.
