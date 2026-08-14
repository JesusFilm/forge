---
id: "feat-363"
title: "Devotional text quality gate with report-only rollout"
owner: "vlad"
priority: "P1"
status: "complete"
start_date: "2026-08-13"
duration: 2
depends_on:
  - "feat-322"
blocks: []
tags:
  - "devotional"
  - "mastra"
  - "ai-pipeline"
---

## Problem

The video-first devotional pipeline had one gate: safety, which asks whether the
text is safe to publish. Nothing asked whether it was worth publishing. A
reflection could contradict the verse on screen, carry nothing the viewer takes
away, or drop the argument its source was making, and it would go straight to paid
ElevenLabs narration and a multi-minute Remotion render before any human saw it.

Three critics for exactly that existed on `feat/daily-devotional-generator`, which
diverged before the Workspace data plane (feat-322) landed. Two of the owner's
content rules had also never reached the authored prompt: that the viewer already
follows Jesus, and that the narration must describe rather than command.

## Entry Points — Read These First

1. `apps/mastra/src/services/devotional/devotional-quality-gate.ts` — composes the
   three critics and returns `{ blocking }`. Read the header first: it explains
   that the gate does NOT throw, and why the enforcement point is the caller.
2. `apps/mastra/src/mastra/workflows/video-first-devotional.ts` — `contentStep`
   runs the gate, `produceStep` refuses the paid handoff, `qualityBlocksRun`
   is the one function all three callers ask.
3. `apps/mastra/src/services/devotional/devotional-coherence.ts`,
   `devotional-reflection-critic.ts`, `reflection-fidelity-critic.ts` — one
   attempt each; the retry budget belongs to `llm.ts`.
4. `apps/mastra/devotional-workspace/inputs/prompts/generation.json` — the two
   owner rules, plus the `conclusion` and `pointPicker` prompts that moved out of
   code so they can be edited without a deploy.
5. `apps/mastra/CLAUDE.md` — `DEVOTIONAL_QUALITY_GATE_ENFORCED` in the env table.

## Grep These

- `qualityBlocksRun` — the single blocking decision. Three states:
  `undefined` is a legacy run and does NOT block, `null` is safety-blocked and
  does, a present verdict blocks only when it was enforced.
- `isDevotionalQualityGateEnforced` — the rollout lever.
- `blockedBy` — which gate stopped a run, in the result and the artifact.
- `sourceReference` — the source's own passage, which a Spurgeon selection does
  not share with the film.

## What Was Built

- The gate, wired into `contentStep`, with `produceStep` refusing the paid handoff
  on a blocking verdict. A critic that could not RUN counts as blocking.
- `DEVOTIONAL_QUALITY_GATE_ENFORCED`, default `false`. The critics run in both
  modes and every run records `quality: { blocking, enforced }`, so the
  false-positive rate and provider reliability are countable before enforcement.
- The owner's two content rules in the authored prompt, guarded by a test that
  states its own scope: it pins the committed SEED, not the deployed document.
- One attempt per critic. `llm.ts` owns the retry budget and its errors carry the
  upstream HTTP status, which is what separates a permanent 400 from an exhausted
  429 behind the same code.
- Cancellation from the workflow step through the gate, the critics and the HTTP
  client, including the wait between retries.

## Constraints

- Do NOT make the gate throw. It returns a verdict and the caller short-circuits,
  matching the safety gate. An unused throwing wrapper reads as enforcement while
  enforcing nothing, and this module already shipped one such symbol.
- Do NOT add a retry around a critic. One layer owns the attempt budget; three
  critics each adding one made a worst case of eighteen requests for one gate.
- Do NOT treat a missing `quality` key as blocking. That is a legacy run, and
  refusing it after the render is money spent for nothing.
- Report-only is the default and must stay the default. Enabling enforcement is
  the act that requires intent, because forgetting in that direction is safe.

## Verification

```bash
pnpm --filter @forge/mastra exec tsc --noEmit
pnpm --filter @forge/mastra lint
pnpm --filter @forge/mastra test -- --run
pnpm exec prettier --check .
```

Deployment, in this order:

1. Deploy with `DEVOTIONAL_QUALITY_GATE_ENFORCED` unset. Confirm attempt artifacts
   carry `quality: { blocking, enforced: false }`.
2. Read the live Workspace prompt back and confirm it contains
   `DO NOT REDIRECT THE AUTHOR'S AUDIENCE` and `DESCRIBE, DON'T COMMAND`. A green
   CI run is not that proof — the migration reports a conflict rather than
   overwriting a diverged document.
3. Once the recorded runs justify it, set `DEVOTIONAL_QUALITY_GATE_ENFORCED=true`.
   Rollback is the same variable back to `false`, with no deploy.

## Follow-ups Not In Scope

- The three critics run sequentially; they are independent reads of the same text
  and could be concurrent.
- `pointPicker` and `conclusionWriter` do not consult `DEVOTIONAL_AGENT_MODELS`.
- Content composition's own model calls are not yet cancellable.
- `DevotionalCopy.conclusion` is generated and discarded.
- The ordinal lead-in regex does not match every form J.C. Ryle uses, so some
  multi-point excerpts reach the writer whole.
