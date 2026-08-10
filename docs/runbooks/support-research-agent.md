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
4. Apply `pnpm --filter @forge/mastra migrate:database` before deployment or
   enablement. The migrator is immutable and checksum-verified; investigate any
   checksum mismatch instead of editing an applied SQL file.
5. Deploy through the normal PR-to-main Railway flow with
   `SUPPORT_RESEARCH_ENABLED=false`.

Relevant variables are documented in `apps/mastra/.env.example`. Secrets must
be Railway references, never committed values. `SUPPORT_RESEARCH_PROVIDER_APPROVED`
is a separate gate; it does not replace the feature gate.

## Dry-run enablement

1. Provision Help Scout, allowed-host, and approved-model settings while leaving
   the main feature flag false.
2. Temporarily set `SUPPORT_RESEARCH_ENABLED=true` and run the workflow from
   authenticated Studio with `dryRun=true`, a small `maxConversations`, and a
   unique `idempotencyKey`. Dry run reads Help Scout and runs the model and
   validator, but every proposed Linear action is stored as `dry_run` and no
   Linear request is made.
3. Inspect the durable run report and a sample of sanitized observation rows.
   Confirm that customer names/contact details, quoted history, tokens,
   attachments, raw HTML, and irrelevant tickets are absent; Watch URLs use
   exact allowed hosts; and HTTP success is not described as proof of playback
   or interaction behavior.
4. Review every proposed issue. Confirm normal bugs have exact reproduced HTTP
   evidence, inferred bugs say `Needs validation`, usability work meets the
   distinct-source threshold, and descriptions distinguish reported evidence,
   automated checks, model inference, and missing proof.
5. Run a full-window dry run. Resolve privacy, precision, cursor, report-size,
   or duplicate findings before live enablement.

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
