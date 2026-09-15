# Chat lifecycle migration and recovery (PR1)

PR1 installs storage protection and compatible cleanup. It adds no deletion HTTP
endpoint or UI. Feature 247 remains in progress. Public-release policy (feat-339)
and account-deletion integration (feat-356) remain separate.

## Release artifact and execution owner

The Mastra service operator owns migration, pause/drain verification, and planned
recovery. Use the **deployed PR1-or-later Mastra release**, built by
`pnpm --filter @forge/mastra build` in the existing Nixpacks pipeline. Run the
commands below in a shell inside that release container, from `apps/mastra` under
the deployment checkout root (normally `/app/apps/mastra` with Nixpacks). Verify
that location and the release revision before proceeding. The container's
`DATABASE_URL` must target its intended Mastra database. Do not source a developer
checkout's environment or run these operations from an older cached CLI.

```sh
node .mastra/operations/src/scripts/check-ai-chat-database-readiness.mjs
node .mastra/operations/src/scripts/migrate-ai-chat-database.mjs
```

The build emits runnable ESM operations plus `chat-migrations/` into
`.mastra/operations/`; package dependencies resolve from the same deployed
checkout. Preserve that directory when packaging the release. Copying only
`.mastra/output` omits the operations artifact. For a source checkout, the
corresponding commands are `pnpm --filter @forge/mastra
check:ai-chat-database-readiness` and `pnpm --filter @forge/mastra
migrate:ai-chat-database`. The legacy `migrate:database` and
`migrate:devotional-database` **do not apply chat migrations**.

Migration is explicit. Neither the build nor application boot runs it. Native
initialization runs under the chat migration advisory lock before application
SQL; application SQL exclusively locks both content tables while validating,
backfilling and installing guards. Lock acquisition is limited to 2 seconds;
migration statements to 30 seconds. A failed migration transaction rolls back its
history and application objects. Native SDK initialization may already have
created its own tables; retry uses those tables. Applied checksums are immutable.

## Deploy, pause, migrate, resume

1. Deploy PR1 through the normal PR-to-main release pipeline. Confirm every
   runtime instance, scheduled-worker instance and operator erasure tool uses
   compatible code. Record the deployed revision separately from code review.
2. Before pausing, record the intended pre-window values of
   `AI_CHAT_TITLE_REPAIR_ENABLED` and `SEEKER_ROUTE_ENABLED`, including whether
   either was unset, in the operator change record. Keep this record through
   migration or restore; if already paused, retain the original pre-window values.
   Establish a controlled window: deny chat ingress at the gateway/network
   boundary, including native Mastra agent/API routes. Set both
   `AI_CHAT_TITLE_REPAIR_ENABLED=false` and `SEEKER_ROUTE_ENABLED=false` to stop
   title-repair work and block custom Forge routes. The existing declarative
   title-repair schedule can still fire, but its admission gate must report
   `flag_disabled` or `lane_disabled` before opening storage or calling a model.
   Neither ingress denial nor `AI_CHAT_MAINTENANCE_PAUSED` stops that schedule.
   These flags alone do not block native Mastra routes. Set `AI_CHAT_MAINTENANCE_PAUSED=true` in the
   service release configuration and restart through the normal release process.
   This suppresses retention launches and the operator PostgreSQL erasure half;
   independent Langfuse erasure remains independent. Stop using old operator
   commands. Let in-flight writes, detached titles/follow-ups, old retention runs
   and operator operations finish; verify old processes are gone and their
   database transactions have ended. Title-repair flags are checked at admission,
   so already-admitted scheduled or manual Studio repair runs must finish or be
   stopped with their old process before migration or restore. Verify no such
   run or detached title/model callback remains; empty database activity alone
   does not prove that model work has drained. An empty user roster is not drain evidence.
   If quiescence cannot be established, postpone activation.
3. Run the explicit migration from the verified release container. On failure,
   keep operations paused, investigate count/enum diagnostics, and repair/retry.
   Do not run the unrelated migration stream as a substitute. Do not suppress a
   checksum, schema, orphan or owner-integrity failure or silently delete data.
4. Run the readiness command. Require `state=ready storage_covered=true`, exit 0.
   Verify `ai_chat.forge_schema_migrations` has the deployed SQL checksum and
   verify ordinary native creation yields live coordination rows using approved
   synthetic data. Re-run compatible retention and an exact-key erasure preview
   after unpausing maintenance. Record these production observations separately;
   local tests do not establish production activation.
5. In a normal compatible release, remove `AI_CHAT_MAINTENANCE_PAUSED` and restore
   `AI_CHAT_TITLE_REPAIR_ENABLED` and `SEEKER_ROUTE_ENABLED` to their recorded
   pre-window intended values, removing an override if its prior value was unset.
   Do not enable a capability that was previously disabled. Restore ingress and
   verify the intended route/title-repair configuration took effect; confirm
   `purge_complete` rather than `purge_deferred`/`purge_failed`.
   PR2 may follow with the endpoint, repair owner binding and SDK diagnostic
   boundary; PR3 may follow with the UI. Under the agreed current empty-roster,
   closely-following-PR2 assumption, PR2 diagnostics are not a migration prerequisite.

Readiness is refreshed on each check/operation; no process permanently caches
`not_applied`. `not_applied` means the database was reachable and application
migration objects were absent. `incompatible` means partial objects, wrong
checksum, missing/disabled guards or unsupported schema. `error` means the check
could not establish the database state. None permits lifecycle cleanup or a
successful explicit deletion. Before migration, retention reports
`purge_deferred reason=not_applied`; an explicit maintenance pause reports
`purge_deferred reason=paused`. Partial/mismatched installation reports a failed
retention outcome and `purge_failed reason=incompatible`, while an unreadable
database reports `purge_failed reason=readiness_error`. Uncovered storage reports
`purge_failed reason=uncovered_storage`. These failures are not ordinary
pre-migration deferral. Operator erasure reports `postgres=not_ready`
(exit 1), while still attempting its independent Langfuse half.

Check readiness using the runtime database role. The readiness contract requires
`USAGE` on `ai_chat`, `SELECT` on migration history, each of
`SELECT`/`INSERT`/`UPDATE`/`DELETE` on lifecycle and native content tables, and
`EXECUTE` on each of the four guard functions. These privileges are checked
individually: PostgreSQL's comma-separated privilege argument accepts any listed
privilege. Missing schema access can produce `error`; missing table/function
access must never produce `ready`. The explicit function-access requirement is
a readiness policy, not a claim that PostgreSQL rechecks `EXECUTE` on every
trigger invocation.

## Storage and cleanup contract

`ai_chat.forge_conversation_lifecycle` contains only `id`, exact `resourceId`, and
`deleted`. The globally unique ID follows native thread identity. Deleted rows
have no title, messages or deletion timestamp. Ordinary retention keeps them;
expired content and live bookkeeping are removed together. Native deletion can
leave live bookkeeping, which retention collects after rechecking parent absence.

All controlled cleanup locks lifecycle, messages, then thread. Retention rechecks
current activity after content locks, since SDK UPDATE paths do not take lifecycle
locks. Thread/message INSERT arms (including upserts) take shared lifecycle locks;
identity UPDATE guards take no lifecycle lock. Parent cascade prevents orphan
messages. Do not disable these triggers/constraints or repoint an old writer at
unguarded tables. Additional memory content stores must extend deletion coverage;
current working memory, semantic recall and observational memory remain disabled.

Operator erasure uses the existing exact resource, preview/confirm and independent
per-store outcome contract. Preview reports `threads` and `records`; execution
reports `threads_deleted` and `records_deleted`, including committed partial
progress on failure. Records are discovered independently of live threads. A
record-only erasure is not `no_data`. Removing a marker deliberately removes its
recreation protection: outstanding requests/still-valid sessions can persist
again. This accepted R13 exception does not permit overwriting another owner's
row. Langfuse single-conversation behavior and its 25-day retention are unchanged.

## Rollback floor

Before activation, reverting PR1 requires verifying no migration took effect.
After any activation/backfill, retain PR1-compatible cleanup and schema even if
no user has deleted a conversation. Prefer forward repair. Do not drop lifecycle
rows/guards or return to unaware cleanup. A failed post-migration deployment keeps
operations paused until a compatible build is restored. PR2/PR3 may hide their
surface but must preserve this foundation (and PR2 repair/diagnostics where
applicable). A database backup alone is insufficient evidence of current deletions.

## Planned restore: exact current marker reconciliation

The same Mastra service operator owns all steps. This is planned recovery only;
if authoritative current state cannot be recovered after a disaster, **do not
resume the affected chat store**. Missing input cannot be interpreted as empty.

1. Record the pre-window intended values of `AI_CHAT_TITLE_REPAIR_ENABLED` and
   `SEEKER_ROUTE_ENABLED`, including unset values, as in deployment step 2; reuse
   the original record if already paused. Disable both flags, deny all
   custom/native ingress, pause maintenance/operator erasure and drain all
   detached work as above. Keep these controls in place through step 6.
2. In the verified current release container, choose an operator-controlled,
   private temporary path and capture the **complete authoritative current** set:

   ```sh
   node .mastra/operations/src/scripts/restore-ai-chat-markers.mjs capture /tmp/chat-current-markers.json --confirmed-paused
   ```

   Capture locks the database tables for a consistent set. It creates the file
   exclusively with mode 0600, containing only markers, a completeness indicator,
   count and checksum. A verified zero-count capture is valid. Record its
   authoritative origin/completion in the incident record without identifiers.
   The checksum detects damaged input; it does not prove the operator selected
   the authoritative database. Protect this temporary input across the database
   restore, without publishing it or placing it in source control.

3. Restore the planned older database snapshot using the platform's normal
   recovery operation. Keep traffic/maintenance paused. Use the same compatible
   release artifact against the restored database. If the snapshot predates the
   chat migration, run that migration first; readiness must pass before reconciliation.
4. Reconcile from the protected current input:

   ```sh
   node .mastra/operations/src/scripts/restore-ai-chat-markers.mjs reconcile /tmp/chat-current-markers.json --confirmed-paused
   ```

   One transaction replaces the restored deleted subset with the **exact current
   set**, removes matching-owner restored content and checks remaining live rows.
   Old backup markers omitted from current input may have been operator-erased;
   they must not return. Conflicting restored owners abort the entire transaction
   for explicit operator resolution; never reassign ownership or delete foreign
   content to make recovery pass. Missing/incomplete/damaged input refuses before
   mutation. A failure retains the protected file and leaves operations paused.

5. Require command success, readiness success, and removal of the temporary file
   before resuming. Reconciliation deletes its input only after committed success;
   an unlink failure is a failure requiring operator cleanup while still paused.
   Securely remove any temporary transfer copies too. There is no permanent new journal.
6. Resume only after recording the observed guard/readiness and exact-set checks.
   In a normal compatible release, remove `AI_CHAT_MAINTENANCE_PAUSED` and restore
   `AI_CHAT_TITLE_REPAIR_ENABLED` and `SEEKER_ROUTE_ENABLED` to their recorded
   pre-window intended values, removing an override if its prior value was unset.
   Do not enable a previously disabled capability. Restore ingress, verify the
   intended route/title-repair configuration, and confirm `purge_complete` as in
   deployment step 5.
   Rehearse this procedure with disposable snapshots, including erased markers,
   verified empty input, owner conflict and missing input, before production use.

## Local verification and costs

The real SDK suite requires a dedicated local database named with suffix
`_lifecycle_smoke`. It drops/recreates that database's `ai_chat` schema and uses
synthetic content only:

```sh
CHAT_LIFECYCLE_PG_TEST=1 \
CHAT_LIFECYCLE_TEST_DATABASE_URL=postgresql://localhost/forge_lifecycle_smoke \
pnpm --filter @forge/mastra exec vitest run src/mastra/ai-chat-conversation-lifecycle.smoke.test.ts
```

Run Mastra tests, typecheck, lint, build, touched-file formatting and migration
artifact execution on a second fresh disposable database. The SDK suite measures
blocked-target versus unrelated-ID latency, pool occupancy, and heap/index bytes;
these are local observations, not production capacity guarantees. The shared
history-write/lifecycle pool remains capped at 2 (replaces no additional pool),
SDK chat storage at 5. Transaction acquisition is capped at 2 seconds, lock waits
at 1 second, and the entire attempt/retry budget at 7 seconds. No connection is
held across model generation. Long-lived deleted-record growth is intentional;
feat-339 owns public admission/abuse policy, not a new expiry rule in PR1.
