---
id: "feat-423"
title: "Scaffold the RAG space and durable roadmap"
owner: "jaco"
priority: "P0"
status: "complete"
start_date: "2026-08-26"
duration: 1
depends_on: []
blocks: ["feat-424"]
tags: ["rag", "infrastructure", "migration"]
---

## Resolution

**Shipped:** 2026-08-26 via [PR #2033](https://github.com/JesusFilm/forge/pull/2033) (`feat(rag): scaffold migration workspace and roadmap`).

**What landed.** Forge now has CI-recognized empty RAG and shared-contract workspaces, fail-closed import and file-size boundaries, explicit ownership and repository guidance, and a hidden 13-ticket migration lane mapped to jfrag #130 and #156-168. No runtime, database, secret, corpus, or production behavior moved.

**Unblocked.** `feat-424`.

## Problem

Forge needs a governed, CI-recognized home before any RAG runtime or production state moves from the programme rooted at [jfrag #130](https://github.com/JesusFilm/jesusfilm-rag/issues/130).

## Entry Points — Read These First

1. `apps/rag/CLAUDE.md` — durable bounded-context and migration rules.
2. `apps/rag/.dependency-cruiser.cjs` — enforced import law.
3. `docs/roadmap/rag/README.md` — issue-to-ticket mapping.

## Grep These

- `@forge/rag`
- `rag-contracts`
- `LANE_DIRS`
- `README_LANE_ORDER`

## What To Build

Create empty `apps/rag` and `packages/rag-contracts` workspaces, this unregistered roadmap lane, ownership/docs registration, and structural guards without porting behavior.

## Constraints

- Do not deploy or move runtime code, secrets, schemas, or corpus rows.
- Do not register the RAG lane in the roadmap viewer or generated totals.

## Verification

- `pnpm install --frozen-lockfile`
- `pnpm --filter @forge/rag test`
- `pnpm --filter @forge/rag-contracts test`
- `pnpm turbo ls` contains both new workspaces.
- Root roadmap generation produces no diff and does not mention `feat-423`.
