# Recover learning writes after an aborted account deletion

Auth's `beforeDelete` runs Apple revocation, then Admin erasure, then Better
Auth deletes the user row. These are separate transactions. An Admin timeout,
lost response, invalid acknowledgement, or later Auth database failure can
retain the Auth user row after watch history/events/learning were erased.
The deleted progress cannot be restored by removing a fence. Do not promise
that an aborted deletion left external account data intact.

`AccountDeletionSideEffectError.adminErasureMayHaveCommitted` and the matching
log field are `true` for every failed attempted Admin erasure. This means the
outcome is uncertain, not that erasure was confirmed. A successful erasure
followed by a user-row deletion failure needs the same investigation even
though that later error originates in Better Auth.

Admin's `watch_learning_erasures` row is intentionally permanent: saves, resets,
and erasure take the same subject advisory transaction lock. An in-flight write
must find the fence after erasure commits. An automatic compensating DELETE,
fence expiry, or unfence on a successful login would allow old pending progress
to reappear. Auth cannot prove those requests are drained across services.
There is therefore no HTTP unfence operation.

## Choose the outcome before changing a fence

1. Identify the exact Auth subject and the configured Admin environment from
   the failed attempt. Inspect both authorities using authorized operator
   access. Never infer either from a browser-provided subject or a loopback
   URL (it may be a tunnel).
2. If the user still wants deletion, retry the normal deletion flow. Admin
   erasure is idempotent and keeps the fence. Check Auth user-row absence and
   Admin erasure acknowledgement; do not unfence a deleted subject.
3. Recover writes only when the user withdrew deletion and the same Auth
   subject still exists and is ACTIVE. Explain that erased learning/history
   are gone and future progress will start empty. Record the operator decision
   and environment in the incident record without tokens or unnecessary PII.

## Guarded recovery for a retained account

This is an exceptional operator maintenance action, not an application retry.
Do not run the SQL until all of these preconditions are proven:

- Stop account-deletion attempts for this subject and quiesce every Web, mobile,
  TV, and direct Admin learning writer in this environment. Keep mutation
  ingress closed throughout recovery. Stop old application processes and
  queued retries; do not rely on hiding a UI or removing a cookie in one tab.
- Revoke the subject's sessions and refresh credentials at Auth. Wait until
  every previously issued access token has expired and all introspection/session
  caches and in-flight request budgets have drained. Revocation alone may be
  cached. If a maximum lifetime or a caller cannot be established, stop and
  leave the fence in place. Old clients must sign in afresh after recovery.
- Verify the account still exists, is ACTIVE, and has no pending deletion.
  Confirm the exact fence timestamp and that no progress rows remain. Do not
  delete progress to force this condition; unexpected rows need investigation.
- Use a dedicated authorized maintenance connection to the intended Admin
  database. Confirm `current_database()` and server identity independently.
  Do not expose credentials in shell history, command arguments, or reports.

With `psql` connected securely to that database, run the following interactively.
Subject input stays in session variables; do not record a terminal transcript.
The SHA-256 and advisory-lock namespace exactly match
`watchLearningSubjectHash` and `lockSubject` in
`apps/admin/src/services/watch-learning-progress.service.ts`.

```sql
\set ON_ERROR_STOP on
\prompt 'Verified retained Auth subject: ' recovery_subject
BEGIN;
SET LOCAL lock_timeout = '5s';
SELECT pg_advisory_xact_lock(
  hashtextextended('watch-learning:' || :'recovery_subject', 0));
SELECT erased_at FROM watch_learning_erasures
WHERE subject_hash = encode(sha256(convert_to(:'recovery_subject', 'UTF8')), 'hex');
-- Copy the exact timestamp just inspected, after checking the incident record.
\prompt 'Confirmed fence timestamp (exact): ' recovery_erased_at
WITH removed AS (
  DELETE FROM watch_learning_erasures
  WHERE subject_hash = encode(sha256(convert_to(:'recovery_subject', 'UTF8')), 'hex')
    AND erased_at = :'recovery_erased_at'::timestamp
    AND NOT EXISTS (
      SELECT 1 FROM watch_learning_progress WHERE user_id = :'recovery_subject')
  RETURNING 1
)
SELECT count(*) = 1 AS recovered FROM removed \gset
\if :recovered
  COMMIT;
\else
  ROLLBACK;
  \echo 'Recovery refused: expected exactly one unchanged fence and no progress.'
\endif
\unset recovery_subject
\unset recovery_erased_at
```

Reopen mutation ingress only after a fresh sign-in and an explicit new save
succeed for the retained subject. Confirm old credentials remain rejected and
another subject's data is unchanged. Removing a fence never restores erased
data. If any verification fails, close ingress and investigate; do not retry
SQL blindly or remove fences in bulk.

## Regression proof

`apps/auth/src/services/account-deletion.service.test.ts` simulates Admin commit
followed by a lost response: the abort reports the uncertain erasure, does not
call user-row deletion, retains the fence, and sends no compensation request.
`apps/admin/src/services/watch-learning-progress.service.db.test.ts` proves the
fence rejects stale saves/resets, including a write waiting on the erasure lock,
and proves that an Admin transaction rollback restores both progress and the
ability to save. These deliberately preserve the privacy fence on Auth abort.
