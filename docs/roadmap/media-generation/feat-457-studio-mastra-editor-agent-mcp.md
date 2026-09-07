---
id: "feat-457"
title: "Studio agent instructions and shared MCP tools"
owner: "tataihono"
priority: "P1"
status: "not-started"
start_date: "2026-09-07"
duration: 4
depends_on:
  - "feat-454"
  - "feat-455"
  - "feat-456"
blocks:
  - "feat-458"
  - "feat-461"
tags:
  - "ai-pipeline"
  - "manager"
---

## Problem

Both an application-owned Mastra agent and external Claude Code must manipulate the same project, while Lyuba controls native stored instruction versions.

## Entry Points — Read These First

1. `docs/plans/2026-09-07-001-feat-studio-video-authoring-plan.md` — full contract, rollout and verification design.
2. `apps/mastra/src/mastra/index.ts`
3. `apps/mastra/src/mastra/agents/`
4. `apps/admin/src/app/dashboard/experiences/experience-editor/experience-chat-panel.tsx`
5. `apps/admin/src/mcp/admin-mcp-tools.ts`
6. `apps/manager/src/lib/auth.ts`

Paths marked proposed do not exist yet. Frontmatter dates/durations are planning placeholders, not delivery commitments.

## Grep These

- `MastraEditor|applyStoredOverrides|expectedDraftRevision|admin-mcp-oauth|streamMastraExperienceChat`

## What To Build

1. Add a hosted Studio authoring agent and thin authenticated commands, exposed to the editor and via proposed Manager MCP route using Auth resource/scopes rather than a shared API key.
2. Provide instruction edit/test/compare/activate/restore views backed by native MastraEditor and its existing Postgres provider. Record effective prompt-block versions/hashes on attempts.
3. Implement identical attributed project operations for browser actions, Mastra tools and external MCP; persistent instruction activation is an explicit operator action.
4. Adapt streaming chat, diagnostics, proposed changes and undo/revert display into Manager without app cross-imports.
5. Keep the new agent instruction authority separate from legacy Workspace and Seeker/Langfuse behavior. Update affected guides as part of implementation.

## Constraints

- Do not build a second prompt database or require the separate EE Agent Builder product.
- No browser/external-client access to broad Manager service keys.
- Mastra prompts do not override product revision, approval or publication checks.

## Verification

- Exercise native prompt draft/test/activation/restore against actual Postgres and verify selected versions affect hosted generation.
- Run the same editing scenario through UI, hosted agent and external MCP with matching state and actor history.
- Verify stale revisions, unauthorized scopes, streamed errors, and explicit instruction activation behavior.
