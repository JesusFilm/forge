---
id: "feat-322"
title: "Devotional Workspace data plane"
owner: "vlad"
priority: "P1"
status: "complete"
start_date: "2026-07-31"
duration: 10
depends_on: []
blocks: []
tags:
  - "ai-pipeline"
  - "mastra"
  - "railway"
---

## Problem

The devotional workflow currently mixes business logic with authored source
material and process-local artifacts. Studio editors cannot manage the complete
input corpus through Mastra Workspace, newly dropped sources are not
automatically eligible, and retries can observe stale local state.

## Entry Points — Read These First

1. `docs/plans/2026-07-31-001-feat-devotional-workspace-data-plane-plan.md`
2. `apps/mastra/src/mastra/workflows/video-first-devotional.ts`
3. `apps/mastra/src/mastra/index.ts`
4. `apps/shorts-worker/src/storage.ts`

## Grep These

- `reflection-corpus|web-bible|jesus-film-passages|voice-rotation` in
  `apps/mastra/src/services/devotional`.
- `devotional-cache|used-clips-ledger` in `apps/mastra/src`.
- `new Mastra|workspace` in `apps/mastra/src/mastra`.

## What To Build

Register one writable `Devotional Workspace` backed by a dedicated Railway
bucket in production and local filesystem parity elsewhere. Make supported
Workspace files the only authored-input authority, reconcile a bounded
fail-closed hybrid catalog for each new attempt, keep lifecycle and reservation
state in PostgreSQL, and keep media-byte execution in Shorts Worker. Existing
authenticated Studio editors retain the native, identical Workspace CRUD and
search behavior.

## Constraints

Workflow code contains business logic, schemas, deterministic algorithms, and
immutable safety floors only. It has no authored text, audio, video, corpus, or
compiled fallback data. Supported dropped text is eligible on the next new
attempt; unsupported formats are reported. Production changes use the normal
PR-to-main Railway flow.

## Verification

Mastra, Gateway, Worker, and composition tests prove Workspace registration,
fresh source discovery, fail-closed hybrid reconciliation, bounded provenance,
immutable media references, authenticated Studio CRUD/search, migration
idempotency, and the complete edit-to-publish flow.

## Implementation Evidence

- Mastra: 1,552 tests passed (3 skipped); typecheck and lint passed.
- Mastra Gateway: 32 tests passed; typecheck and lint passed.
- Shorts Worker: 162 tests passed; typecheck and lint passed.
- Shorts Compositions: 68 tests passed; typecheck and lint passed.
- Mastra's generated server bundle contains the Workspace and data-plane
  singletons, and a local Studio browser smoke rendered `Devotional Workspace`
  with native file and directory controls.
- Production migration, restore attestation, canary generation, and PostgreSQL
  cutover remain operator-run release gates after the normal PR-to-main Railway
  deployment. No direct production deployment was performed from the worktree.
