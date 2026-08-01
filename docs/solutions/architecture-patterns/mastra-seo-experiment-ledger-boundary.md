---
title: "Mastra SEO automation: keep evidence and orchestration separate from approval and durable experiment truth"
date: 2026-08-01
last_updated: 2026-08-01
category: architecture-patterns
module: "apps/mastra + apps/admin + apps/manager"
problem_type: architecture_pattern
component: service_object
severity: high
applies_when:
  - "An agent combines search performance, analytics, fetched page state, and grounded web observations"
  - "Recommendations may become editorial drafts or engineering tickets but must never publish or deploy autonomously"
  - "Later workflows need to evaluate whether an approved change helped or harmed search performance"
tags:
  - mastra
  - seo
  - experiment-ledger
  - search-console
  - human-approval
  - workload-assertions
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

Evaluator and ticket workers use expiring generation-and-token claims. A
completion atomically compares and consumes the current generation, token hash,
expiry, and lifecycle status in one conditional update before it appends an
event or attempt. A transaction containing a separate read, append, and
unconditional update is still racy: two callers can both pass the read. A
conditional update count of zero means the worker lost the fence and must stop.

### Observe activation before measuring

Approval is not activation. An experiment starts only when a bounded production
probe observes the immutable treatment. Editorial work compares canonical
content hashes. Engineering work must carry a server-validated probe such as a
page-text hash, structured-data path, response header, or performance budget;
otherwise it stays ticket-only.

Use an interim event for early visibility and a later final event after the
configured GSC impression threshold. A harmful result creates a new,
approval-required rollback proposal from the pre-change snapshot. It does not
publish or roll back automatically, and it becomes stale if production no
longer matches the treatment.

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
- Pass an agent-refined proposal through the wire serializer and assert its
  payload digest matches Admin's immutable projection.
- Treat Linear timeouts, 5xx responses, and malformed success bodies as
  ambiguous; retain all exact configured-team candidates and never create again
  automatically when more than one remains.
- Keep harmful outcomes visible, rollback approval-required, and harmful or
  confounded lessons ineligible for activation.

## Related

- [Mastra offline search-eval orchestration boundary](./mastra-offline-search-eval-orchestration-boundary-pattern.md) — the adjacent offline search-quality boundary.
- [Admin search trace retention](../platform/admin-search-trace-retention-pattern.md) — canonical retention and scheduler mechanics.
- [Atomic check-and-claim](../database-issues/db-lock-must-be-atomic-update-not-select-for-update.md) — the database concurrency rule behind claim consumption.
- [Feature plan](../../plans/2026-08-01-001-feat-mastra-seo-marketing-agent-plan.md) — complete requirements and rollout sequence.
