---
id: "feat-630"
title: "Owner project deletion in Shorts Studio and MCP"
owner: "tataihono"
priority: "P1"
status: "complete"
start_date: "2026-10-09"
duration: 1
depends_on: []
blocks: []
tags: [manager, shorts, mcp]
---

## Problem

Lyuba cannot remove test projects herself. Owners need the same deletion command
in the project list and delegated MCP, without destroying retained history or
published content.

## Entry Points — Read These First

1. `apps/admin/src/services/studio-authoring/index.ts` — canonical commands.
2. `apps/admin/src/services/studio-authoring/state.ts` — row locks and receipts.
3. `apps/manager/src/features/video-studio/projects.tsx` — project list.
4. `apps/manager/src/services/studio-agent/mcp-tools.ts` — external tools.
5. `packages/studio-contracts/src/transport.ts` and `src/agent.ts` — RPC actions.

## Grep These

- `lockProject`, `short_project_latch`, `short_require_draft_parent`
- `shorts.deleteProject`, `deletedAt`, `PROJECT_BUSY`

## What To Build

Add an owner-only, revision-checked, idempotent deletion command. Tombstone the
project, hide it from discovery and authoring reads, and retain all history,
assets and receipts. Offer a confirmation from each project card. Register the
same command under MCP's existing `shorts:edit` consent.

## Constraints

Reject deletion of published projects, active attempts, or calendar-linked
projects. Do not promote delegated callers to interactive authority. Keep
unrelated local changes intact. Release through the normal PR flow.

## Verification

Run contract, canonical deletion, delegated scope and Manager MCP tests; verify
Postgres guards and concurrent commands on a disposable local database. Run
Admin and Manager typechecks, touched-file lint and formatting. Verify UI deletion
and compare page-load resources/timing before and after.

## Completion

Implemented owner deletion in the project list and `shorts.deleteProject`.
Retained history/media, exact retries, publication, active work (including Mux),
calendar and database guards are covered. See
`docs/solutions/database-issues/studio-project-deletion-retains-evidence.md` for
the contracts and verified checks, and
`docs/validation/shorts-project-deletion/` for browser evidence. Production rollout
uses the normal PR flow and requires Admin migration 0139.
