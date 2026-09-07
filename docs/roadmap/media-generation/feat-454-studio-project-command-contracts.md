---
id: "feat-454"
title: "Studio projects and revision-checked commands"
owner: "tataihono"
priority: "P1"
status: "not-started"
start_date: "2026-09-07"
duration: 4
depends_on:
  - "feat-453"
blocks:
  - "feat-455"
  - "feat-456"
  - "feat-457"
  - "feat-459"
tags:
  - "ai-pipeline"
  - "manager"
---

## Problem

Existing Shorts are Manager jobs with last-write-wins artifact drafts. The replacement needs a durable project model shared by humans and agents.

## Entry Points — Read These First

1. `docs/plans/2026-09-07-001-feat-studio-video-authoring-plan.md` — full contract, rollout and verification design.
2. `apps/admin/prisma/schema.prisma`
3. `apps/admin/src/services/experience.service.ts`
4. `apps/admin/src/mcp/admin-mcp-tools.ts`
5. `apps/manager/src/backend/admin-client.ts`
6. `packages/admin-graphql/`
7. `packages/AGENTS.md`

Paths marked proposed do not exist yet. Frontmatter dates/durations are planning placeholders, not delivery commitments.

## Grep These

- `expectedDraftRevision|draftVersion|ManagerJob|ContentRevision`

## What To Build

1. Add proposed packages/studio-contracts with runtime-neutral Zod types for timeline items, custom-component references, operations, attempts, approvals, and publication state.
2. Add Admin-owned StudioProject, immutable StudioProjectRevision, StudioAttempt, and StudioApproval records through additive migrations and an authoring module under src/services/studio-authoring/.
3. Implement read/create/apply/request/approve interfaces with actor attribution, mandatory expectedRevision, and idempotent side-effect admission. UI/MCP/background callers share these checks.
4. Model DRAFT -> PUBLISHED -> UNPUBLISHED with a permanent firstPublishedAt latch and no return to editing. Separate attempts and approvals from project lifecycle.
5. Add GraphQL operations and Manager adapters; regenerate Admin schema and admin-graphql introspection in the same PR.

## Constraints

- No new project database in Manager, and no imports between app implementations.
- Do not store large media or unbounded source text in durable workflow payloads.
- All changes before publication remain possible; approval is not a permanent edit lock.

## Verification

- Real database tests prove stale revisions reject, retries do not duplicate attempts, and concurrent publication/edit serialize correctly.
- Tests cover stale job attachment and immutable published/unpublished content across all command variants.
- Run schema generation and touched consumer typechecks; verify neutral imports and format.
