---
id: "feat-322"
title: "Seeker system-prompt eval suite"
owner: "jaco"
priority: "P2"
status: "not-started"
start_date: "2026-07-29"
duration: 5
depends_on:
  - "feat-296"
blocks: []
tags:
  - "ai-pipeline"
---

## Problem

We can't tell a good Seeker system prompt from a bad one. Today the process is: open
Studio, ask three questions, decide it reads better. There's no way to answer "did that
edit help?" and no way to answer "which model handles which kind of question badly?"

forge already has a mature eval system for **search**
(`apps/mastra/src/services/offline-search-eval/`) and nothing for **answer quality**.
feat-199 deferred exactly this and no follow-up ticket was created. This is it.

## Two prompts — read this before anything else

There are two Seeker system prompts and they are not interchangeable.

|                  | **Fallback prompt**                     | **Managed prompt**            |
| ---------------- | --------------------------------------- | ----------------------------- |
| Where it lives   | in code, `SEEKER_FALLBACK_PROMPT`       | Langfuse, under a label       |
| Publicly visible | **Yes** — this repo is public           | **No** — that's the point     |
| What it's for    | safety net when Langfuse is unreachable | the real prompt we iterate on |
| Evaluated?       | **Never**                               | **Always**                    |

The first version we put in Langfuse will be a **copy of the fallback text**. That copy is
what we evaluate, and its scores become the benchmark. From the second version onward the
managed prompt diverges and is genuinely secret — which is why nothing in this repo may
ever contain its text.

If a run finds Langfuse unreachable, `getManagedPrompt` returns the fallback. **The run
must stop with a clear error and write nothing.** Quietly scoring the fallback would give
you a green result for a prompt nobody runs.

## How it works

One prompt per run. Comparison is against a stored result set, not a second live fetch.

1. **Set the benchmark.** Put the fallback text into Langfuse as v1. Run the full suite
   against it. Commit that result set as the benchmark.
2. **Run an experiment.** Write a new prompt, add it to Langfuse under a new label. Run
   the same suite — same questions, same models, same judge.
3. **Compare result sets.** Any question that drops a band is a fail. Everything equal or
   better is a pass.
4. **Promote or discard.** A pass gets the `development` / `stage` / `production` labels
   added to that Langfuse version, and its result set becomes the new benchmark. A fail
   gets nothing; keep the result set as the record of what didn't work.

**The run refuses to compare unlike things.** The benchmark records which questions,
models and judge produced it. If the current run doesn't match, it errors instead of
comparing — otherwise you're measuring a model swap and calling it a prompt result.

When you suspect the models themselves have drifted, re-run the benchmark prompt and
replace the benchmark. Don't compare across a suspected drift.

## Scoring

Each question carries two lists of plain sentences — what a good answer **must do** and
**must not do**. Write behaviours, never phrases: "opens by naming what the user is
feeling", not "says 'I hear you'". A rubric written from one model's remembered wording
measures "sounds like that model", not quality.

The judge does **not** return a score. For each list item it returns one of
`satisfied` / `violated` / `not-applicable`, **and the exact words from the answer that
prove it**.

Your code does the arithmetic:

```
score = satisfied / applicable
```

That's the whole point — a model saying "I'd call that a 0.8" is a vibe with a number
attached. Requiring a quote also kills unfalsifiable rubric items at the moment someone
writes them.

Three things are an **error**, not a failure, and are reported separately rather than
counted against the prompt:

- a `violated` verdict with no quote
- a missing verdict for any item (judges silently skip items in batches)
- a truncated answer (`finishReason: "length"`)

Report **bands** — pass / borderline / fail — not decimals. A grid of decimals invites
ranking, and ranking on a single sample flips a decision on noise.

## Entry Points — Read These First

1. **`apps/mastra/src/mastra/agents/seeker-agent.ts`** — the prompt under test. The
   instructions are an unexported array inside the `new Agent({...})` call, and importing
   this module stands up a memory store just to read a string. PR1 fixes that.

2. **`apps/mastra/src/services/devotional/llm.ts:70`** — `createDevotionalLlm`. Seven
   hand-rolled OpenRouter clients already exist here. **Do not write an eighth.** It
   returns parsed JSON only, so the judge can use it as-is but the subject needs an
   added text-mode return carrying `finishReason`, token counts and latency.

3. **`apps/mastra/src/services/devotional/safety-gate.ts`** — the existing house pattern
   for a rubric gate decided in code, not by the model. Copy its shape.

4. **`apps/mastra/src/services/offline-search-eval/`** — the precedent for all of this:
   `seed-prompt-set.ts` for the question corpus, `runner.ts` `costFor()` for cost
   reporting, `artifacts.ts` for separating judge failures from real losses. The CLI
   precedent is `src/scripts/run-content-embedding-search-eval.ts`.

5. **`apps/mastra/src/services/langfuse-prompt-client.ts:735`** — `getManagedPrompt`.
   Never throws. **Watch out:** if you don't pass a label it silently defaults to
   `production`. Always pass one explicitly.

6. **`docs/roadmap/ai-chat/feat-272-seeker-langfuse-managed-prompt-integration.md`** —
   Langfuse owns only the tunable persona part
   of the prompt; the SAFETY line and the citation rules stay in code. So
   `getManagedPrompt` gives you a fragment, not a whole system prompt — something has to
   compose it. That's PR1.

## Grep These

```bash
# The prompt under test
grep -n "instructions:" apps/mastra/src/mastra/agents/seeker-agent.ts

# Proof you shouldn't write another OpenRouter client
grep -rln "openrouter.ai/api/v1/chat/completions" apps/mastra/src apps/admin/src

# The existing rubric-gate-in-code pattern
grep -n "Code — not the model alone — decides" apps/mastra/src/services/devotional/safety-gate.ts

# The eval must be unreachable from the Mastra bundler entry (must return nothing)
grep -rn "prompt-eval" apps/mastra/src/mastra/
```

## What To Build

### PR1 — Extract the prompt (half a day)

New file `apps/mastra/src/mastra/agents/seeker-system-prompt.ts`:

```ts
/**
 * PUBLIC BY DESIGN. The offline safety net, used only when Langfuse is
 * unreachable. NOT the production prompt, and never evaluated.
 */
export const SEEKER_FALLBACK_PROMPT: string

/** Builds the effective system prompt. The agent and the eval both call this,
 *  so a second copy of the text can't exist. */
export function buildSeekerSystemPrompt(managedPersona?: string): string
```

- Move the instruction array out of `new Agent({...})`. The name
  `SEEKER_FALLBACK_PROMPT` matters — a future reader must not mistake it for the real one.
- `managedPersona` is the Langfuse half. The SAFETY line and citation rules are always
  appended in code.
- `seeker-agent.ts` becomes `instructions: buildSeekerSystemPrompt()`.
- This module must import nothing touching models or memory, so a CLI can load it.
- Test: the composed output still contains the SAFETY line and every citation rule, and
  matches today's agent instructions byte for byte.

### PR2 — The suite (four days)

```
apps/mastra/src/services/prompt-eval/
  questions.ts   the corpus (~10, mirroring seed-prompt-set.ts)
  models.ts      one shared model list
  judge.ts       calls the judge, returns per-item verdicts
  score.ts       the arithmetic and the band assignment
  compare.ts     this run vs the benchmark
  report.ts      writes summary.md + results.json
apps/mastra/src/scripts/run-prompt-eval.ts    the CLI
apps/mastra/evals/results/                    committed output
```

Questions are tagged by category — `intellectual-doubt`, `pastoral-grief`, `doctrine`,
`ethics`, `scope-refusal`, `over-refusal`. That last one is the useful trick: an on-topic
question a refusal-tuned model wrongly declines. In JesusFilm/core's run it was the
worst-scoring cluster in the whole grid.

The subject runs **without the `retrieveAnswer` tool** in v1. Adding retrieval would make
every result a joint measurement of prompt quality and RAG corpus quality, and the corpus
belongs to another repo — a red cell would be unattributable. The cost: the tool-coupled
citation rules aren't tested yet. Seed the corpus with questions that don't need
retrieval, and drop the citation items from the judge's list rather than hoping it marks
them `not-applicable` on its own.

**Models:** the two Gemma models the Seeker runs today plus one paid reference model, so
the grid shows headroom. Note the slugs in `seeker-agent.ts:122-123` carry an
`openrouter/` prefix that belongs to Mastra's router — strip it for direct API calls.
Never route a cell through `buildSeekerModelList()`; that's a fallback chain, so a
transient failure silently changes which model answered.

**Judge:** `anthropic/claude-haiku-4-5`, `temperature: 0`, never one of the models being
tested.

```bash
pnpm --filter @forge/mastra eval:prompt --label=<langfuse-label>
pnpm --filter @forge/mastra eval:prompt --label=<label> --limit=1   # wiring smoke, ~2 calls
pnpm --filter @forge/mastra eval:prompt --label=<label> --set-benchmark
```

Output goes to `apps/mastra/evals/results/<label>/<timestamp>/` — one directory per run,
never overwritten, so "did this make it worse" is a file diff. `summary.md` leads with the
question x model grid in bands, then the comparison against the benchmark, then errors,
then per-question detail including the **full answer text** and every quote. Cost printed
after the run; a 30-cell grid costs pennies.

Add one line to `apps/mastra/CLAUDE.md`:

> Any PR that changes the Seeker system prompt must paste the eval grid into its
> description.

Without that this is a script nobody runs — which is exactly how the closest prior art
(`JesusFilm/core` PR #9213) died after two months as an unmerged draft.

## Constraints

- **Never evaluate the fallback prompt.** A run that gets `source: "fallback"` stops and
  writes nothing.
- **Never let the judge decide pass/fail.** It returns per-item verdicts; your code scores.
- **Never compare across different question sets, model lists or judges.** Error instead.
- **Never put prompt text in this repo.** Results carry the hash, label and version.
  Scores, answers and judge quotes are fine — anyone can get those from the chat.
- **Never pass `production` as the eval label.** It moves on every ship, so two runs on
  different days quietly test different prompts.
- **Don't write another OpenRouter client.** Reuse `createDevotionalLlm`.
- **Don't import this from anything under `src/mastra/**`** — it must stay out of the
Mastra bundle. The eval importing `seeker-system-prompt.ts` is fine and expected.
- **Don't run it in CI.** Operator-invoked. Slow, flaky, costs money per push.

## Verification

1. `eval:prompt --label=<x> --limit=1` prints one result: the answer text, every verdict
   with its quote, latency and cost.
2. With Langfuse unreachable, a run exits non-zero and writes no files.
3. A run whose model list differs from the benchmark's refuses to compare and says why.
4. Unit test: a judge response whose verdicts disagree with any score it volunteers — the
   computed score follows the verdicts.
5. Unit test: a violation with no quote, a missing verdict, and a truncated answer each
   produce `error`, not `fail`. Plus one well-formed response that produces a real band,
   so an always-error bug can't pass.
6. `grep -rn "prompt-eval" apps/mastra/src/mastra/` returns nothing and the build passes.
7. A full run produces the question x model grid and the category rollup — which tells you
   which model falls over on which kind of question.
8. Two full runs on the same prompt: the comparison reports no regression. Then run a
   deliberately worse prompt and confirm it fails.
9. `apps/mastra/CLAUDE.md` carries the paste-the-grid line.
