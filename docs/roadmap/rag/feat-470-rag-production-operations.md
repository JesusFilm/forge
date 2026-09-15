---
id: "feat-470"
title: "Make production acquisition and indexing self-contained"
owner: "jaco"
priority: "P1"
status: "complete"
start_date: "2026-09-09"
duration: 1
depends_on: []
blocks: ["feat-471"]
tags: ["rag", "infrastructure", "operations"]
---

## Problem

Production acquisition/indexing select JFRAG-named credentials even when the
vault contains separate Forge and legacy databases. Anyone with repository and
Doppler access needs explicit target selection and complete setup, preview,
apply and verification instructions.

## Entry Points — Read These First

- `apps/rag/scripts/acquire.ts`, `apps/rag/scripts/index.ts`
- `apps/rag/scripts/lib/production-target.ts`, `apps/rag/scripts/lib/maintenance-args.ts`
- `apps/rag/src/config/env.ts`, `apps/rag/docs/ops/corpus-maintenance.md`
- Plan: `docs/plans/rag-production-operations.md`

## Grep These

`installForgeProductionEnvironment`, `FORGE_RAG_POSTGRESQL`, `pathPrefix`, `canonicalUrlPrefix`, `--apply`.

## What To Build

Make acquire/index consume explicit Forge credentials directly, use a reader for preview and a writer only for an explicitly gated apply, preserve registered source/path selection throughout, and print scope-visible receipts. Document complete Doppler setup and direct repository commands.

## Constraints

Do not fall back to legacy database credentials, change evaluation/dashboard credentials, touch corpus data, run production writes, or deploy local code. Preserve the English default and the exact Icelandic inventory guard.

## Verification

Test target selection with both namespaces present, missing/mismatched host guards, reader/writer separation, contradictory flags, and real CLI scope forwarding. Run RAG tests, lint, typecheck, import-law checks and scoped formatting.

## Resolution

Implemented the Forge target contract, direct Doppler runbook and scope receipts.
RAG verification passed 867 tests (two database integration tests skipped),
dependency boundaries, typecheck, lint and formatting.

[feat-471](feat-471-rag-production-operations-rollout.md) tracks production
configuration and live verification. No live corpus operation was performed.
Implementing PR: [Forge #2215](https://github.com/JesusFilm/forge/pull/2215).
