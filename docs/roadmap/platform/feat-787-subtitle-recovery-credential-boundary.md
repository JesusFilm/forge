---
id: "feat-787"
title: "Constrain subtitle recovery credential egress"
owner: "vlad"
priority: "P1"
status: "complete"
start_date: "2026-10-23"
duration: 1
depends_on: []
blocks: []
tags:
  - "mastra"
  - "security"
  - "subtitles"
---

## Problem

The scheduled recovery workflow needs a strict caller boundary and a validated operator-only destination before presenting its service bearer.

## Entry Points — Read These First

1. `apps/mastra/src/mastra/workflows/subtitle-eval-recovery.ts` — input schemas, execute registration and transport.
2. `apps/mastra/src/config/env.ts` — optional operator configuration and process mapping.
3. `docs/runbooks/subtitle-quality-lab-turn-on.md` — recovery endpoint and cadence.

## Grep These

- `SubtitleEvalRecoveryInputSchema|runSubtitleEvalRecovery`
- `MANAGER_SUBTITLE_EVAL_RECOVERY|subtitleEvalRecoveryWorkflow`

## What To Build

- Strict empty/default workflow and step inputs; validate again inside execute.
- Private code-only dependency injection, absent from workflow state and caller schemas.
- Exact HTTPS Manager endpoint validation before fetch and redirect refusal.
- Dummy-only regression tests for registration wiring, env resolution, destination refusal and retained bounded transport behavior.

## Constraints

Keep the five-minute UTC evented schedule, optional pair skip, 240-second default, 1 MiB streamed cap/cancellation, safe errors and outcome counts. No activation, live recovery, production mutation, paid calls or credential access. PR #2350 only; independent review precedes publication.

## Verification

Run focused Vitest, Mastra typecheck/lint, touched-file Prettier, roadmap lint, hidden-lane checks, commitlint and `git diff --check`. Heavy commands use `agent-io-guard`; new outputs live under `/mnt/worktrees/checkouts/t3/Forge/pr-triage-20261024-r1/2350-implementation/`.

## Completion Evidence

Independent review accepted the correction at
`89ef76cd6768d1e6ccf1b827d883dbb374bdc582` with no blockers. Offline verification
passed 246 mocked tests, including 14 fresh independent boundary checks. Mastra
typecheck/lint, roadmap checks, formatting, commitlint and hooks passed during
implementation; publication finalization reruns the focused documentation checks.

The explicit process-env mapping now supplies the optional operator pair; the
schema declaration alone did not map those values in the starting PR. No live
configuration or deployed exploit was established. The durable pattern is recorded
in `docs/solutions/security-issues/mastra-scheduled-workflow-credential-boundary.md`.
This completes only the scoped correction; exact published-head CI remains a
separate publication checkpoint. The broader Subtitle Quality Lab and PR queue
are not marked complete.
