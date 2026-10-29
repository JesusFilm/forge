# PR1087 distributed callback revision guard (feat-908 recovery)

Scope: close the read-then-write race between Manager replicas after Admin execution
operations complete. Preserve the integrated admission changes, operation row-lock
fences, and source/graph ownership. No new roadmap ID; recovery ticket status and
final generated GraphQL artifacts remain with the recovery integrator.

1. Add migration 0166 and an integer job revision starting at zero. Every Admin job
   update increments it; optional expectedRevision compares under the existing row
   lock before mutation. Preserve legacy caller compatibility and active-operation
   checks. Do not use updatedAt as a revision.
2. Expose the revision through Pothos and the raw Manager client. Callback, dispatch,
   reset, restamp, watchdog, artifact merge, and step writes send their read revision.
   Callback conflicts return 503 through the existing failure path; ownership
   changes fail closed without rebasing an old intent onto a new owner.
3. Verify two Prisma pools and separate Manager processes against isolated loopback
   PostgreSQL: held old callback versus new owner, parallel same-run steps,
   duplicate replay, stale ownership operations, fixed timestamps, and existing
   incomplete-operation fences. Confirm callback sender retry/ownership-loss tests.
4. Review scope, run focused tests/typechecks/lint/format and enabled commit hooks,
   then compound rollout/verification details into the existing execution-fence
   solution. No push, merge to main, deployment, or paid-provider calls.

Verification completed on Node 24.22.1: 70 focused Admin tests (including 26 real
PostgreSQL tests), 112 Manager tests, and 36 Mastra transport tests pass. Full Admin
and Manager typechecks and lint pass. Temporarily disabling only the revision
comparison makes all three callback race tests fail; restoring it passes. The
standalone fixture database uses a unique schema per suite on loopback and is
removed after each suite; no shared database or provider is accessed.
