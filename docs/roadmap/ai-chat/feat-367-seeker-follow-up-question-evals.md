---
id: "feat-367"
title: "Automated quality evals for Seeker follow-up questions"
owner: "jian wei"
priority: "P2"
status: "not-started"
start_date: "2026-09-08"
duration: 3
depends_on:
  - "feat-366"
blocks: []
tags:
  - "ai-pipeline"
---

## Problem

feat-366 ships the follow-up chips with a PR-reviewed prompt and a syntactic projection only — nothing automatically checks that generated questions are GOOD (on-topic, person-voiced, non-duplicative, honest about capabilities). KD3 of the approved plan (`docs/plans/2026-08-18-0406-feat-seeker-follow-up-questions-plan.md`) deliberately deferred repo-native quality evals to this ticket. The generator is a pure function over (question, answer-tail) pairs, so it slots into the existing offline seeker eval pipeline without touching any live path.

## Entry Points — Read These First

1. `apps/mastra/src/mastra/seeker-follow-ups.ts` (exists after feat-366 U1) — the pure core: `buildPostHocFollowUpsPrompt`, `parsePostHocFollowUps`, `projectFollowUps`. The eval drives these directly; no route or agent surface is involved.
2. `apps/mastra/src/evals/seeker/` — the existing pipeline to extend (`run-answers.ts`, `run-judge.ts`, `run-score.ts`, `run-report.ts`, `run-gate.ts`, and `questions.ts` for per-criterion patterns).
3. `apps/mastra/evals/experiments/README.md` — if eval findings motivate a managed-prompt change, that change goes through the experiments ledger. The follow-ups generator prompt itself is code-owned (plan KTD5): eval findings drive PR-reviewed code edits.

## Grep These

- `eval:seeker:` — the package-script family this joins
- `CHAT_EVAL_OPENROUTER_API_KEY` — the dedicated eval key (the runner refuses the production paid key)
- `q-grief-stays` — the criterion-definition pattern in `questions.ts` to mirror

## What To Build

An offline eval lane for generated follow-up questions: run the generator over a fixed (question, answer) fixture set (reuse or extend the seeker baseline answers), judge each generated set against named criteria — person's voice, under 15 words, no restatement of the answer or its closing question, no capability promises, topical continuation — then score and report in the existing pipeline's shape. Output is a scored report that feeds prompt iteration; it never becomes a live-path gate.

## Constraints

- Offline only. Nothing here enters the live send path, the replay path, or CI's required checks.
- Uses the dedicated eval OpenRouter key, never the production paid key.
- The generator prompt stays code-owned; do not move it to Langfuse as part of this work.

## Verification

A `pnpm --filter @forge/mastra eval:seeker:followups`-style command runs the lane end to end over the fixture set and writes a scored report; the eval README documents it; one full run's results are linked from this ticket's `## Resolution` when it completes.
