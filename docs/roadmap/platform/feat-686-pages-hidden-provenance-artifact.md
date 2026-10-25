---
id: "feat-686"
title: "Preserve declared Pages provenance with upload action v5"
owner: "tataihono"
priority: "P1"
status: "complete"
start_date: "2026-10-12"
duration: 1
depends_on: []
blocks: []
tags: [infrastructure, tooling]
---

## Problem

`actions/upload-pages-artifact` v5 excludes hidden files by default. The committed
Pages manifest declares `rag-status/.dashboard-commit.json`; the v5 archive drops
that file despite successful site assembly and CI verification.

## Entry Points — Read These First

1. `.github/workflows/rag-pages.yml`: Upload verified Pages artifact step.
2. `docs/pages/manifest.yaml`: complete publication allowlist.
3. `apps/rag/scripts/assemble-pages.ts`: rejects undeclared files and symlinks.
4. `apps/rag/tests/pages-assembly.test.ts`: committed producer file contract.

## Grep These

`upload-pages-artifact`, `include-hidden-files`, `.dashboard-commit.json`.

## What To Build

Set the upload action's supported `include-hidden-files: true` input to preserve
v3's packaging behavior for the already verified manifest-controlled directory.

## Constraints

Preserve the manifest, validation, deployment authority, permissions, and source
artifacts. No deployment or baseline test changes. Do not upload any directory
other than the assembler's verified output.

## Verification

Run frozen pnpm installation, `pnpm --filter @forge/rag dashboard:verify`, the
existing `tests/pages-assembly.test.ts` suite, and actual site assembly. Execute
upstream v3 and v5 Linux archive scripts on the committed declared tree; v5's
repaired archive must retain every declared file including the provenance JSON.
Check formatting and fresh exact-head `ci-gate` and Pages verification.

## Resolution

The upload step now explicitly includes hidden files from the manifest-controlled
assembled directory. Native frozen installation, dashboard verification, all six
existing Pages assembly tests, and real site assembly pass. Executing the
published Linux archive scripts reproduces the original omission and confirms
the supported input preserves all three declared files and their bytes. Fresh
PR checks remain the integration gate; no deployment was performed.
