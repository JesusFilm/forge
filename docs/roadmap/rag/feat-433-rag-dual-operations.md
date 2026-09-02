---
id: "feat-433"
title: "Complete owner-managed dual RAG operations"
owner: "jaco"
priority: "P0"
status: "complete"
start_date: "2026-09-28"
duration: 3
depends_on: ["feat-432"]
blocks: []
tags: ["rag", "operations", "rollback"]
---

## Problem

The migration programme included owner-managed VM and NanoClaw administration
outside the Forge repository. Historical scope:
[jfrag #166](https://github.com/JesusFilm/jesusfilm-rag/issues/166).

## Entry Points — Read These First

1. [jfrag #166](https://github.com/JesusFilm/jesusfilm-rag/issues/166) — historical owner-operations checklist.
2. `apps/rag/AGENTS.md` and Forge operator commands delivered by `feat-431`/`feat-432` — the shared repository contracts consumed by external operator tooling.

## Grep These

- `NanoClaw`
- `VM`
- `environment`
- `service`

## What To Build

Complete the external owner-operated transition without adding personal VM task
definitions or host-specific evidence to Forge.

## Constraints

- Do not make a personal VM deployment part of Forge's supported surface.
- Keep host-specific configuration and evidence in the private operations
  system.

## Verification

- The owner confirms the external administration is complete.
- No Forge application change is required.

## Resolution

Completed on September 3, 2026 as owner-managed external administration. The
owner verified the required read-only and bounded interactions and retained
detailed configuration and test evidence in the private operations system.
Live acquisition, indexing, migration, and language writes were not part of
this closure.

No Forge application or shared operational-contract change was required. This
personal environment is not a prerequisite for Seeker cutover or another Forge
contributor workflow.

Completed in [Forge PR #2152](https://github.com/JesusFilm/forge/pull/2152).
