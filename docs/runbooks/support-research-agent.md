# Support and user research agent runbook

## Purpose and safety boundary

The Mastra `daily-support-research` workflow reads newly created Help Scout
conversations about the public Watch/catalog experience, sanitizes them,
classifies product signals, performs bounded public HTTP validation, and creates
deduplicated Linear issues and a daily summary. It never replies to customers,
changes Help Scout, downloads attachments, sets Linear priority/assignee, or
changes product code.

The capability is default-off. Sanitization reduces direct identifiers but is
not guaranteed anonymization. Do not enable it until the selected model
provider, its retention/data-processing terms, and the configured 90-day-or-
shorter minimized-content retention have been approved for support data.

## Provisioning

1. Create a Help Scout OAuth application for the intended account and record
   the exact mailbox IDs. Help Scout does not provide the v1 workflow with a
   mailbox mutation method: the client code allows only token acquisition and
   GET requests under `api.helpscout.net/v2`.
2. Create a distinct Linear service identity and record the team, rolling
   support-insights project, confirmed-bug label, `Needs validation` label, and
   UX/research label IDs. Keep the new identity in normal triage/backlog; do not
   grant it workflow administration it does not need.
3. Set the exact public Watch hostnames. Do not add localhost, private hosts,
   alternate ports, wildcard domains, or domains supplied by tickets.
4. Deploy through the normal PR-to-main Railway flow with
   `SUPPORT_RESEARCH_ENABLED=false`.
5. Follow the database rollout below. The generic migrator applies every
   pending Mastra SQL migration, including devotional `001` and support-
   research `002`; the compatibility alias has the same complete migration
   set.

Relevant variables are documented in `apps/mastra/.env.example`. Secrets must
be Railway references, never committed values. `SUPPORT_RESEARCH_PROVIDER_APPROVED`
is a separate gate; it does not replace the feature gate.

## Database migration rollout

Keep `SUPPORT_RESEARCH_ENABLED=false`,
`SUPPORT_RESEARCH_PROVIDER_APPROVED=false`, and
`DEVOTIONAL_NEW_RUNS_ENABLED=false` throughout this procedure. Keep
`DATADOG_TRIAGE_ENABLED` unset or `false` as well, because the generic migrator
also applies Datadog migration `003` when it is pending. Deploy the
component-scoped devotional readiness reader before applying migration `002`;
the older reader mistakes the newest shared-ledger version for the devotional
version and will fail closed after `002`.

1. Record the production environment, canonical Railway deployment commit,
   database identity, and current values of all three gates. A green deployment
   is not database evidence.
2. Read the live migration ledger ordered by `version`, inspect whether the
   `devotional_workspace` and `support_research` schemas already exist, and
   confirm `vector` is available to install. Verify the production migration
   identity has permission to create the extension, schemas, tables, and
   indexes before executing SQL.
3. Choose exactly one live-state branch:
   - No ledger rows and no component objects: clean bootstrap; continue.
   - Exact `001` only: deploy the corrected reader, then continue to apply
     pending `002`.
   - Exact `001` and `002`: do not rewrite history; deploy and continue to
     verification.
   - Any missing, renamed, or checksum-mismatched identity; partial schema;
     schema objects without matching ledger rows; unavailable PgVector; or
     insufficient privileges: stop and investigate. Do not edit applied SQL or
     insert ledger rows by hand.
4. Immediately after the fresh read-only preflight above, obtain explicit
   approval for exactly one production migration attempt. Record the production
   environment, deployed revision, database identity, complete generic
   migration set, and saved baseline in the approval. The approval expires if
   any observed state changes, if execution does not follow immediately, or if
   the attempt reaches either of its transaction-local bounds: 15 seconds
   waiting for a lock or 5 minutes for a statement.
5. From the corrected production revision, run
   `pnpm --filter @forge/mastra migrate:database`. The advisory-locked migrator
   applies all pending files and their ledger entries in one transaction. On
   timeout or any other failure, the transaction rolls back and the client is
   released without a successful result. Require direct readback to match the
   saved baseline, then repeat the entire fresh preflight and obtain renewed
   explicit approval before retrying; the prior approval cannot authorize a
   retry.
6. Independently read back every deployed migration identity, the `vector`
   extension, the devotional readiness row and required relations, and the
   support-research cursor, run, observation, action, action-source, and report
   relations plus their six indexes. When deployed migrations include Datadog
   `003`, also read back its exact ledger identity and required relations. Do
   not infer any of these from command exit status alone.
7. Inside the deployed Mastra environment, run
   `pnpm --filter @forge/mastra check:devotional-database-readiness`. Require
   `{"ready":true,"version":1}` even though ledger migration `002` is also
   present. Then run
   `pnpm --filter @forge/mastra check:support-research-database-readiness` and
   require `{"ready":true,"version":2}`. Both commands are read-only and print
   no connection details.
8. Reconfirm the three named gates remain false and Datadog triage remains
   unset or false. Migration readiness does not
   authorize devotional starts, model-provider use, Help Scout ingestion, or
   either support-research or Datadog Linear writes. Continue only with the
   separate dry-run and approval process below.

Preserve successful migration history during rollback. If the application
revision must be rolled back after `002`, leave both schemas and ledger rows in
place, keep all gates false, and roll forward to the corrected reader; the old
reader will safely report devotional migration unavailable while `002` is the
global ledger head.

## Dry-run enablement

1. Provision Help Scout, allowed-host, retention, analysis, and approved-model
   settings while leaving `SUPPORT_RESEARCH_ENABLED=false`. Provider approval
   is a separate authorization boundary; migration approval does not imply it.
2. From a freshly revalidated admin Studio session, run the workflow with
   `dryRun=true`, a small `maxConversations`, and a unique `idempotencyKey`.
   Keep `SUPPORT_RESEARCH_ENABLED=false`: dry-run authorization does not enable
   the schedule. The runtime supplies a no-network Linear client, every
   proposed action is stored as `dry_run`, and neither Linear lookups nor
   creates are possible.
3. Inspect the durable run report and a sample of sanitized observation rows.
   Confirm that customer names/contact details, quoted history, tokens,
   attachments, raw HTML, and irrelevant tickets are absent; Watch URLs use
   exact allowed hosts; and HTTP success is not described as proof of playback
   or interaction behavior.
4. Review every proposed issue. Confirm normal bugs have exact reproduced HTTP
   evidence, inferred bugs say `Needs validation`, usability work meets the
   distinct-source threshold, and descriptions distinguish reported evidence,
   automated checks, model inference, and missing proof.
5. Compare the report's `cursorStart` and `cursorEnd` (the bounded dry-run
   window) with an independent readback of the live Help Scout cursor. Require
   the live cursor to remain byte-for-byte unchanged or absent.
6. Run a full-window dry run. Resolve privacy, precision, cursor, report-size,
   or duplicate findings before live enablement. An empty eligible Help Scout
   window proves connectivity and pagination only; it is inconclusive for the
   model/provider path and does not authorize live dispatch.

## Live rollout

Start with the default five product issues plus one summary per UTC day. For the
first two live weeks, review every generated action and record confirmed-bug
precision, `Needs validation` usefulness, duplicate creation, privacy defects,
cursor lag, deferred action count, and comparable human triage time. Keep
privacy defects and duplicate creations at zero. Do not raise budgets or add
new feedback sources based on ticket volume alone.

Expected schedule: `05:00 UTC` daily. Mastra captures one immutable cutoff,
replays a five-minute cursor overlap, and deduplicates sources. A `partial` run
advances only through its last persisted source. A `complete` run advances to
the cutoff. Cursor lag greater than 36 hours requires investigation.

## Monitoring and recovery

Monitor safe counters only: run status/duration, cursor lag, source and page
counts, redaction count, relevant rate, model failures, validation states,
clusters, action outcomes, budget deferrals, outbox age/retries, and report
size. Logs and traces must contain run IDs, source IDs/hashes, fingerprints,
counts, and safe reason codes only.

- `feature_disabled` or configuration reasons: correct the named variable; no
  secret value is included in the report.
- Help Scout `auth_failed`: rotate the client secret and rerun with a unique
  operator key. A 429/timeout yields a partial run and a resumable cursor.
- Stuck run: confirm its lease expired before rerun. Do not edit a live lease.
- Linear timeout after create: leave the action retryable. The next dispatch
  searches recent team issues for its hidden fingerprint marker before retry.
- Old retryable outbox action: inspect the safe error code and Linear for the
  marker. Actions stop automatically after five failed attempts; reconcile the
  terminal row rather than cloning it.
- Sudden issue spike or poor precision: set `SUPPORT_RESEARCH_ENABLED=false`.
  Existing observations/reports remain available and no new dispatch runs.
- Privacy concern: disable immediately, rotate affected credentials when
  relevant, preserve only safe identifiers for investigation, remove improper
  Linear content through the normal human process, and follow the organizational
  privacy incident procedure.

## Retention and rollback

Detailed sanitized excerpts and daily reports expire after the configured
retention (90 days by default). Minimal source/action fingerprints and Linear
identity remain to prevent duplicates. Use a shorter approved duration when
required; never lengthen beyond 365 days without a new review.

Rollback is the feature flag. Disable scheduled ingestion and dispatch, leave
the additive schema in place, and retain retryable actions for explicit
reconciliation or cancellation. Do not drop tables or edit migration history as
an operational rollback.

## Deferred work

Beta-tester and other feedback forms require separate authenticated source
adapters, cursors, retention/deletion contracts, and privacy review. Help Scout
notes/tags/replies, browser reproduction, customer follow-up, code changes,
priority, assignment, and workflow-state mutations remain outside v1.
