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
   `SUPPORT_RESEARCH_ENABLED=false`. Record the reviewed merge commit and wait
   until that exact revision is active in the Mastra production service. Never
   bypass this sequence with local `railway up`.
5. Follow the database rollout below. The generic migrator applies every
   pending Mastra SQL migration: devotional `001`, support-research `002`, and
   Datadog `003`. The compatibility alias has the same complete migration set.

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

1. Record the production environment, canonical Railway deployment commit, and
   database identity. Verify the commit is the reviewed merge revision that
   contains the readiness commands and bounded generic migrator. Record the
   effective booleans for `SUPPORT_RESEARCH_ENABLED`,
   `SUPPORT_RESEARCH_PROVIDER_APPROVED`, `DEVOTIONAL_NEW_RUNS_ENABLED`, and
   `DATADOG_TRIAGE_ENABLED`; stop unless every value is false. A green
   deployment is not database evidence.
2. Read the live migration ledger ordered by `version`, inspect whether the
   `devotional_workspace`, `support_research`, and `datadog_triage` schemas
   already exist, and confirm `vector` is available to install. Verify the
   production migration identity has permission to create the extension,
   schemas, tables, and indexes before executing SQL.
3. Choose exactly one live-state branch:
   - No ledger rows and no component objects: clean bootstrap; continue.
   - An exact contiguous prefix (`001` only, or `001` and `002`) with all
     corresponding objects: continue; the generic migrator applies the
     remaining files through `003`.
   - Exact `001`, `002`, and `003` with all corresponding objects: do not
     rewrite history; continue directly to independent verification.
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
   extension, the devotional readiness row and required relations, and every
   support-research and Datadog relation. Verify each expected table has
   `relkind='r'`, each expected index has `relkind='i'`, and every expected
   index has `indisvalid=true`. Do not infer any of these from migrator output or
   command exit status. Use the read-only queries in **Independent production
   readback** below and retain their sanitized output with the approval record.
7. Inside the deployed Mastra environment, run
   `pnpm --filter @forge/mastra check:devotional-database-readiness`. Require
   `{"ready":true,"version":1}` even though ledger migration `002` is also
   present. Then run
   `pnpm --filter @forge/mastra check:support-research-database-readiness` and
   require `{"ready":true,"version":2}`. Both commands are read-only and print
   no connection details.
8. Reconfirm all four gates named in step 1 remain false. Migration readiness
   does not authorize devotional starts, model-provider use, Help Scout
   ingestion, or either support-research or Datadog Linear writes. Continue only
   with the separate dry-run and approval process below.

### Independent production readback

Run these queries through an independently authenticated read-only database
session, not through the migrator process. Output contains schema metadata only;
do not capture connection strings, credentials, or customer rows.

```sql
select version, name, sha256
from devotional_workspace.schema_migrations
order by version;
```

For the deployed migration set `001` through `003`, require exactly these
identities (and investigate any extra or missing row before continuing):

| Version | Filename                       | SHA-256                                                            |
| ------: | ------------------------------ | ------------------------------------------------------------------ |
|       1 | `001-devotional-workspace.sql` | `7e2d729677d829756ac6dc3980cc2bb78dd211b56b47db66feb752c1ce971dcf` |
|       2 | `002-support-research.sql`     | `516439bb11d4422d50a8eff496d3b87fecf57694c3f9d01d8cf3d16c2e4d6df9` |
|       3 | `003-datadog-triage.sql`       | `c0b19c8776e4d844b2256f7f8c680f295a365a62e18df25d69ce082fd2a2cf2c` |

Verify the extension and schemas independently:

```sql
select
  exists (select 1 from pg_extension where extname = 'vector') as vector_ready,
  to_regnamespace('devotional_workspace') is not null as devotional_schema,
  to_regnamespace('support_research') is not null as support_schema,
  to_regnamespace('datadog_triage') is not null as datadog_schema;
```

Require this relation query to return zero rows. A returned row identifies a
missing object, a wrong object kind, or an unusable index.

```sql
with expected(schema_name, relation_name, expected_kind) as (
  values
    ('devotional_workspace', 'schema_migrations', 'r'),
    ('devotional_workspace', 'filesystem_mutation_audit', 'r'),
    ('devotional_workspace', 'workspace_readiness', 'r'),
    ('devotional_workspace', 'catalog_generations', 'r'),
    ('devotional_workspace', 'catalog_entries', 'r'),
    ('devotional_workspace', 'catalog_head', 'r'),
    ('devotional_workspace', 'reconciliation_lease', 'r'),
    ('devotional_workspace', 'workflow_attempts', 'r'),
    ('devotional_workspace', 'clip_state', 'r'),
    ('devotional_workspace', 'publication_intents', 'r'),
    ('devotional_workspace', 'publication_history', 'r'),
    ('devotional_workspace', 'filesystem_mutation_audit_path_time_idx', 'i'),
    ('devotional_workspace', 'filesystem_mutation_audit_incomplete_idx', 'i'),
    ('devotional_workspace', 'catalog_entries_category_idx', 'i'),
    ('support_research', 'cursors', 'r'),
    ('support_research', 'runs', 'r'),
    ('support_research', 'observations', 'r'),
    ('support_research', 'actions', 'r'),
    ('support_research', 'action_sources', 'r'),
    ('support_research', 'reports', 'r'),
    ('support_research', 'support_research_runs_status_lease_idx', 'i'),
    ('support_research', 'support_research_observations_cluster_idx', 'i'),
    ('support_research', 'support_research_observations_theme_idx', 'i'),
    ('support_research', 'support_research_actions_live_fingerprint_idx', 'i'),
    ('support_research', 'support_research_actions_due_idx', 'i'),
    ('support_research', 'support_research_reports_expiry_idx', 'i'),
    ('datadog_triage', 'runs', 'r'),
    ('datadog_triage', 'cursors', 'r'),
    ('datadog_triage', 'service_baselines', 'r'),
    ('datadog_triage', 'seen_issues', 'r'),
    ('datadog_triage', 'monitor_states', 'r'),
    ('datadog_triage', 'spike_baselines', 'r'),
    ('datadog_triage', 'actions', 'r'),
    ('datadog_triage', 'datadog_triage_actions_due_idx', 'i'),
    ('datadog_triage', 'datadog_triage_actions_processing_idx', 'i'),
    ('datadog_triage', 'datadog_triage_actions_reserved_created_idx', 'i'),
    ('datadog_triage', 'datadog_triage_actions_reserved_deduplicated_idx', 'i'),
    ('datadog_triage', 'datadog_triage_actions_signal_idx', 'i')
), observed as (
  select expected.*,
         relation.relkind::text as actual_kind,
         index_metadata.indisvalid
  from expected
  left join pg_class as relation
    on relation.oid = to_regclass(
      format('%I.%I', expected.schema_name, expected.relation_name)
    )
  left join pg_index as index_metadata
    on index_metadata.indexrelid = relation.oid
)
select schema_name, relation_name, expected_kind, actual_kind, indisvalid
from observed
where actual_kind is distinct from expected_kind
   or (expected_kind = 'i' and indisvalid is distinct from true)
order by schema_name, relation_name;
```

Also require the devotional append-only function and trigger plus the readiness
row to exist:

```sql
select
  to_regprocedure('devotional_workspace.reject_audit_mutation()') is not null
    as audit_function,
  exists (
    select 1
    from pg_trigger
    where tgrelid =
      'devotional_workspace.filesystem_mutation_audit'::regclass
      and tgname = 'filesystem_mutation_audit_append_only'
      and not tgisinternal
  ) as audit_trigger,
  exists (
    select 1
    from devotional_workspace.workspace_readiness
    where singleton = true
  ) as devotional_readiness_row;
```

Preserve successful migration history during rollback. If the application
revision must be rolled back after the generic migrator succeeds, leave every
additive schema and ledger row in place, keep all gates false, and roll forward
to the corrected revision. Never drop successful objects, edit migration SQL,
or delete ledger history as rollback.

## Dry-run enablement

1. Provision Help Scout, allowed-host, retention, analysis, and approved-model
   settings while leaving `SUPPORT_RESEARCH_ENABLED=false`. Provider approval
   is a separate authorization boundary; migration approval does not imply it.
   Obtain and record that approval before setting
   `SUPPORT_RESEARCH_PROVIDER_APPROVED=true`. Keep
   `SUPPORT_RESEARCH_ENABLED=false`, `DEVOTIONAL_NEW_RUNS_ENABLED=false`, and
   `DATADOG_TRIAGE_ENABLED=false`.
2. From a freshly revalidated admin Studio session, run the workflow with
   `dryRun=true`, `maxConversations=5`, and a new bounded `idempotencyKey` such
   as `prod-readiness-20260821T120000Z-operator`. Record the key before launch,
   keep it at or below 120 characters, and never reuse it for a retry. Keep
   `SUPPORT_RESEARCH_ENABLED=false`: dry-run authorization does not enable the
   schedule. The runtime supplies a no-network Linear client, every proposed
   action is stored as `dry_run`, and neither Linear lookups nor creates are
   possible. Stop if any Linear request is observed.
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
   the live cursor to remain byte-for-byte unchanged. If no live cursor existed
   before the dry run, require it to remain absent afterward; do not treat a
   missing row as a newly initialized cursor.
6. Record the durable run status, bounded `cursorStart`/`cursorEnd` window,
   source/page counts, action states, zero action URLs, and the independent live
   cursor before/after result. Resolve privacy, precision, cursor, report-size,
   or duplicate findings before live enablement. An empty eligible Help Scout
   window proves connectivity and pagination only; it is inconclusive for the
   model/provider path and does not authorize live dispatch. Obtain a separately
   approved, still-bounded non-empty run or separately accepted provider-path
   evidence before requesting live authorization.

## Live rollout

Migration and dry-run success do not authorize live dispatch. Keep
`SUPPORT_RESEARCH_ENABLED=false` until the production evidence has been
reviewed and a separate explicit approval authorizes scheduled Help Scout and
Linear activity. Provider approval remains necessary but is not that live
approval.

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
