---
id: "feat-352"
title: "Devotional readiness and corpus contract repair"
owner: "codex"
priority: "P0"
status: "complete"
start_date: "2026-08-11"
duration: 1
depends_on: []
blocks: []
tags:
  - "mastra"
  - "devotional"
  - "workspace"
  - "migration"
  - "data-integrity"
---

## Problem

The generalized Mastra database migrator records later non-devotional
migrations in the shared immutable ledger, but devotional readiness assumes the
latest ledger version must equal migration 1. The public-domain corpus
generators also emit strict provenance fields that their Workspace parsers
reject, and their CLIs still write to the obsolete ignored `devo/corpus` tree.

## Entry Points — Read These First

1. `docs/plans/2026-08-11-001-fix-devotional-readiness-corpus-contracts-plan.md`
2. `apps/mastra/src/services/devotional/workspace/database.ts`
3. `apps/mastra/src/services/devotional/reflection-corpus.ts`
4. `apps/mastra/src/services/devotional/web-bible.ts`
5. `apps/mastra/src/scripts/ingest-web-bible.mjs`

## What To Build

1. Verify every required devotional migration by version, filename, and
   checksum without treating unrelated later migrations as devotional schema
   versions.
2. Define strict, bounded scripture and reflection document envelopes that
   accept the provenance emitted by all four corpus generators.
3. Load canonical content-only scripture paths into the existing OSIS verse
   map.
4. Require an external Workspace staging root for corpus CLIs and write beneath
   canonical `inputs/scripture` or `inputs/reflections` folders.
5. Exercise real generator output through Workspace inventory and attempt-data
   loading with compact, network-free fixtures.

## Constraints

- Do not change immutable migration SQL or rewrite applied migration history.
- Do not weaken strict corpus validation with passthrough schemas.
- Do not commit generated full corpora or production corpus data.
- Do not mutate production, seed the production Workspace, or enable devotional
  starts in this work.

## Verification

- Run focused migration, parser, generator, inventory, and attempt-data tests.
- Run the full `@forge/mastra` test, typecheck, lint, formatting, and Studio
  build surfaces.
- Confirm the diff contains no generated full corpus or production cutover
  evidence.
