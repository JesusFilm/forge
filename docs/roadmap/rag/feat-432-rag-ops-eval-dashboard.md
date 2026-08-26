---
id: "feat-432"
title: "Port RAG sources, skills, dashboard, and evaluation"
owner: "jaco"
priority: "P0"
status: "not-started"
start_date: "2026-09-23"
duration: 5
depends_on: ["feat-431"]
blocks: ["feat-433"]
tags: ["rag", "evaluation", "operations"]
---

## Problem

Forge needs the durable operational and quality surfaces that make the corpus maintainable. Historical scope: [jfrag #165](https://github.com/JesusFilm/jesusfilm-rag/issues/165).

## Entry Points — Read These First

1. jfrag source registry, skills, dashboard compiler/verifier, and eval harness.
2. Forge skill/plugin conventions before relocating agent workflows.

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
