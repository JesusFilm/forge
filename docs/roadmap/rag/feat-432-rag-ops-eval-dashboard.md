---
id: "feat-432"
title: "Port RAG sources, skills, dashboard, and evaluation"
owner: "jaco"
priority: "P0"
status: "complete"
start_date: "2026-09-23"
duration: 5
depends_on: ["feat-431"]
blocks: ["feat-433", "feat-434"]
tags: ["rag", "evaluation", "operations"]
---

## Problem

Forge needs the durable operational and quality surfaces that make the corpus maintainable. Historical scope: [jfrag #165](https://github.com/JesusFilm/jesusfilm-rag/issues/165).

## Entry Points — Read These First

1. `JesusFilm/jesusfilm-rag/docs/source-status.yaml`, `JesusFilm/jesusfilm-rag/src/registry/`, and `JesusFilm/jesusfilm-rag/scripts/source-status.ts` — source inventory and status inputs.
2. `JesusFilm/jesusfilm-rag/scripts/dashboard-compile.ts`, `JesusFilm/jesusfilm-rag/scripts/dashboard-verify.ts`, `JesusFilm/jesusfilm-rag/dashboard/`, and `JesusFilm/jesusfilm-rag/docs/ops/dashboard.md` — dashboard compiler, verifier, generated surface, and runbook.
3. `JesusFilm/jesusfilm-rag/scripts/eval.ts`, `JesusFilm/jesusfilm-rag/scripts/eval-production.ts`, `JesusFilm/jesusfilm-rag/scripts/eval-metrics.ts`, and `JesusFilm/jesusfilm-rag/eval/qa-golden.yaml` — retrieval evaluation harness and golden cases.
4. `.agents/skills/`, `.claude/skills/`, and the Forge plugin/skill conventions loaded by the implementing agent — target locations and provider-neutral workflow rules.

## Grep These

- `qa-golden.yaml`
- `dashboard:verify`
- `source-status`
- `skills-layout`

## What To Build

Port sources, source status, agent skills, dashboard generation, and retrieval evaluation with their deterministic checks.

## Constraints

- Evals remain retrieval-only; consumers own answer quality and intent.
- Dashboard artifacts and reports must not expose corpus text or secrets.

## Verification

- Skill layout, dashboard build/verify, source status, and eval tests pass.
- Baseline results reconcile with pre-copy controls.

## Resolution

Completed in [Forge PR #2117](https://github.com/JesusFilm/forge/pull/2117).
The change ports the source registry and lifecycle tooling, provider-neutral
skills, deterministic dashboard build and verification, and retrieval-only
evaluation. The production-backed dashboard refresh remains an explicit
operator-run workflow; CI validates the prepared artifacts without treating
lifecycle files as deployment evidence.
