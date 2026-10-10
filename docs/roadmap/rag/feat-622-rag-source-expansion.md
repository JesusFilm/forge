---
id: "feat-622"
title: "Source Expansion: govern suggestions through reviewed pilots"
owner: "jaco"
priority: "P1"
status: "not-started"
start_date: "2026-10-08"
duration: 5
depends_on: ["feat-623"]
blocks: []
tags: ["rag", "strategy", "documentation"]
---

## Problem

Additional material requested on October 5 needs a discoverable intake and an
explicit decision trail before it can become retrieval content.

## Entry Points — Read These First

1. `docs/roadmap/rag/strategy.md` — suggestion register and existing workstreams.
2. `apps/rag/docs/sources.md`, `source-map.yaml`, `source-status.yaml` — current inventories.
3. `apps/rag/docs/ops/corpus-maintenance.md` — acquisition/indexing guardrails.
4. `docs/roadmap/rag/feat-623-rag-source-quality-gates.md` — reusable quality checks.
5. `docs/solutions/architecture-patterns/rag-portal-source-brand-facade.md` — brand versus source identity.

## Grep These

`sourceKey`, `allowedSourceKeys`, `acquire`, `provenance`, `language`.

## What To Build

1. Define and publish a source-suggestion intake linked from the consumer/operator
   documentation. Start with a versioned Markdown template and register under
   `apps/rag/docs/`; a portal form is a separately scoped enhancement. Require
   submitter, date, title/edition, publisher/owner, canonical locator, language,
   audience/use case, expected retrieval benefit, overlap with existing inventory
   and rights evidence locator. Accept metadata only, never uploaded book text.
   Deduplicate exact editions/collections without conflating source keys and brands.
2. Assign each suggestion an ID and accountable reviewer. Record transitions with
   actor, date, evidence and reason: `suggested -> under-review -> approved-for-pilot
-> pilot-running -> pilot-reviewed -> approved-for-production -> active`.
   Permit `needs-information`, `rejected`, `deferred` from review; `suspended` from
   any approval/active state; restoration requires renewed review. A submitter
   cannot self-approve. Jaco routes product decisions and names the qualified
   rights reviewer before approval; this ticket does not grant legal clearance.
3. Review rights/licensing and provenance for the exact edition, translation,
   digitization, territory, term and proposed use: acquisition, storage, embedding,
   retrieval excerpts, full-document delivery, attribution and redistribution.
   Record restrictions, expiry/review date and evidence location. Missing or
   incompatible permission keeps the suggestion out of acquisition. A public
   webpage, old author or ministry affiliation alone is insufficient evidence.
4. For a cleared candidate, obtain a bounded pilot plan specifying source keys,
   allowlisted paths, languages, document/byte/provider-spend limits, isolated
   target, expected inventory, stop conditions and cleanup/disposition. Reuse
   acquisition/indexing tools; reconcile acquired/skipped/rejected/indexed counts
   and provenance. Broader production ingestion is a separate authorization.
5. Apply feat-623 checks to the pilot and a compatible existing-corpus baseline.
   Record benefit, failures, restrictions and a promote/rework/defer/reject
   decision. Production approval must name scope, audience/access constraints,
   rights evidence, cost envelope and operator; it does not itself execute ingestion.
6. Provide a harmful/low-quality-content reporting path keyed by source/document
   ID with severity, reporter, restricted evidence location and review owner.
   Triage rights complaints, unsafe material, extraction errors, misattribution
   and retrieval false positives separately. Urgent reports trigger an authorized
   containment decision; track suspend/exclude/correct/re-evaluate and reporter
   follow-up. Verify exclusion through retrieval, and identify downstream cached
   copies for consumer-owned follow-up. Preserve an audit record without corpus text.

## Constraints

Preserve the separate RAG service/database and consumer-neutral retrieval contract.
This roadmap authorizes no source import, production mutation, credential handling,
deployment or purchase. Future execution needs its own bounded scope and authority.
Dates and durations are planning placeholders, not delivery commitments.

## Verification

- A new contributor can submit a metadata-only suggestion and see its disposition.
- Walk synthetic cases through duplicate, unknown-rights, refused, restricted-use,
  approved-pilot, failed-quality, promoted and suspended/restored paths. Unknown
  rights and missing approvals never reach an ingestion step.
- One separately authorized pilot has reconciled inventory/provenance, bounded
  costs and quality evidence, with a signed disposition; zero promotion on failure.
- Exercise a harmful-content report through containment, retrieval recheck,
  downstream notification assignment and closure. Set named triage ownership and
  response targets before activation; missing ownership blocks activation.
- Future implementation completion requires observed receipts, not this spec alone.
