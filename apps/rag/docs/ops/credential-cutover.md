# RAG credential cutover

This procedure separates HTTP consumer credentials from internal database
connections. Execute only within the owner's authorized incident scope and the
fixed targets in [environment-and-secrets.md](environment-and-secrets.md).
The owner selected PR-to-main and Railway autodeploy for this cutover; manual
redeploys, local-code uploads and unrelated service changes are excluded.

## Credential map

| Railway receiver on `@forge/rag`            | Database login before rotation   | Doppler `forge-rag/prd` copy             |
| ------------------------------------------- | -------------------------------- | ---------------------------------------- |
| `DATABASE_URL` (Postgres service reference) | `postgres`                       | `FORGE_RAG_POSTGRESQL_DB_URL`            |
| `RAG_CONSUMER_AUTH_DATABASE_URL`            | `forge_rag_consumer_auth_reader` | `FORGE_RAG_CONSUMER_AUTH_DATABASE_URL`   |
| `RAG_CONSUMER_WRITER_DATABASE_URL`          | `forge_rag_consumer_writer`      | `FORGE_RAG_CONSUMER_WRITER_DATABASE_URL` |
| `RAG_PORTAL_DATABASE_URL`                   | `forge_rag_portal`               | `FORGE_RAG_PORTAL_DB_URL`                |
| `RAG_USAGE_REPORT_DATABASE_URL`             | `forge_rag_usage_report_reader`  | `FORGE_RAG_USAGE_REPORT_DATABASE_URL`    |
| `RAG_USAGE_WRITER_DATABASE_URL`             | `forge_rag_usage_writer`         | `FORGE_RAG_USAGE_WRITER_DATABASE_URL`    |

The Postgres service's `DATABASE_URL`, `DATABASE_PUBLIC_URL`, `PGPASSWORD`
and `POSTGRES_PASSWORD` are occurrences of the owner credential, not four
independent passwords. Confirm actual references before updating them.

`forge_rag_evaluator` and `forge_rag_usage_inventory` are separate operator
logins recorded in Doppler. Check their live usage and exposure; their presence
does not itself require rotation. Never replace a read-only URL with the owner
URL. API callers such as Seeker and RAGBot authenticate through registered HTTP
consumer credentials; they do not receive the URLs in this table.

## Gate 1: reconcile before mutation

1. Confirm project, production environment, RAG service and its separate database
   by immutable identifiers. Record current main commit, active deployments,
   health, replica count, domains and pending configuration/deployments.
2. Read credential values only inside a controlled process. Compare Railway,
   Doppler and running-container copies in memory; emit names and equality only.
   Do not assume a saved variable is loaded by a running process.
3. Verify public and private endpoints identify the same database. Map all
   production service URL references and operator jobs. Inventory login roles,
   memberships, effective/SET-reachable privileges, role/database settings and
   active sessions without collecting SQL text, corpus data or password hashes.
4. Run `verifyConsumerRoles`, `verifyUsageRoles` and
   `verifyPortalSessionRenewal` from the deployed/main revision. Verify the
   evaluator with the read-only-role procedure when its connection changes.
   A successful connection alone does not establish least privilege.
5. Reconcile existing provider rotation evidence. Test a suspected stale vault
   copy before changing it; reuse an already-verified replacement rather than
   generating a second provider key. Record missed copies separately.

## Gate 2: prepare parallel restricted logins

This gate applies to the five restricted service roles, not `postgres`.

1. Keep the original logins and URLs working during preparation. Generate new
   independent passwords in memory and store replacement URLs in an approved
   vault under clearly marked staging names. Preserve rollback URLs in that
   vault, not files, shell history, command arguments or reports.
2. Use unique versioned login names with no superuser, role-creation,
   database-creation, replication or RLS-bypass privileges. Inspect role settings
   and object ownership before choosing how to grant access. Membership in the
   existing restricted role can preserve its grants; use explicit inheritance,
   no admin option, and account for SET ROLE reachability. Role settings are not
   inherited automatically. Do not copy broad grants merely to make checks pass.
3. Verify each replacement against the same effective privilege policies and
   database identity as its predecessor. Verify portal session expiry-update
   privileges and prohibit cross-schema access. Retain original memberships and
   grant-bearing roles; dropping them can break inherited access.
4. If any check fails, leave live receivers unchanged. Disable unused replacement
   logins and record their disposition. Do not proceed to the owner change.

## Gate 3: stage receivers and merge

1. Have the rollout PR reviewed, required checks green, and the operator ready
   for the merge window. Ensure the deployment includes a real change beneath
   `apps/rag/**`, which `railway.toml` watches; this runbook is within that scope.
2. Immediately before the agreed merge, recheck main, deployment state and
   competing variable changes. Update only the five verified role URLs using
   secret-safe input and **skip deployment**. Confirm that mechanism does not
   trigger a deployment. Preserve each URL's verified database, endpoint and
   options; update the matching Doppler copies in the same controlled window.
3. Verify the saved replacement values without displaying them. Staged variables
   may be picked up by another qualifying main merge, so coordinate the window
   and do not leave an unverified partial set waiting unattended.
4. Merge through the normal reviewed PR flow and follow Railway autodeploy.
   Record the actual main SHA and deployment ID, not just the PR head. The
   pre-deploy migration and portal grant command and `/v1/health` must pass.
5. Inspect the replacement runtime's loaded identities using an approved remote
   execution mechanism that prints no values. Check a fresh portal login,
   registered authenticated HTTP retrieval, usage collection/reporting and
   affected maintenance connections. Suppress query text and returned corpus.
   A health endpoint alone does not verify these workflows.
6. Set tracker status to **Verifying** during a bounded soak agreed with the
   owner. Require all intended instances to use replacements and no continuing
   use of old service logins before retirement. Preserve the old URLs until the
   soak and recovery checks pass; elapsed time alone is insufficient evidence.

If deployment or workflow checks fail, restore the previous saved URLs from the
vault without auto-deploying. Existing old containers may still work, but do not
assume they do. Recover through a reviewed revert/follow-up PR and autodeploy;
record remaining state and failures. No emergency manual redeploy is implied.

## Gate 4: retire restricted login access

After successful verification and the agreed soak, disable LOGIN and clear the
password on the old grant-bearing roles. Keep those roles and memberships if
replacement logins inherit their grants. Verify old credentials fail fresh
connections and new credentials still pass the grant checks. Password changes
and NOLOGIN do not close existing sessions: identify and terminate remaining
old-login sessions only after confirming they belong to superseded instances.
Retire rollback secret copies after the recovery window closes. Record both
provider/database retirement and runtime verification before marking Complete.

## Gate 5: PostgreSQL owner cutover

Handle the owner separately after restricted-role continuity is proven. Its
password still serves RAG's corpus connection and migration command, the
Postgres-service references and operator write jobs.

Prepare a separate reviewed PR under the watched RAG path, a verified recovery
access method, exact receiver/reference updates and a coordinated interruption
window. A password replacement on the same `postgres` login cannot retain the
old password for rollback. Do not claim zero downtime or confuse a platform
variable edit with changing the password in the live database.

At the coordinated owner cutover, change the database password through the
approved owner/platform mechanism, synchronize all reference sources and the
operator vault, and use the PR merge/autodeploy for the application update.
Confirm what the platform operation restarts before invoking it. If it requires
a separate database restart, obtain the owner's concrete decision before that
step. Test fresh owner authentication, migrations, application retrieval and
maintenance connectivity. Prove the old password rejects fresh connections,
then retire old authenticated sessions after replacements are healthy.

Do not create another superuser for rollback without reviewing its custody,
expiry and removal. If recovery access or the deployment window is unavailable,
leave the owner unchanged and record the blocker rather than partially rotating.

## Other credentials and evidence

GitHub repository admission token, GitHub OAuth client secret and embedding
gateway key are independent credential families. Replace each at its issuer,
verify its specific operation, deploy its receiver via PR-to-main, then retire
its predecessor. A fallback embedding success is not primary-gateway proof.
Registered HTTP consumer rotation immediately invalidates its prior verifier;
coordinate the caller update separately from database work.

Keep provider ownership, source/vault names, timestamp, PR/main/deployment IDs,
verification outcomes, accepted limits and retirement evidence in the shared
incident tracker. Preserve authoritative status/assignee cells and mirror
formulas. Use notes for detailed evidence; do not place secret values, URLs
containing passwords, tokens, hashes or raw exception objects in the tracker.

Preparation is **In progress**; staged credentials awaiting a merged deployment
are **Awaiting deployment**; replacement validation/soak is **Verifying**;
**Complete** requires cutover and retirement evidence. A merged documentation PR
alone proves none of these live outcomes.
