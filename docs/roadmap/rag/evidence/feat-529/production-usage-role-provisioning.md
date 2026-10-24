# Production usage role provisioning audit

> Historical audit/verification only. The product owner removed coverage,
> deployment inventory and collector recovery requirements on 2026-09-29 as a
> design mistake. Old coverage results and activation recommendations below are
> superseded by the corrected consumer-usage runbook; recorded past writes remain
> unchanged. Do not run the retired inventory/reconciliation commands.

## Applied change and authorization

This is a retrospective record of an operation already applied on **2026-09-29**,
not a proposed migration or executable deployment. Jaco asked the Ops agent to
perform the production usage/report-role provisioning, collection configuration
and accurate deployment inventory after feat-528 merged. The operation completed
only the role/credential portion; Railway configuration and inventory declaration
remain pending. Jaco subsequently requested this audit PR.

Target: Forge RAG production database, `forge` / `production` / `@forge/rag`.
The operator connection's host was checked against the separately configured
`FORGE_RAG_EXPECTED_POSTGRES_HOST` before connecting. No host, connection string,
password, personal consumer key, bearer or corpus payload is included here.

Feat-528 merged in [PR #2455](https://github.com/JesusFilm/forge/pull/2455), commit
`93ae0113013cf57a751799dde1a52d4c33a5dec1`. The `usage_private` tables and report
views were already present when this operation began; no migration was run.

## Exact write scope

**PostgreSQL security metadata changed.** Three login roles were created and
schema/table ACLs were updated. These are writes to PostgreSQL's role and
privilege catalogs, even though no application table data or structure changed.

For each fixed role below, the operator executed `CREATE ROLE` with these options:

```sql
-- Audit template only; the generated password is intentionally omitted.
CREATE ROLE <role_name> LOGIN PASSWORD '<generated-password>'
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;
GRANT USAGE ON SCHEMA usage_private TO <role_name>;
```

The three role names were `forge_rag_usage_writer`,
`forge_rag_usage_report_reader` and `forge_rag_usage_inventory`. The additional
statements were exactly:

```sql
GRANT SELECT, INSERT, UPDATE
  ON usage_private.minutes, usage_private.collectors,
     usage_private.gaps, usage_private.denials
  TO forge_rag_usage_writer;
GRANT SELECT, INSERT, DELETE ON usage_private.pending
  TO forge_rag_usage_writer;

GRANT SELECT
  ON usage_private.consumer_labels, usage_private.report_minutes,
     usage_private.report_collectors, usage_private.report_pending,
     usage_private.report_gaps, usage_private.report_inventory
  TO forge_rag_usage_report_reader;

GRANT SELECT, INSERT, UPDATE ON usage_private.deployment_inventory
  TO forge_rag_usage_inventory;
```

All role creation and grants ran in one database transaction. No existing role
was altered or dropped, no memberships were added, and no default privileges
were changed. Prechecks found no matching usage roles.

**Doppler received three new credential records** in `forge-rag/prd`:

| New receiver name                        | Database account                |
| ---------------------------------------- | ------------------------------- |
| `FORGE_RAG_USAGE_WRITER_DATABASE_URL`    | `forge_rag_usage_writer`        |
| `FORGE_RAG_USAGE_REPORT_DATABASE_URL`    | `forge_rag_usage_report_reader` |
| `FORGE_RAG_USAGE_INVENTORY_DATABASE_URL` | `forge_rag_usage_inventory`     |

These are service/operator credentials, separate from the personal RAGBot
consumer key. Prechecks refused existing entries. Passwords were independently
generated using 32 cryptographic random bytes per account. Connection values
were passed to the vault through stdin, with command output captured privately.
The entries were persisted before enabling the database logins. PostgreSQL and
Doppler are separate systems; there was no cross-system atomic transaction.

## Operations not issued

This operation issued no `CREATE SCHEMA`, `CREATE TABLE`, `ALTER TABLE`, view or
column changes, or application `INSERT`, `UPDATE`, `DELETE` or `TRUNCATE`.
In particular, no writes were issued to corpus, consumer, usage aggregate,
collector or deployment-inventory rows. No consumer was created or changed.
No personal retrieval key was accessed. No Railway settings, deployment or
replica expectation was changed, and no migration grace/cutoff was started.

These statements describe the operator's execution scope, not a claim that
other concurrent application traffic made no writes.

## Verification and provenance

Before provisioning, read-only inspection confirmed the existing usage tables/
views and absent usage-role names. After provisioning, the operator connected
as each new account and ran the merged `verifyUsageRoles` and
`verifyUsageInventoryRole` checks from
`apps/rag/scripts/consumer-role-policy.ts`. Both passed. The checks reject extra
or missing table/column privileges, unsafe role flags, schema creation rights,
ownership, sequence access and privileges reachable through role switching.
The named accounts were confirmed by a subsequent metadata read.

Operator source retained on the VM:
`/home/jacobuntu/Ops/config/ragbot/operator/provision-usage-roles.mts`.
Its SHA-256 is `179941197edc9cf77c9e710728421d11ef9f00d3435c8987b685445bb27a6df3`. Do not rerun it as part of this PR;
it refuses existing role/receiver names. No executable provisioning source or
password SQL is being installed through this documentation PR.

The date is known from the execution session. An exact database commit timestamp
was not captured; this record does not invent one. Verification output contained
only pass/fail and safe account metadata. This is not a comprehensive audit of
server-side logging configuration or unrelated concurrent operations.

## Remaining activation and recovery

Railway needs the writer/report connections configured under the service names
`RAG_USAGE_WRITER_DATABASE_URL` and `RAG_USAGE_REPORT_DATABASE_URL`, using its
actual private database endpoint. Inventory credentials remain operator-only.
Authoritative Railway deployment IDs, UTC intervals and replica expectations
must be declared with the separate inventory account. Do not derive expectations
from collector self-registration or fabricate covered history.

No Railway access was available in the provisioning session, so those actions
were not attempted. Follow [the usage runbook](../../../../../apps/rag/docs/ops/consumer-usage.md)
and then perform feat-529's counted HTTP, isolation, lifecycle and coverage proof.

### Manual Railway activation handoff — 2026-09-29

Jaco elected to apply Railway settings manually. The agent cancelled its pending
browserless CLI sign-in; no Railway configuration or inventory rows were changed
in that activation attempt. On `forge` / `production` / `@forge/rag`, stage both
settings below and apply them together through the normal service configuration
deployment of merged code:

| Railway variable                | Existing Doppler source (`forge-rag/prd`) |
| ------------------------------- | ----------------------------------------- |
| `RAG_USAGE_WRITER_DATABASE_URL` | `FORGE_RAG_USAGE_WRITER_DATABASE_URL`     |
| `RAG_USAGE_REPORT_DATABASE_URL` | `FORGE_RAG_USAGE_REPORT_DATABASE_URL`     |

Use the corresponding provisioned account and the same production database.
The stored operator URLs use the public endpoint and passed the role checks.
For a private-network service connection, retain the credentials/database and
use the actual private host and port from that database's Railway configuration;
do not invent a hostname or port. Transfer values directly from the vault to
Railway, without including them in audit evidence.

There is no separate usage-enable flag. Railway supplies `RAILWAY_DEPLOYMENT_ID`;
do not pin a static override. Existing consumer auth and portal session
configuration are prerequisites. Portal access needs neither machine report
hashes nor `RAG_USAGE_RAGBOT_CONSUMER_ID`. The inventory credential belongs only
in the independent operator receiver, not the serving environment or RAGBot.

After configuration deployment, capture its ID, merged revision, authoritative
UTC active interval and configured replica count, including overlapping live
deployments. Use those facts to declare inventory through `pnpm usage:inventory`
and record the exact inserted/closed rows in a subsequent audit receipt. Do not
close an interval until every replica has stopped. Verify collectors and a
fully covered whole-minute portal report after activation; a default seven-day
window includes uninstrumented history and cannot prove complete coverage.
This handoff is a plan, not evidence that production reporting is active.

### Applied Railway variable activation — 2026-09-29

Jaco subsequently authorized the agent to apply exactly the two reviewed
variables and completed Railway CLI authentication. At
`2026-09-29T03:28:01.498201Z`, Railway acknowledged a service-specific
`variableCollectionUpsert` for `forge` / `production` / `@forge/rag`, with
`replace: false` and `skipDeploys: false`. Both variables were absent before the
operation and were copied directly from the vault sources listed above. URL
account names and the independently pinned production database host were
checked before transfer. Values remained in subprocess memory/stdin; no secret
was printed or saved in this audit.

The subsequent comparison confirmed exactly these two variable names changed,
both values matched their vault sources, and every other returned variable was
unchanged. An unrelated staged patch for another service existed before the
operation and remained unchanged afterward. No environment-wide patch was
committed, no variable was removed and no local worktree code was deployed.
Safe receipt: [production-usage-variable-activation.json](production-usage-variable-activation.json).

The update triggered deployment `3c7abf21-c6f9-46a7-90be-3b32e2d3fbf7` from
merged main commit `2233e06a2edc0b98457b4967c197141e4ba3e172` (PR #2460),
created at `2026-09-29T03:28:01.503Z`. Railway reported `SUCCESS` at
`2026-09-29T03:33:41.130Z`; the health endpoint returned HTTP 200. A subsequent
read through the aggregate-only account confirmed an open collector for this
deployment with a fresh heartbeat and acknowledged watermark. Safe receipts:
[deployment verification](production-usage-deployment-verification.json) and
[collector verification](production-usage-collector-verification.json).
Its inventory view contained no row for this deployment, so complete report
coverage remains unproven. This variable change enables the service's usage
collector to write its own accounting/heartbeat rows; it is distinct from the
earlier role-only provisioning. The operator issued no application-row writes,
inventory declarations, schema changes, credential rotations or cutoff in this
step. Inventory and counted/report coverage proof remain pending.

Retained operator source:
`/home/jacobuntu/Ops/config/ragbot/operator/activate-usage-variables.py`;
SHA-256 `89d38802553772ec3edf3f2074d9ba77d5b290e35819fcff2ce53ca8a148fbd9`.
It refuses preexisting usage settings or staged changes for the target service;
do not rerun it to verify activation.

After the RAG update's completed comparison, Jaco reported accidentally applying
the unrelated staged patch. A read-only inspection identified patch
`ceb2e619-f136-4707-a057-dc8fca307b27`, applied at
`2026-09-29T03:30:27.934Z` by `jaco-brink`, affecting only `@forge/mastra`.
It contained `DATADOG_TRIAGE_API_KEY`, `DATADOG_TRIAGE_APP_KEY` and
`LINEAR_DATADOG_TRIAGE_API_KEY`, and triggered deployment
`d1dd4573-f20a-44a3-b827-24622e1d77f2`. This was a later, separately applied
change, outside the RAG mutation. The agent inspected it without reverting any
configuration; the original staging author was not established by the available
patch/audit records.

To retire these capabilities later, first establish whether serving/reporting
has been activated and which callers depend on them, then disable the applicable
capability, revoke grants/login and remove receiver entries in explicitly scoped
operations. Do not drop usage tables, delete history, or revive shared bearer
access as an incidental rollback. This PR performs no rollback or further
production change.
