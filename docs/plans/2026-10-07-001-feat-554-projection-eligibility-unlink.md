# Retention cleanup of published projection eligibility links

The October 6 scheduled retention cycle reached expired request deletion and
then repeatedly failed in PostgreSQL's published-contribution update guard.
The eligibility-decision FK uses `ON DELETE SET NULL`, while its companion
revision check requires both columns to become null. The immutable-child
trigger permits only the older outcome-FK cleanup. Keep the retained projection
observation and its digest while letting the database clear this exact source
link and revision as the decision is deleted.

1. Confirm the live FK, CHECK, trigger and error class with bounded read-only
   probes. Keep the six earlier transaction deadline failures separate.
2. Add an append-only migration that permits only the nested FK-driven
   eligibility-link null transition, clears its companion revision, and leaves
   every other contribution field unchanged. Keep the existing outcome cleanup
   and all other update refusals.
3. Prove the original failure and rollback, then the migrated deletion and
   retained evidence, on an owned PostgreSQL fixture. Reject direct unlink and
   content edits, and recheck outcome and selection FK behavior.
4. Run focused tests, type/format checks and the normal commit hook. Open a
   scoped PR for independent review and normal PR-to-main deployment. After
   release, verify both Admin roles and subsequent ordinary loaded cycles;
   neither this fix nor earlier catch-up closes feat-554 by itself.
