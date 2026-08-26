---
title: "Credentialed scheduled agents need private models and attributed write reconciliation"
date: "2026-08-26"
category: "architecture-patterns"
module: "apps/mastra, apps/admin"
problem_type: "architecture_pattern"
component: "agent-workflows"
severity: "high"
related_components:
  - "mcp"
  - "oauth"
  - "content-revisions"
  - "scheduled-workflows"
tags:
  - "agents"
  - "mastra"
  - "mcp"
  - "oauth"
  - "idempotency"
  - "human-review"
root_cause: "authority_boundary_ambiguity"
resolution_type: "implementation_pattern"
---

# Private Model, Deterministic Write Owner, Attributed Reconciliation

## Context

A scheduled editorial agent needs enough evidence to make a useful judgment and
enough authority somewhere in the system to save that judgment for review. If
the credentialed MCP tools are attached to the model or the agent is registered
on a framework-generated public route, the model becomes an alternate admin
surface. Schedule gates, validation, write budgets, and human-review rules can
then be bypassed by calling the agent directly.

Moving the write into workflow code solves only part of the problem. A network
timeout can occur after Admin commits but before Mastra receives the response.
Blindly retrying the write risks duplicate or conflicting work; claiming that
no write occurred is equally unsafe.

The feat-406 storefront curator established a reusable pattern for credentialed
scheduled agents that prepare, but do not publish, human-reviewed changes.

## Pattern

### 1. Keep the model private and tool-free

Construct the model agent in its workflow module, give it no tools, and do not
register it in the application's agent registry. The workflow serializes a
bounded evidence envelope into the prompt and requests a strict structured
decision. Only deterministic workflow code can call the credentialed client.

This is stronger than relying on the prompt to say “do not publish.” There is no
publish/discard implementation in the workflow, no credential available to the
model, and no framework-native agent route from which a caller can improvise a
different sequence.

Bound the model call itself, not only its output tokens. Pass an
`AbortSignal.timeout(...)` into generation and race the returned promise through
the repository's outer wall-clock budget helper. The outer guard is load-bearing:
an adapter may ignore cancellation, and a stalled provider must still terminate
the stored run with a typed no-write outcome.

### 2. Protect the operator surface and leave scheduling independently off

Expose one purpose-built route with a dedicated fail-closed bearer allowlist.
Reject bearer reuse with the shared service pool at boot, and deny every native
workflow route for the protected workflow, including read-looking variants that
could expose or launch state through framework behavior.

Use separate switches for behavior and cadence:

- mode: `off`, `dry_run`, or `stage`;
- enabled locale/tenant allowlist;
- schedule enabled: false by default.

An operator can therefore test the exact production workflow through the
protected route without arming a recurring timer. Enabling `stage` does not
implicitly enable the schedule.

### 3. Minimize read context and preview capability

The evidence read should return only canonical content, a digest/pre-image,
bounded catalog facts, and limited conflict attribution. It must not call a
helper that materializes effective draft content or lazily creates preview
credentials. In particular, do not include draft bodies, preview tokens, or
preview URLs in an agent evidence response.

Check model-provider readiness before reading Admin. This avoids exporting
catalog data when the downstream model cannot run.

### 4. Make deterministic code the sole write owner

The model proposes a bounded decision, not an Admin payload or tool sequence.
Workflow code then:

1. rejects identifiers absent from authoritative evidence;
2. validates the final schema;
3. applies resource-aware checks (for example, collection parents from a
   collection inventory versus per-language media checks for leaf videos);
4. preserves all human-owned content and replaces only agent-owned slots;
5. calls one stage operation with an optimistic canonical pre-image.

For ordered content, replacement position is part of ownership. Reinsert the
new agent-owned group at the first old agent-owned slot; append only on the
first run. Filtering all agent sections and always appending would silently move
human sections even when their bytes were untouched.

### 5. Attribute every stage attempt and reconcile ambiguity exactly

Before staging, create:

- a random `operationId` identifying this one attempt;
- a digest of the normalized candidate payload.

Admin normalizes and independently recomputes the digest, locks the canonical
row, checks the pre-image and active-draft guard, then stores both values in the
draft revision attribution. A successful response must echo the attribution.

If the transport fails ambiguously, never retry the stage call. Perform one
read-back and accept success only when the active draft matches the exact
resource ID, operation ID, and candidate digest. Otherwise return an explicit
`stage_outcome_unknown`. “Unknown” is an operational state: stop cadence and
require a human to inspect/disposition the draft before another run.

Expose separate report fields:

- `candidateDiffers`: a proposal differs from canonical content;
- `draftStaged`: exact attribution proves the draft exists;
- `writeOutcome`: `no_change`, `no_write`, `staged`, or
  `stage_outcome_unknown`.

A legacy `changed` boolean cannot express all three facts and must not be used
as a write receipt.

### 6. Retry by operation semantics, not HTTP method labels

Retry explicitly idempotent evidence/validation reads at most once within a
bounded timeout. Treat OAuth token refresh as a credential mutation: classify a
timeout, but never replay it automatically unless the authorization server has a
verified same-request rotation-replay contract. Do not retry:

- OAuth refresh without that verified replay contract;
- stage or any other mutation;
- an endpoint labeled “read” when it may mint capability state (the Admin
  preview operation can create a missing preview token);
- ambiguous reconciliation itself in a loop.

The timeout must cover response-body reads as well as initial headers. A fetch
that resolves headers and stalls mid-body is still a timeout, not a generic JSON
parse failure.

### 7. Treat rollout policy as part of the safety design

Default to one locale and require repeated human-approved dry runs before the
first stage and before cadence activation. Name the operational owner and review
channel, and define disposition for active drafts and unknown write outcomes.

Pin the OAuth grant to only the tool scopes the workflow calls. Verify the
effective issued token, not just the requested scope or seeded client default;
broad client defaults can silently include a publish scope the workflow does not
need.

## Forge implementation

Key files:

- `apps/mastra/src/mastra/agents/storefront-curator-agent.ts` — private,
  structured, zero-tool decision agent.
- `apps/mastra/src/mastra/workflows/storefront-homepage-curation.ts` — evidence,
  validation, content ownership, write receipt, and reconciliation.
- `apps/mastra/src/mastra/workflows/storefront-homepage-curation-route.ts` —
  dedicated protected operator route contract.
- `apps/mastra/src/services/storefront-admin-mcp-client.ts` — capped mid-body
  reads and operation-specific retry policy.
- `apps/mastra/src/mastra/devotional-native-route-guard.ts` — native workflow
  route denial shared with the existing protected devotional workflow.
- `apps/admin/src/services/experience-locale-mcp.service.ts` — minimal context
  projection and normalized, attributed stage boundary.
- `apps/admin/src/services/experience.service.ts` — locale-row lock,
  canonical-preimage check, active-draft guard, and revision creation.

## Evidence

Focused tests pin the behavior at the boundaries where regressions are most
likely:

- `apps/mastra/src/mastra/agents/storefront-curator-agent.test.ts` proves the
  agent has no tool set, is imported only for workflow use, is absent from the
  agent/global-tool registries, and has an anti-vacuous registered-tool
  companion.
- `apps/mastra/src/mastra/workflows/storefront-homepage-curation-route.test.ts`
  proves fail-closed dedicated bearer use and preserves
  `stage_outcome_unknown` without retrying.
- `apps/mastra/src/mastra/workflows/storefront-homepage-curation.test.ts` covers
  readiness-before-Admin, locale gating, collection/leaf validation,
  first-curator-slot replacement, schedule absence by default, stage
  attribution, exact/nonmatching reconciliation, and a never-resolving model
  bounded by the workflow's outer wall-clock guard.
- `apps/mastra/src/services/storefront-admin-mcp-client.test.ts` covers
  mid-body OAuth/MCP timeouts, one retry for safe reads, and zero retries for
  OAuth refresh, stage, preview-capability creation, and unrelated mutations.
- `apps/admin/src/services/experience-locale-mcp.service.test.ts` proves context
  neither mutates nor exposes preview capability, authorization runs before the
  query, normalized digest mismatch is rejected, and concurrency/draft guards
  hold.
- `apps/admin/src/app/mcp/route.test.ts` keeps the advertised storefront tools
  aligned with authenticated dispatch.

The connected English stage smoke is intentionally an operational rollout gate,
not a unit-test substitute. The runbook requires three consecutive editorially
approved dry runs before that smoke and weekly activation.

## When to reuse this pattern

Use it whenever a model prepares credential-backed writes on a timer: storefront
merchandising, campaign drafts, localization batches, support triage mutations,
or metadata refreshes. If the model must interactively explore tools, split the
system into a read-only research agent and a deterministic write workflow; do
not collapse the two authority levels into one registered credentialed agent.
