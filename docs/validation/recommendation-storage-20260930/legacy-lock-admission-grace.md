# Legacy session lock-admission grace: local validation

The `database-capacity` stop can mean an excessive or malformed WAL reading or
a current lock waiter. The observed production stop did not distinguish them.
This branch adds a read-only grace only for a valid positive waiter count: two
extra fresh samples, 100 ms apart, with no transaction held during a sleep.
The gate still requires zero waiters before returning. A WAL, source, or target
failure is not sampled again. The session rechecks permit freshness, lease and
wave deadline after any freeze grace, and permit freshness plus the existing
40-second headroom before execute. No failed freeze or mutation is retried.

## Verification

- Unit test `retire-legacy-recommendation-detail-session-lock-admission.test.ts`:
  zero-waiter first sample, waiter clearing on a fresh transaction, persistent
  waiter refusal after three samples, immediate malformed/over-2-GB WAL
  refusal, immediate wrong-target/source refusal, read-only SQL and original
  1-second lock/10-second statement/30-second transaction settings. A clock
  crossing the permit's freshness bound during grace is refused by the
  post-gate predicate; a future permit is also refused. Source inspection
  confirms that predicate is called after the gate in both write paths.
- Native PostgreSQL test
  `retire-legacy-recommendation-detail-session-lock-admission.db.test.ts` on
  owned local PostgreSQL 18: one session waits on a synthetic advisory lock
  while a separate connection observes it. Transient clearing permits the
  gate; a persistent waiter is refused after the finite grace. The same
  database accepts a subsequent zero-waiter check.
- Existing native 1,000-run session proof on a separate owned database checks
  protected conversion, unprotected retirement, typed parent/item/expiry and
  observation parity, durable ledgers, and unchanged session sequencing.

All seven unit cases, both native waiter cases, and the existing 1,000-run
native session case passed. Admin typecheck, targeted ESLint, Prettier for every
touched file, and `git diff --check` passed. The owned databases were
`forge_cleanup_lock_admission_owned_20260930` and
`forge_legacy_session_owned_20260930` in a dedicated local PostgreSQL 18
container; no production endpoint was used.

Only the session CLI guard and its tests changed. The v2 retirement service,
ten-run maximum, 4,000-row/16-MiB limits, 1-second lock, 10-second statement
and 30-second transaction bounds remain unchanged. A deployment would change
the CLI source hash, so root must review and repin source/lease receipts and
use the normal PR-to-main flow. This local test makes no claim about the
production stop's exact predicate or about behavior under production load.
The permit clock-crossing unit composes the gate and predicate directly; it
does not inject a clock change into the full wire protocol. The unchanged
session's 1,000-run native proof covers ordinary sequencing and parity, while
the post-gate call order still needs independent code review.
