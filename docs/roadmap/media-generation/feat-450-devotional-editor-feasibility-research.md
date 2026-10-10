---
id: "feat-450"
title: "Devotional editor feasibility research"
owner: "tataihono"
priority: "P1"
status: "complete"
start_date: "2026-09-07"
duration: 1
depends_on: []
blocks:
  - "feat-453"
tags:
  - "ai-pipeline"
  - "research"
---

## Problem

The devotional builder design depends on whether agent-generated Remotion code
can be previewed and rendered, whether Mastra can own editable prompt storage,
and whether collaborative editing requires CRDTs. Verify these capabilities
before selecting an implementation.

## Entry Points — Read These First

1. `apps/mastra/package.json` and `apps/mastra/src/mastra/index.ts` — installed Mastra editor and storage integration.
2. `apps/shorts-worker/src/devotional-render.ts` — existing render boundary.
3. `apps/admin/src/mcp/admin-mcp-tools.ts` — revision-aware authoring precedent.
4. `docs/research/devotional-editor-feasibility.md` — findings and primary sources.

## Grep These

- `MastraEditor|stored/agents|promptBlocks`
- `expectedDraftRevision|resolveDevotionalEntryPoint`

## What To Build

Write an evidence-backed research note covering dynamic composition code,
Mastra-owned agent and prompt versions behind a custom UI, and CRDT versus
revision-checked edits. Distinguish official support, installed capabilities,
required integration, and unverified runtime behavior.

## Constraints

- Research only; do not implement, deploy, generate paid assets, or change existing agents.
- Use primary sources and identify the inspected dependency versions.
- Preserve the ongoing design interview's unresolved decisions.

## Verification

- Check claims against official documentation and installed source where available.
- Include source links and concrete repository paths.
- Run Prettier on the research note and this ticket.

## Findings

Research is recorded in `docs/research/devotional-editor-feasibility.md`.
Native Mastra Editor can own instruction storage; Remotion documents dynamic
code compilation; existing Forge revision checks provide a starting point for
concurrent authoring. Runtime integration remains an unimplemented design
decision. No production operations or paid generation were performed.
