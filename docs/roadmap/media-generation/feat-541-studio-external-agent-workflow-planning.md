---
id: "feat-541"
title: "Studio external agent workflow specification and ticket breakdown"
owner: "tataihono"
priority: "P1"
status: "complete"
start_date: "2026-09-23"
duration: 1
depends_on: []
blocks: []
tags:
  - "manager"
  - "ai-pipeline"
---

## Problem

The operator wants their existing Claude or Codex agent to create and inspect
Shorts drafts, using Studio chiefly for human review. The agreed interview
decisions need a durable specification and independently implementable tickets.

## Entry Points — Read These First

1. `docs/plans/2026-09-23-studio-external-agent/spec.md` — product specification.
2. `docs/plans/2026-09-23-studio-external-agent/breakdown.md` — proposed slices and test boundaries.
3. `apps/manager/src/app/mcp/route.ts` — current delegated tool surface.
4. `docs/solutions/security-issues/studio-native-agent-admission.md` — delegated authority.
5. `docs/solutions/database-issues/studio-command-revisions-and-publication-latch.md` — durable command behavior.

## Grep These

- `authenticateStudioMcp|studioServiceCall|expectedRevision`
- `narrationReserve|studioRateCardSchema|render-review`

## What To Build

Synthesize the interview into a specification, test boundaries, and proposed
vertical implementation slices. Use the existing Forge file roadmap as the
tracker. Keep draft tickets under the plan until the user reviews their
granularity and dependencies; then publish each as a separate globally numbered
roadmap ticket with bidirectional dependencies and `ready-for-agent` readiness.

## Constraints

- This ticket covers planning only, not implementation or release.
- Preserve the agreed human publication authority and external conversation feedback.
- No arbitrary dollar budget or in-editor commenting feature.
- Dates and duration are planning estimates, not delivery commitments.

## Verification

- Every accepted interview decision appears in the specification and an acceptance criterion.
- Each ticket has an independently demonstrable outcome and explicit blockers.
- Verify paths, format Markdown, and check the dependency graph for cycles.
- User review of test boundaries and ticket breakdown precedes implementation-ticket publication.
