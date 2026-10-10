---
title: "Mastra SEO automation: keep evidence and orchestration separate from approval and durable experiment truth"
date: 2026-08-01
last_updated: 2026-08-11
category: architecture-patterns
module: "apps/mastra + apps/admin + apps/manager"
problem_type: architecture_pattern
component: service_object
severity: high
applies_when:
  - "An agent combines search performance, analytics, fetched page state, and grounded web observations"
  - "Recommendations may become editorial drafts or engineering tickets but must never publish or deploy autonomously"
  - "Later workflows need to evaluate whether an approved change helped or harmed search performance"
  - "Idempotent background runs use expiring generation-and-token claims"
  - "Experiment activation and final evaluation can race canonical content edits"
tags:
  - mastra
  - seo
  - experiment-ledger
  - search-console
  - human-approval
  - run-claim-fencing
  - fenced-outbox
  - objective-activation
---

# Mastra SEO automation: keep evidence and orchestration separate from approval and durable experiment truth

## Context

SEO automation crosses several authority boundaries. Google Search Console can
describe Google Search performance, GA4 can describe on-site behavior, and a
crawler can describe the response it fetched. None of those observations
authorizes a content change, proves that Google indexed a change, or proves that
an engineering ticket was deployed. Agent memory is also the wrong authority
for an experiment history: it is useful context, but it cannot provide the
immutable versions, actor attribution, idempotency, retention, and conflict
checks needed for an operational feedback loop.

Forge therefore separates the feature across the existing application
boundaries:

- Mastra owns read-only provider access, deterministic opportunity scoring,
  model-assisted interpretation, and recurring orchestration.
- Admin owns the durable SEO Experiment Ledger, proposal versions, approval
  transitions, content drafts, experiments, evaluations, ticket outbox, and
  reviewed lessons.
- Manager owns the authenticated operator experience. It can request a bounded
  transition but does not receive publication or deployment authority.

## Pattern

### Preserve evidence classes instead of manufacturing one score

Persist observations with their provider, scope, retrieval time, quality and
coverage metadata, and bounded citations. Treat GSC as authoritative only for
Google Search performance; use GA4 and mission outcomes as guardrails; treat
Firecrawl, direct HTTP, and grounded model output as observations. An absent GSC
row is unknown, never zero.

The agent sees sanitized observation records and emits a structured proposal.
It does not receive database, approval, publication, deployment, or ticket
credentials. Other Mastra workflows reuse the registered agent and tools in the
same runtime, avoiding an internal network or MCP hop with no independent
caller.

### Put business memory in an append-oriented ledger

Every proposal version binds the exact evidence, canonical target and locale,
payload digest, expected outcome, risk, verification plan, rollback plan, and
either an editorial diff or engineering brief. Decisions bind the authenticated
actor to that immutable version. Experiments retain distinct pre-change and
treatment snapshots; evaluation events append rather than overwrite history.

Reviewed lessons are the reusable memory surface. They can become active only
after objective activation, sufficient measurement, a final non-confounded
evaluation, and an interactive review. Harmful, neutral, and inconclusive
results remain visible so later analysis is not biased toward successes.

### Separate stable identity from exact payload integrity

A proposal ID identifies the stable semantic conflict target; it must not churn
when a later run refreshes evidence. The payload digest proves the exact
immutable treatment shown to the operator. Compute those values independently:

```ts
proposalId = stableHash(semanticConflictKey)
payloadDigest = hash(immutablePayloadWithoutLedgerMetadata)
```

If the registered agent refines allowed explanatory fields after deterministic
proposal generation, recompute the digest before persistence. Admin recomputes
the same projection at ingestion rather than trusting the supplied digest. This
keeps retries on one stable proposal while rejecting any payload drift.

Hash the exact persistence-safe wire object, not the richer in-memory proposal.
That projection must be idempotent under Admin's defensive redaction contract,
including nested-depth markers, credential-shaped keys and values, and both
HTTP and HTTPS URL normalization. Otherwise Admin will correctly transform the
payload before recomputing its digest and fail the whole live run closed with
`proposal_digest_mismatch`.

Sensitive-key matching must operate on key tokens, not arbitrary substrings.
In particular, an unbounded `ip` pattern also matches ordinary content keys
such as `description`, silently removing the treatment the digest is meant to
bind. Preserve content keys and redact only actual IP-address key forms.

### Make mutation authority narrow and provable

Manager signs a short-lived Ed25519 assertion for one actor, action, proposal
version, and payload digest. Mastra separately signs workload assertions for
one Admin endpoint capability and the digest of the exact request bytes. Admin
verifies environment, audience, capability, expiry, key ID, and a replay nonce
before running a server-owned transition.

Editorial approval creates a `ContentRevision` in DRAFT state after validating
the current base and existing human drafts. It never writes canonical content
or triggers revalidation. Engineering approval creates an outbox record before
calling Linear. Ambiguous remote success enters manual reconciliation instead
of automatically creating a duplicate.

Evaluator, daily-run, and ticket workers use expiring generation-and-token
claims, with only token hashes stored at rest. Expiry makes a claim eligible
for reclaim; it does not by itself revoke a slow worker. Reclaim rotates the
token and increments the generation. Completion atomically compares and
consumes the current generation, token hash, and lifecycle status in one
conditional update before it appends an event or attempt. A transaction
containing a separate read, append, and unconditional update is still racy:
two callers can both pass the read. A conditional update count of zero means
the worker lost the fence and must stop.

Run idempotency must fence execution before any provider calls, not merely
deduplicate the final write. An active duplicate receives no claim and returns
`in_progress`; an expired duplicate may reclaim the same row. Reclaim preserves
the least-permissive mode so a `dry_run` can never become `live`. A terminal
replay is successful only when its stored terminal status matches the requested
completion; otherwise the caller lost the fence.

### Observe activation before measuring

Approval is not activation. An experiment starts only when a bounded production
probe observes the immutable treatment. Preserve two different hashes:

- A full treatment hash binds the exact versioned payload and is used for
  stale-write and rollback identity.
- A stable activation hash covers only mutation-relevant SEO fields, so
  timestamps, IDs, and lifecycle metadata cannot prevent valid activation.

Admin re-reads canonical content inside the activation transaction instead of
trusting an earlier Mastra observation. Editorial work compares the stable
activation hash. Engineering work currently supports server-validated
`page_text_hash` and `response_header` probes; structured-data and performance
work remains ticket-only until an objective probe is implemented. HTTP header
names must pass strict token validation, and header values are always hashed as
raw values before comparison.

Overlap is a fact about simultaneous treatment exposure, not approval. New
experiments therefore start without overlap confounders. When a treatment
actually activates, Admin marks both it and any already-measuring experiment
with the same semantic conflict key as `overlapping_change`.

Use an interim event for early visibility and a later final event after the
configured GSC impression threshold. A harmful result creates a new,
approval-required rollback proposal from the pre-change snapshot. It does not
publish or roll back automatically, and it becomes stale if production no
longer matches the treatment.

Before recording a final verdict, Admin re-reads the current canonical target.
If its stable activation hash no longer matches the treatment, the evaluation
event and experiment both become inconclusive with a
`canonical_content_changed` confounder. No lesson or rollback proposal is
created from content that is no longer under measurement.

Keep the source experiment's outcome `HARMFUL`; represent rollback readiness on
the separate rollback proposal. Replacing the source outcome with a
`ROLLBACK_PROPOSED` lifecycle state obscures why its lesson is ineligible and
can accidentally bypass terminal-data retention rules.

## Operational defaults

- Automation defaults to `off`. `dry_run` may collect and rank evidence but
  persists only a bounded would-propose report. `live` may persist proposals;
  it still cannot approve or publish them.
- Provider configuration is optional at boot. Unavailable lanes remain visible
  and never turn missing evidence into a recommendation.
- External fetches require HTTPS, explicit host allowlists, redirect checks,
  response-size limits, and private/link-local/metadata address rejection.
- Raw provider bodies, credentials, cookies, headers, signed query strings,
  IPs, and raw error bodies do not enter prompts, ledger rows, or Manager
  responses.
- Evaluation isolates each claimed experiment so one malformed legacy probe
  is recorded as a failure without aborting the rest of the batch.
- Linear ticket descriptions reserve space for a stable marker and digest
  suffix before truncating human-readable content. Expired claimed outbox rows
  are reclaimable, and reconciliation runs before any create retry.
- Retention removes bounded operational detail by class while preserving active
  experiments and legal holds; long-lived snapshots are later redacted without
  erasing stable identities or digests.

## Why this boundary matters

The useful unit is not an agent conversation; it is a traceable proposal and a
measured outcome. Keeping orchestration in Mastra, authority in Admin, and human
decisions in Manager makes the agent reusable without silently turning it into
an autonomous CMS publisher. It also makes retrospectives honest: every lesson
can be traced back to the exact proposal version, observed activation, evidence
windows, and confounders that produced it.

## Verification examples

- Pin `off`, `dry_run`, and `live` persistence boundaries independently.
- Test stale evaluation and ticket claims by making the conditional fence
  update return zero, then prove no event or attempt was appended.
- Prove an active duplicate performs no provider calls; an expired uncontested
  worker may still complete, but its old token fails after a real reclaim.
- Prove reclaim cannot upgrade `dry_run` to `live`, and a terminal replay with
  a different requested status returns `run_fence_lost`.
- Pass an agent-refined proposal through the wire serializer and assert its
  payload digest matches Admin's immutable projection.
- Pass a deeply nested Experience payload with credential-shaped values and an
  HTTP URL through Mastra's persistence projection, then prove Admin redaction
  leaves the transmitted object byte-identical before hashing.
- Change volatile snapshot metadata without changing the activation hash, then
  change an editable SEO field and prove the hash changes.
- Activate overlapping treatments and prove both become confounded only then;
  change canonical content before finalization and prove the outcome is
  inconclusive with no lesson or rollback.
- Treat Linear timeouts, 5xx responses, and malformed success bodies as
  ambiguous; retain all exact configured-team candidates and never create again
  automatically when more than one remains.
- Keep harmful outcomes visible, rollback approval-required, and harmful or
  confounded lessons ineligible for activation.

## Related

- [Mastra offline search-eval orchestration boundary](./mastra-offline-search-eval-orchestration-boundary-pattern.md) — the adjacent offline search-quality boundary.
- [Admin search trace retention](../platform/admin-search-trace-retention-pattern.md) — canonical retention and scheduler mechanics.
- [Atomic check-and-claim](../database-issues/db-lock-must-be-atomic-update-not-select-for-update.md) — the database concurrency rule behind claim consumption.
- [Parallel workflow error robustness](../best-practices/parallel-workflow-error-robustness-20260420.md) — failure isolation for batched evaluation work.
- [Manager automation dry-run boundary](../integration-issues/manager-automation-dry-run-report-boundary-20260413.md) — the adjacent least-permissive execution-mode rule.
- [Feature plan](../../plans/2026-08-01-001-feat-mastra-seo-marketing-agent-plan.md) — complete requirements and rollout sequence.
