---
id: "feat-541"
title: "Add lightweight RAG adversarial review skill"
owner: "jaco"
priority: "P1"
status: "complete"
start_date: "2026-09-23"
duration: 1
depends_on: []
blocks: []
tags: ["rag", "skills", "review", "documentation"]
---

## Problem

RAG code, source additions, and documentation need a shared, read-only review
workflow that checks Forge boundaries and evidence without requiring an external
review plugin or a large reviewer roster.

## Entry Points — Read These First

1. `plugins/jfp-rag/skills/` — provider-neutral skill packaging.
2. `apps/rag/AGENTS.md` and `packages/rag-contracts/AGENTS.md` — ownership rules.
3. `apps/rag/docs/architecture.md` — current architecture authority.
4. `.claude/commands/review-fix-loop.md` — introduced-defect review convention.
5. `apps/rag/tests/skills-layout.test.ts` — plugin discovery checks.

## Grep These

`rag-review`, `ce-code-review`, `SKILLS`, `allow_implicit_invocation`.

## What To Build

- `plugins/jfp-rag/skills/rag-review/SKILL.md` and provider UI metadata.
- Documentation, architecture, testing, and adversarial evidence lenses with
  concise findings, test gaps, and an overall assessment.
- Recommendations in root/package guides, plus guidance for RAG roadmap docs.
- Adapt packaging checks without changing existing operator approval policies.

## Constraints

Reviews remain read-only, never post comments, and never merge or deploy.
Default to one reviewer; additional reviewers/models require existing tool
availability and authorization. Preserve current provider/model constraints.
Use domain language and Forge feature references in durable artifacts.

## Verification

- Skill-creator `quick_validate.py` on the new skill directory.
- `pnpm --filter @forge/rag exec vitest run tests/skills-layout.test.ts`.
- Hidden-roadmap-lane checks and changed-file Prettier checks.
- Whole-diff review, link checks, and scenario walkthroughs documented in
  `docs/validation/rag-review/implementation-report.md`.

## Resolution

Delivered in [Forge draft PR #2400](https://github.com/JesusFilm/forge/pull/2400).
The review-only skill, guide recommendations, and packaging checks are complete.
The [implementation report](../../validation/rag-review/implementation-report.md)
records passing local validation, single-reviewer scenario checks, and limitations.
No runtime, corpus, production, deployment, or merge changes were made.
