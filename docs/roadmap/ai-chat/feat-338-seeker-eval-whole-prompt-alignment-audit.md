---
id: "feat-338"
title: "Seeker eval whole-prompt alignment audit"
owner: "jaco"
priority: "P1"
status: "complete"
start_date: "2026-08-07"
duration: 1
depends_on:
  - "feat-272"
blocks: []
tags:
  - "ai-pipeline"
  - "testing"
---

## Resolution

**Shipped:** 2026-08-07 via
[PR #1856](https://github.com/JesusFilm/forge/pull/1856)
(`fix(mastra): align seeker eval with whole-prompt management`).

**What landed.** The full PR diff was audited against feat-272's 2026-07-29
owner ruling. Stale prototype-era split-composition guidance was removed from
the eval decision and review path; eval-owned section tags are now explicitly
analytical only. The gating runner now resolves the single managed prompt once
and injects that exact text into every cell, preventing a cache-TTL expiry or
mid-run label move from making later cells diverge from the stamped run
identity.

**Compound docs.**
[Stochastic eval gates need confirmation and a refused state](../../solutions/architecture-patterns/stochastic-eval-gates-need-confirmation-and-refusal.md).

**Residual risk / follow-ups.** Langfuse label moves remain outside PR/CI
enforcement, as accepted by feat-272. The eval can review a whole candidate
prompt before promotion but cannot technically require that review.

## Problem

PR #1856 ports the seeker eval suite from a prototype that predated the
2026-07-29 owner ruling in feat-272. The prototype assumed a split between
code-owned safety/tool wording and Langfuse-owned prompt sections, while the
shipped contract manages the entire `seeker-system` prompt as one Langfuse
prompt with only a byte-identical fallback in code. Stale split-language in the
PR's decision record raises the risk that implementation or review guidance
also retained superseded assumptions.

## Entry Points — Read These First

1. `docs/roadmap/ai-chat/feat-272-seeker-langfuse-managed-prompt-integration.md`
   — governing whole-prompt decision and shipped contract.
2. `apps/mastra/CLAUDE.md` under `Langfuse prompt management` — package-level
   rule: one managed prompt, no composition split.
3. `apps/mastra/src/evals/seeker/DECISION.md` and `REVIEW.md` — decision and
   reviewer guidance carried from the prototype.
4. `apps/mastra/src/evals/seeker/prompt-sections.ts` — eval-only analytical
   tagging that must remain distinct from runtime prompt composition.
5. `apps/mastra/src/mastra/agents/seeker-prompt.ts` and `seeker-agent.ts` —
   fallback text and production resolver seam.

## Grep These

- `prompt section` / `sections by label` / `section registry`
- `stay in code` / `code-owned` / `composition split`
- `SEEKER_SYSTEM_PROMPT_FALLBACK` / `SEEKER_SYSTEM_PROMPT_NAME`
- `promptSource` / `langfusePromptVersion` / `promptSha256`

## What To Build

1. Audit every file changed by PR #1856 for assumptions that the runtime
   prompt is assembled from independently owned sections.
2. Rewrite stale decision/review guidance to describe one managed
   `seeker-system` prompt and the byte-identical code fallback.
3. Preserve eval-owned line-to-section tagging only as analysis over the
   resolved whole prompt; do not introduce a runtime section registry.
4. Correct implementation or tests only where they conflict with the shipped
   whole-prompt contract. Do not change scoring or gate policy incidentally.

## Constraints

- Do not change Langfuse prompt text, labels, or versions.
- Do not add prompt composition or section-fetching infrastructure.
- Keep production's default seeker construction behavior unchanged.
- Keep the eval runnable against the exact prompt text served for the run and
  retain prompt provenance in run identity.

## Verification

- Review `git diff origin/main...HEAD` for all PR files and grep for the
  superseded split vocabulary.
- Run focused seeker prompt/eval tests for touched modules.
- Run `pnpm --filter @forge/mastra typecheck` and lint/format checks relevant
  to the touched scope.
