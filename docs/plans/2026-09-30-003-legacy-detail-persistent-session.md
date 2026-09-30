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
