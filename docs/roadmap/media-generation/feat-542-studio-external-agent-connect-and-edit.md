---
id: "feat-542"
title: "Connect an external agent and edit the correct project"
owner: "tataihono"
priority: "P1"
status: "in-progress"
readiness: "ready-for-agent"
start_date: "2026-09-23"
duration: 3
depends_on: []
blocks: ["feat-543", "feat-544"]
tags: ["manager", "ai-pipeline"]
---

## Problem

An operator connects an existing external client, discovers or opens the intended project, makes an attributed edit, and sees that edit in Studio. Include minimal connection and operating instructions so the slice can be exercised without repository knowledge.

## What To Build

Approved acceptance criteria:

- [ ] Authenticated MCP initialization and tool discovery work with scoped OAuth; current membership, application environment, consent, and client identity are enforced.
- [ ] Bounded project discovery supports selecting the right project without exposing inaccessible projects; project links can be mapped to exact identities.
- [ ] Create/read/apply/history preserve existing idempotency and expected-revision behavior, and return usable human review links.
- [ ] An external-client edit appears in the editor and history with the authenticated operator and client attribution; another client cannot supply a replacement actor.
- [ ] A human edit racing an agent write returns a recoverable stale-revision result. Reading history and reapplying against the new baseline preserves that human edit.
- [ ] Document and execute connection steps for Claude and Codex, distinguishing client/environment restrictions from server failures. At least one real client completes the editing proof in this slice; the final qualification requires both complete workflows.
- [ ] Read-only tokens, revoked membership, wrong environment, and expired credentials cannot edit. Existing hosted-agent and interactive paths still work.

## Verification

Test boundary:

MCP authenticated transport and canonical authoring database; real-client edit plus UI observation.

Read actual package scripts before running targeted Vitest/DB tests, typechecks, lint and formatting. Use only guarded loopback databases and fake paid providers. Regenerate Admin SDL and admin-graphql together if Pothos changes. Record real-client evidence separately from transport probes.

## Constraints

Preserve expected-revision and idempotency semantics, human edits, scoped OAuth authority, and exact-render human approval. No paid provider calls, deployment, agent publication, automatic wakeups, or editor comments.

## Entry Points — Read These First

1. `apps/manager/src/app/mcp/route.ts`
2. `apps/manager/src/services/studio-agent/oauth.ts`
3. `apps/admin/src/services/studio-authoring/delegated.ts`
4. `apps/auth/src/domain/apps.ts`

See `docs/plans/2026-09-23-studio-external-agent/spec.md` and `code-map.md` for the complete approved scope.

## Grep These

- `authenticateStudioMcp|studioServiceCall|expectedRevision`
- `narrationReserve|render-review|idempotencyKey`

## Implementation and validation — 2026-09-23

- Extracted the compatible MCP registry to
  `apps/manager/src/services/studio-agent/mcp-tools.ts`; later execution tools
  extend this registry and explicit route dispatch.
- Added bounded `shorts.projects`, same-environment `shorts.resolveProject`,
  history pagination, project/revision evidence links and recoverable MCP conflict
  results. Project links open live editor state; exact-render review is feat-546.
- Tightened OAuth admission to require current Operator membership (the shared
  session validator also serves Reviewers, which must not enter Studio MCP).
- Connection and reconciliation guide:
  `docs/validation/studio-external-agent/connection.md`.
- Passed eight Manager tests across MCP route, real signed-JWT OAuth validation,
  and delegated transport. Passed the real Postgres delegated authoring test with
  human-edit/rebase preservation, immutable attributed history, actor-bound retry,
  revoked membership and bounded discovery. Database was the task-owned guarded
  loopback `forge_studio_460_fresh` on port 55460; no paid providers were called.
- Manager typecheck and targeted Manager/Admin ESLint passed. No Pothos or
  frontend initialization/rendering changes; schema generation and page-load
  measurement are not applicable to this slice.
- **Acceptance remains in progress:** real Claude/Codex connection and UI history
  observation require authenticated clients plus reachable configured test
  services. Unit/DB evidence does not substitute for this qualification. The
  implementation can be integrated to unblock dependent slices while this gate
  remains visibly open.

## Additional real-client evidence

Codex CLI `0.150.0-alpha.12.2` completed actual MCP create/read/edit/retry/history
and project-link resolution with authenticated local handlers and real Postgres,
including resuming the same conversation. See
`docs/validation/studio-external-agent/local-harness.md` and its selected actual
tool transcript. Real production Auth consent, Claude and editor UI observation
remain open; status remains in progress. The first client-generated JSON Patch
was correctly rejected, then the domain-specific operation succeeded on resume.
