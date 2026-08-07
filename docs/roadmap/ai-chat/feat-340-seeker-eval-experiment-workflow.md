---
id: "feat-340"
title: "Seeker eval experiment workflow"
owner: "jaco"
priority: "P2"
status: "not-started"
start_date: "2026-08-17"
duration: 5
depends_on: []
blocks: []
tags:
  - "ai-pipeline"
  - "infrastructure"
---

## Problem

The Seeker eval has a production-shaped agent loop, frozen retrieval fixtures, judge, gate, and canonical benchmark, but no durable experiment lifecycle.
Its committed benchmark was generated from the repository fallback rather than a Langfuse-managed prompt, and working runs are not organized as permanent experiment-scoped evidence packages.

The authoritative requirements are in `docs/plans/2026-08-07-001-feat-seeker-eval-experiment-workflow-plan.md`.
The workflow must support attributable prompt or model experiments, preserve every outcome in Git, and promote accepted candidates separately while keeping production and its benchmark aligned.

## Entry Points — Read These First

1. `docs/plans/2026-08-07-001-feat-seeker-eval-experiment-workflow-plan.md` — requirements, lifecycle, eligibility, promotion, portability, and scope boundaries.
2. `apps/mastra/src/evals/seeker/DECISION.md` — current Seeker eval intent and measured gate policy.
3. `apps/mastra/src/evals/seeker/run-loop.ts` — production-shaped execution, prompt resolution, model selection, and run identity.
4. `apps/mastra/src/evals/seeker/types.ts` — comparison identity and mismatch scopes.
5. `apps/mastra/src/evals/seeker/gate.ts` and `run-gate.ts` — eligibility policy and canonical benchmark entry point.
6. `apps/mastra/src/services/langfuse-prompt-client.ts` — current label retrieval, fallback/stale behavior, and prompt provenance.

## Grep These

- `getManagedPrompt` / `promptSource` / `promptLangfuseVersion`
- `answeringModelsByIds` / `answeringModels`
- `identityMismatch` / `scope: "gate"`
- `seeker-baseline` / `eval-runs/seeker`
- `LANGFUSE_PROMPT_DEFAULT_LABEL`

## What To Build

- Add repository-native Seeker experiment packages with manifest validation, one-axis enforcement, experiment-scoped evidence, comparison, and terminal human verdicts.
- Add exact managed-prompt version selection and fail closed before generation when an official experiment or benchmark resolves fallback, stale, missing, deleted, or mismatched prompt content.
- Extend comparison identity and gate behavior so prompt experiments hold the production model fixed and model experiments hold the production prompt version fixed.
- Add a separate promotion contract that consumes only successful, gate-eligible experiments and updates the production prompt version or model alongside the matching canonical benchmark.
- Replace the fallback-based benchmark with a production-shaped, exact-version Langfuse benchmark.
- Keep persisted experiment identities provider-neutral while limiting the first implementation to the current Langfuse prompt and Mastra runtime seams.

## Constraints

- The requirements plan is authoritative; planning must not weaken its success gate, one-axis rule, two-PR boundary, or full evidence-retention contract.
- Git remains the authoritative experiment ledger; Langfuse, Mastra, and tracing systems are replaceable supplements.
- Production selects an exact prompt version pinned in the repository; the Langfuse `production` label is an alert-only deployment marker.
- Do not commit managed prompt bodies, credentials, or unrestricted trace payloads.
- Do not add a database, UI, prompt-authoring automation, label-mutation automation, provider-plugin framework, or prompt-by-model matrices in the first version.
- Production changes continue through the normal PR-to-main deployment flow.

## Verification

- Run the PR-focused Mastra test, typecheck, lint, and format checks selected during implementation planning.
- Prove official runs reject fallback and stale prompt resolutions before answer-generation spend.
- Prove off-axis identity drift refuses comparison for both prompt and model experiments.
- Prove successful, failed, inconclusive, and deferred experiments each produce complete commit-ready packages.
- Prove red-gate experiments cannot enter promotion and human review remains a veto only.
- Prove promotion either reuses an exact accepted identity as the benchmark or requires a fresh qualifying run.
- Prove repository-pinned prompt traffic remains healthy when the Langfuse `production` label lags, while the mismatch emits an actionable alert.
