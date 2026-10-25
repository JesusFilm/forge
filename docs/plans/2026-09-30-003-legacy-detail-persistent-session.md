# Bounded persistent legacy-detail session

## Scope

The existing v2 retirement service and batch-wave CLI remain unchanged. This
proposal adds one Admin CLI for a separately reviewed, fixed cohort of exactly
1,000 unexpired legacy runs: ten 100-run waves, each split into ten sorted
ten-run transactions. It does not select new runs, refill expired waves, retry
an uncertain batch, extend privacy expiry, or authorize a broad population loop.
The original 64 quality run IDs and 8,621 observations remain an exact live
gate for this first pilot. The session must stop before the next ordinary
retention purge; later operation needs a separate expiry-aware proof.

## Protocol and trust boundary

One bidirectional NDJSON process accepts a `start` envelope containing the
reviewed cohort digest, exact roster and expiry, source revision and seven file
hashes, database target hash, original quality baseline, and a manual hold
review lease. The lease is fixed to its real review time and expires after 30
minutes. Before starting the remote CLI, the client must compare every selected
ID, declared row count and expiry to the root-pinned private fixed master and
pin the raw SHA of the original quality baseline. The root must review those
pins independently; the server cannot read the private master or original
baseline file. The client must re-read and hash the canonical private hold
registry, the lease receipt and source receipt before every command. A permit for each
freeze and execute must come from genuinely fresh external fleet, filesystem,
serving, retention and lock measurements, at most 90 seconds old. The server
independently checks deployed file bytes, revision, database identity, current
WAL allocation and lock waiters before each batch phase. External HTTP,
worker and filesystem evidence remains an operator-side trust boundary; a
timestamp or hash field alone is not an independent measurement.

For each batch, `freeze-batch` returns a private manifest plus typed baseline.
The client fsyncs the full raw response and its own private manifest file before
`ack-manifest`. The server accepts one `execute-batch` only after that ACK and
fresh permit. The client fsyncs an exclusive execute-attempt marker before
sending it. The server rechecks the typed baseline, performs the existing
dry-run and requires 40 seconds of headroom before the earliest wave, lease,
session or retention deadline. It then performs the bounded v2 execution and
proves durable ledger and exact live
parent, item, expiry and observation parity. A read-only `verify-wave` proves
all ten ledgers, all 100 runs and the original quality observations; the
client archives that receipt before `ack-wave`. Any transport or execution
uncertainty stops the whole session. The operator must reconcile durable
ledgers and live rows read-only and obtain a new reviewed operation; the
protocol has no automatic replay path.

The v2 service retains its 4,000-row and 16 MiB batch limits, 1-second lock
timeout, 10-second statement timeout and 30-second transaction timeout.
Exact service source and target guards still determine whether each run is
retired, losslessly converted or preserved. A fixed roster is not evidence of
eligibility by itself.

## Validation and activation

Use a disposable PostgreSQL database to prove all 1,000 IDs, all ten waves,
exact ledgers and typed parity, and negative ACK, stale permit, changed source,
expired lease and uncertain transport cases. Compare full phase timings with
the prior ten-wave receipts; the local fixture is not a production speed
estimate. Independently review the server and local client, then publish only
through the normal PR-to-main flow. A production session requires a fresh
root-reviewed private cohort, source and target pins, actual compatible fleet
convergence, current external measurements, and a separate root go/no-go.

## Later fixed-cohort continuation

The first speed pilot's dated retention boundary and exactly 1,000-run shape
are not reusable after ordinary expiry begins. A later separately reviewed
session accepts one to ten waves, one to ten batches per wave, and one to ten
runs per batch, with at most 1,000 distinct runs overall. Every batch remains
sorted and fixed in the reviewed digest. The existing 4,000-row and 16 MiB
transaction ceilings apply to each batch; an oversized ten-run group must be
repartitioned before review. The session never selects replacements or retries
an uncertain execute.

The root supplies a finite `stopBefore` no later than the actual 30-minute
hold-review lease expiry. Each selected run and request root must remain live
at least five minutes beyond its wave end. The 40-second write headroom, fresh
external permits, exact source and target checks, one-shot markers, and v2
service limits remain in force.

The immutable original 64-run inventory and 8,621 original observations are
checked in one repeatable-read snapshot. A present run must retain exact typed
parent, item, expiry and observation parity. A missing run is counted as
expired and purged only when both original run and request-root expiries have
passed and the exact request parent is absent. Missing before either expiry,
or a missing run with a surviving parent, stops the session. Receipts expose
only aggregate live and expired-purged counts and a private partition digest;
they never treat observations from purged roots as live evidence. Ordinary
privacy expiry continues independently.

## Bounded read-only lock admission follow-up

A stopped continuation reported `database-capacity`, which combines the WAL
ceiling and live lock-waiter check. The archived guard result does not identify
which predicate failed. A narrow local change permits only a transient positive
lock-waiter count to clear: after a valid WAL sample at or below 2 GB, sample
at most twice more with 100 ms between samples. Each sample uses a new bounded
read-only transaction so PostgreSQL sees a fresh state. Source and database
identity remain checked; malformed or excessive WAL, wrong identity or source,
and persistent waiters still fail immediately or after the finite waiter-only
grace. The zero-waiter requirement remains mandatory before continuing.

This grace does not retry freeze, dry-run, execute, a SQL mutation, or a cohort.
It does not extend the hold lease, permit freshness, execution headroom, row or
byte budget, lock timeout, statement timeout, or transaction timeout. Freeze
rechecks permit and wave deadline after the read-only gate. Execute rechecks
permit after its final gate, before the unchanged 40-second headroom check and
write. Local unit and PostgreSQL proof is recorded in
`docs/validation/recommendation-storage-20260930/legacy-lock-admission-grace.md`.
Normal review and PR-to-main deployment remain required; no production cause
or safety benefit can be inferred from the conflated stop reason alone.
