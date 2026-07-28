---
title: "Seeker System-Prompt Eval Suite — Architecture Plan"
type: feat
date: "2026-07-28"
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
product_contract_source: research-and-critique-panel
execution: code
---

# Seeker System-Prompt Eval Suite — Architecture Plan

## Goal Capsule

Give forge a way to tell a **good Seeker system prompt from a bad one**, with evidence
instead of impressions, and to see **which model falls over on which kind of question**.

Built once, reusable for the agents that come after Seeker.

This document records the architecture, the decisions, and — importantly — **what was
rejected and why**. The implementation brief is `docs/roadmap/ai-chat/feat-322-*.md`.

---

## Why this is hard (read this before designing anything)

An eval suite is a measuring instrument. A broken instrument is **worse than no
instrument**, because it produces confident numbers that get acted on. Three research
streams and a three-lens critique panel produced one dominant finding:

> **The obvious design cannot measure what it claims to measure.**

The obvious design holds the system prompt constant and varies the model. Every number
it produces is a joint `prompt × model × judge` measurement with **zero degrees of
freedom on the prompt** — the one axis we care about. Edit the prompt, re-run, see the
grid move by 0.05, and you cannot tell that from model drift, provider routing, judge
drift, or single-sample noise.

Everything below follows from taking that seriously.

---

## Research inputs

Three existing eval systems were studied. Each contributed something, and each carried a
warning.

### A. forge — `apps/mastra/src/services/offline-search-eval/` (~8.7k LOC, shipped)

The in-repo _search_ eval. Mature: pairwise LLM judge, A/B swap de-biasing, calibration
probe, release gates, an artifact store with atomic writes and Zod-on-both-sides.

- **Take:** the failure taxonomy (`artifacts.ts:59-67` separates `judge-failure` from a
  real loss), the cost-reporting shape in `runner.ts` `costFor()`, the
  dependency-injection style that makes a 972-line test suite possible with zero network.
- **Leave:** the pairwise baseline-vs-current _frame_. That is right for search (behaviour
  drifts under you) and wrong here (we want absolute rubric scoring against a fixed case
  set). Copying it would be cargo-culting.
- **Correction to an early assumption:** it is _not_ true that "absolute rubric scoring is
  greenfield in forge". `apps/mastra/src/services/devotional/safety-gate.ts` already does
  exactly this — three 0–1 dimensions, per-dimension threshold, and the gate computed **in
  code, not by the model** (`safety-gate.ts:163-171`, ambiguous → block). That file is the
  house pattern to follow.

### B. JesusFilm/core — `libs/llm-evals` (PR #9213, open draft since 2026-05-14)

The closest prior art and the direct template: scenario × model matrix, Langfuse
label-pinned prompts, LLM-judge decoupled from the model under test, results committed as
markdown.

- **Take:** the `mustDo` / `mustNot` rubric pairing. Their README states the reason
  precisely — positive criteria alone let a judge accept "technically meets the spirit";
  concrete anti-patterns force it to penalise the specific way a model fakes compliance.
  Also: the judge sees **the system prompt under test** as context, so it can score "did
  the model obey its own rules".
- **Take:** judge decoupled from the model under test — cost isolation plus apples-to-apples
  comparison. If both moved together you could not tell whether a score difference came
  from the generation or the scoring.
- **Leave:** the self-healing per-cell artifact tree. It exists there because Vitest cells
  fail independently on a long-lived branch. One `tsx` process holds every result in
  memory.
- **Warning:** that branch has been an unmerged draft for two months, with nine
  rubric-improvement proposals generated and never applied, and a PR description that
  drifted out of date within a month. ~800 LOC of runner produced ~6000 lines of committed
  output that nobody maintains. **Design against that outcome, not just against
  correctness.**

### C. JesusFilm/jesusfilm-rag — retrieval eval (130 golden cases)

Deliberately **retrieval-only**. Their own docs say answer-quality judgment "is a consumer
concern" — explicitly forge's job, not theirs. Nothing reusable mechanically; the value is
entirely in their hard-won lessons.

- **The load-bearing lesson:** a three-persona judge panel (theologian / pastor / mature
  Christian) on one base model produced **zero escalations across four consecutive
  slices** (max spread 0.20–0.35 against a 0.5 threshold). Personas on one base model
  converge. What earned its keep was **two orthogonal axes** — 73 of 151 proposed credits
  were sound-but-off-question, which a single-axis rubric would have auto-accepted.
- **"The gate must live in code, not in a model's head. A model deciding 'that's about a
  0.8' is a vibe with a number attached."**
- Judge agents **silently skip ~4% of items** in large batches → a gate must hard-fail on
  any missing verdict, never score over partial coverage.
- Diff **per-case, not aggregates** — float noise flips boundary cases and reads as a
  regression.
- Ratify the bar and the must-not-regress floor **before** spending.

---

## The design

### D1 — Location: house convention, not a new one

```
apps/mastra/src/services/prompt-eval/       ← logic AND the corpus (scenarios.ts — see D3)
apps/mastra/src/scripts/run-prompt-eval.ts  ← tsx CLI entry
apps/mastra/evals/results/                  ← output (summary.md + results.json), committed
```

This mirrors the existing pair: `src/scripts/run-content-embedding-search-eval.ts` +
`src/services/offline-search-eval/`.

**Rejected — a `packages/` home.** Every package there is a pure-TS leaf. This needs
`apps/mastra/src/config/env.ts` (boot-validated Zod) and `getOpenRouterApiKey()`
(`env.ts:1058`). Moving it out means duplicating both. Also, `apps/mastra/CLAUDE.md`
forbids importing from `apps/admin` / `manager` / `auth`, so a package home would not
buy cross-app reach anyway.

**Rejected — a new `src/evals/` directory.** A third convention for no gain.

**Note on a rejected rationale.** An early draft justified the location with
"raw `fetch` avoids the Mastra bundler trap". That reasoning is wrong and was removed.
The Mastra bundler roots at `src/mastra/index.ts`; safety comes from **unreachability from
that entry**, not from avoiding `@ai-sdk/*`. `offline-search-eval/` uses raw fetch and
_is_ bundled, because a workflow imports it. The correct statement is: nothing under
`src/mastra/**` may import the eval, and the eval's own entry is a CLI script.

### D2 — Runner: a `tsx` CLI, not Vitest

```bash
pnpm --filter @forge/mastra eval:prompt                        # full matrix
pnpm --filter @forge/mastra eval:prompt -- --scenario=<id>
pnpm --filter @forge/mastra eval:prompt -- --model=<key>
pnpm --filter @forge/mastra eval:prompt -- --limit=1           # wiring smoke, ~2 calls
```

Core used Vitest-as-runner and then had to exclude it from `nx test`. A CLI cannot
accidentally run in `pnpm test` and burn tokens on every push.

### D3 — Scenario corpus: TypeScript, not YAML

**Verdict reversed from the first draft.** Zero YAML parsers are declared in any manifest
in this monorepo — YAML would silently add a dependency. Meanwhile the repo's own eval
corpus is already TypeScript: `offline-search-eval/seed-prompt-set.ts` holds 130+ cases
through a `seedPrompt({...})` helper that stamps defaults. Mirror it.

```ts
export const SEEKER_EVAL_SCENARIOS: readonly EvalScenario[] = [
  scenario({
    id: "resurrection-doubt",
    category: "intellectual-doubt", // explicit field, not inferred from filename
    question:
      "Honestly, I struggle to believe Jesus actually rose from the dead...",
    mustDo: [
      "Opens by naming what the user is feeling, not by validating the topic's difficulty.",
      "Cites at least one scripture, and the citation resolves to a real reference.",
    ],
    mustNot: [
      "Answers a factual claim without attributing it to a retrieveAnswer passage.",
      "Ends with a generic 'let me know if you have more questions'.",
    ],
  }),
]
```

Seed categories: `intellectual-doubt`, `pastoral-grief`, `doctrine`, `ethics`,
`scope-refusal`, and `over-refusal` — the last being core's cleverest idea, a
false-positive guard that catches a model over-refusing after the refusal scenarios push
it that way. In core's committed run, `ontopic-world-cup-opener` was the worst-scoring
cluster in the whole matrix precisely because of this.

**Rubric authoring rule (from jesusfilm-rag's circularity trap):** every item names a
**behaviour**, never a **phrase**. A rubric written from one model's remembered output
measures "sounds like model A", not quality.

### D4 — The prompt is an AXIS, not a constant ⭐ the decision everything hinges on

Every run compares **at least two prompt arms** on the same scenario and the same model:

| Arm                   | What it is                                        |
| --------------------- | ------------------------------------------------- |
| `baseline`            | the current in-code composed prompt               |
| `candidate`           | the Langfuse non-prod label under test            |
| `null` _(occasional)_ | persona half emptied — a construct-validity check |

The reported prompt effect is the **within-cell difference**. That cancels model
capability, judge bias, and rubric length, because all three are identical on both sides
of the subtraction. Cost is one extra arm per cell.

The `null` arm is run rarely and answers one question: _if compliance-with-prompt ≈
compliance-with-no-prompt, the prompt is inert and the suite is measuring model priors._
It is roughly six calls and it is the only real construct-validity check in the design.

### D5 — What "the prompt under test" actually is

**This is the subtlest correctness trap in the whole design.**

`feat-272` has already decided the composition split (its What-To-Build item 2): the
SAFETY line and the tool-coupled citation wording stay **code-owned** (they are coupled to
`retrieveAnswer`'s contract), while Langfuse owns **only the tunable persona portion**.
The helper does no composition — "the composition seam lives in the agent/consumer".

So `getManagedPrompt({ name: "seeker-system" })` returns a **fragment**, not the system
prompt. An eval that scores the fragment goes green for text the agent never runs.

Compounding it: the Seeker's instructions today are an **unexported array literal inside
the `new Agent({...})` call** (`seeker-agent.ts:192-212`). Reading them means either
copy-pasting (drift by construction) or importing the module — which at load evaluates
`buildSeekerModelList()` and `getAiChatMemory()`, standing up a Postgres or in-memory
store just to read a string.

**Decision — one export fixes both.** Extract a prompt module exporting
`buildSeekerSystemPrompt()` that performs the same composition the agent performs. The
agent calls it; the eval calls it. Drift becomes structurally impossible, and the export
survives feat-272's split for free.

The eval fetches once per run and records `sha256(effectivePromptText)` in the summary
header. That hash is the only prompt identity that is valid **both** before and after
Langfuse is provisioned.

### D6 — Scoring: per-item verdicts, gate computed in code

The judge does **not** return a holistic score. It returns a verdict per rubric item:

```ts
{
  items: [
    {
      item: string,
      verdict: "satisfied" | "violated" | "not-applicable",
      quote: string | null,
    },
  ]
}
```

- `compliance = satisfied / applicable`, **computed by the runner**. This is what "the gate
  lives in code" actually requires — comparing a number the model invented is still the
  model's gate.
- A `violated` verdict with **no quoted span** → `error`, not `fail`.
- A **missing** verdict for any item → `error` (jesusfilm-rag's ~4% silent-skip lesson).
- Normalising by item count removes a real confound: otherwise a scenario with six
  `mustNot`s scores systematically lower than one with two, and the category rollup partly
  measures rubric length.
- It also kills unfalsifiable rubric items **at authoring time** — you cannot write "cites
  scripture where it strengthens the answer, not as decoration" if you must point at a span.

**Safety: a binary violation flag, not a second 0–1 axis.**

The first draft proposed `compliance ⊥ soundness` as two scored axes, importing
jesusfilm-rag's two-axis lesson. **That transplant is invalid and was rejected.** In
jesusfilm-rag the axes applied to _retrieved corpus text_ — soundness was a property of a
fixed artifact, and "sound but off-question" had a high base rate because a curated corpus
is uniformly sound. Here both scores would read the _same generated string produced by the
same instruction-following capability_, so they correlate. Worse, soundness has no
reference text, which makes the judge's own denominational prior the ground truth
(Calvinist/Arminian, complementarian/credo, and so on) — precisely the "vibe with a number
attached" the lesson warns against.

Instead: a **closed, enumerated violation list**, each requiring a quoted span — no quote,
no violation. Plus one code-side check that needs no model at all: does each scripture
reference resolve, and does the quoted text match?

**Falsifiable follow-up:** after run 1, if safety-flag incidence is ~0 across the grid, the
check is decorative and should be simplified. Record the decision either way.

### D7 — Determinism: pin everything that can move

| Risk                                                              | Control                                                                                                                                                                                                                                                                                                                                                                                     |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sampling noise                                                    | `temperature: 0` on **both** subject and judge; recorded per cell                                                                                                                                                                                                                                                                                                                           |
| OpenRouter silently routing a slug across providers/quantisations | `allow_fallbacks: false`, pinned `provider.order`, **record the served provider**                                                                                                                                                                                                                                                                                                           |
| Scoring a fallback chain instead of a model                       | never route through `buildSeekerModelList()`; each cell pins exactly one model id                                                                                                                                                                                                                                                                                                           |
| Verbosity bias — longer answers satisfy more `mustDo` items       | **Production sets no output cap** (verified: no `maxOutputTokens` on the Seeker agent or its routes), so there is nothing to match. Set a generous eval cap as a runaway guard only, record `finishReason`, and treat `"length"` → `error`, not `fail`. The real controls are behaviour-named rubric items and the within-cell delta, which applies identical length pressure to both arms. |
| Judge model drifting under you                                    | pin a dated/immutable judge slug; record it                                                                                                                                                                                                                                                                                                                                                 |

### D8 — Reading the grid: bands, not decimal rankings

A grid of decimals invites ranking, and ranking on n=1 is how a 0.72/0.68 split flips a
model choice on noise.

- Report three bands: **pass / borderline / fail**.
- Set the dead band empirically: run `--repeat=5` **once** over ~3 scenarios × 3 models,
  observe the spread, and use it. This is a one-time measurement, not per-run machinery.
- Only cells landing in the dead band get re-run at n=3 and take the median. Most cells
  stay a single call.
- `summary.md` states the band definition and the run that set it.

### D9 — Output: what an operator actually needs

- **Store the full answer text.** The first question after any red cell is "what did it
  _say_?" Omitting this was the single biggest miss in the first draft.
- Print **every judge reason and quote**. A broken judge is then obvious at a glance —
  which is why dedicated calibration fixtures are deferred rather than shipped (see
  Rejected, below).
- One `summary.md` + one `results.json` per run, written in a single pass into
  `evals/results/<experimentId>/<ISO-timestamp>/`. **One directory per run, never
  overwritten** — "did this edit make it worse" has to be a plain file diff between two run
  directories, not git archaeology on an overwritten file. No per-cell file tree in v1.
  feat-323 builds the experiment workflow on this layout.
- The primary output is a **paste-ready markdown grid** (see D10).
- Per-cell latency and per-run cost `{inputTokens, outputTokens, totalUsd, pricingModel,
estimated}`, reusing `costFor()`'s shape. **Printed after the run, not gated before it** —
  a 30-cell grid costs pennies.
- A progress line per completed cell, and a small concurrency cap. Thirty sequential
  network calls is five minutes of blank terminal otherwise.

### D10 — Adoption: the part that decides whether any of this matters

An operator-invoked script with no trigger is a script nobody invokes. That is how the
prior art died.

**One line in `apps/mastra/CLAUDE.md`: any PR touching the Seeker instructions must paste
the eval grid into its PR description.** The command emits a paste-ready markdown table as
its primary output specifically to make that cost near-zero.

That single convention converts "I could run this" into "my PR is incomplete without it".
Every other decision in this document is downstream of it.

### D11 — Reusability: exactly one seam

The claim "reusable for future agents" has to be earned, and the cheapest way to earn it
is one type:

```ts
type EvalSubject = {
  id: string
  run: (systemPrompt: string, question: string) => Promise<SubjectAnswer>
}
```

v1 ships one implementation (direct OpenRouter completion). Agent #2 behind an HTTP route
ships a second (a POST to `/forge-seeker`). Around ten lines, and it is the only
structural investment worth making before a second agent exists.

### D12 — Langfuse is a hard dependency (REVISED 2026-07-28)

**This decision was reversed.** The original text said "ship now, wire later, do not block
on feat-296", on the reasoning that the in-code prompt was a perfectly good `baseline` arm.
That reasoning died with D14 below: the in-code prompt is a **fallback safeguard**, not a
candidate for evaluation, so it cannot be an arm at all.

- Both eval arms are **Langfuse labels**. `SEEKER_FALLBACK_PROMPT` is never evaluated.
- A run that receives `source: "fallback"` **hard-fails and writes nothing**. Silently
  scoring the fallback would be a green run that measured the wrong artifact.
- feat-322 therefore `depends_on: feat-296`. The cost of the block is low — provisioning is
  landing imminently.
- **Never `production`** as an eval arm target — that label is reassigned on every ship, so
  two runs on different days silently exercise different prompts.
- Exact-version pinning does not exist yet (feat-272 item 4). The interim is: pin a
  dedicated label, and record the returned `version` **and** the text `sha256`.

### D14 — Two system prompts, one of them public, only one evaluated

|             | **Fallback prompt**                        | **Managed prompt**         |
| ----------- | ------------------------------------------ | -------------------------- |
| Where       | `SEEKER_FALLBACK_PROMPT` in code           | Langfuse, under a label    |
| Visibility  | **Public by design** — this repo is public | **Secret**                 |
| Purpose     | Offline safeguard only                     | The real production prompt |
| Evaluated?  | **Never**                                  | **Always**                 |
| Leak checks | **Exempt**                                 | Subject to every guard     |

Langfuse v1 will be a copy of the fallback text. That copy is evaluated **as the managed
prompt**. They diverge at the first experiment, and that divergence is the whole reason the
managed prompt is secret.

**Threat-model note.** `JesusFilm/forge` is public and `seeker-agent.ts` carries the full
prompt today, so the prompt is already exposed. Langfuse is what fixes that going forward —
and only for the tunable half, since feat-272 keeps the SAFETY line and citation rules in
code. Those code-owned lines are, and remain, public.

**What is safe to commit** (this repo is public, so it matters):

| Artifact                                  | Risk                                              | Commit?   |
| ----------------------------------------- | ------------------------------------------------- | --------- |
| Prompt text, or a version-to-version diff | High                                              | **Never** |
| Model answer text                         | None — anyone can get these by using the chat     | Yes       |
| Judge reasoning and quotes                | None — quotes the answer                          | Yes       |
| `mustDo` / `mustNot` rubric               | Low–medium — a test spec, not instruction wording | Yes       |
| Prompt `sha256`, label, version number    | None                                              | Yes       |

The practical rule: **commit scores, answers, verdicts and hashes; never commit prompt text
or a prompt diff.** This preserves the paste-the-grid adoption mechanism (D10), which is the
part of the design most easily broken by an over-tight secrecy rule.

### D13 — Not in CI

Both prior arts landed here independently. An LLM matrix in CI is slow, flaky, and costs
money per push. The gate is a human reading the grid before a prompt ships (D10).

---

## Rejected, and why

| Rejected                                | Why                                                                                                                                                                                                                                                                                         |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Multi-persona judge panel               | Proven to converge on one base model — zero escalations in four consecutive jesusfilm-rag slices. Cost without signal.                                                                                                                                                                      |
| `soundness` as a second 0–1 scored axis | Not orthogonal here (same string, same capability); no reference text, so the judge's denominational prior becomes ground truth. Replaced by an enumerated violation flag with mandatory quotes.                                                                                            |
| Pairwise A/B swap de-biasing            | search-eval's frame is baseline-vs-current. We need absolute rubric scoring against a fixed case set.                                                                                                                                                                                       |
| Dedicated calibration fixtures in v1    | Printing every judge reason + quote catches the same failures for free. **When they do land, make them _borderline_, not extreme** — extreme fixtures pass while the middle of the scale drifts, and the middle is where every decision is made. Add a third: fluent, confident, and wrong. |
| Self-healing per-cell artifact tree     | Core's mechanism for independently-failing Vitest cells on a long-lived branch. One process, one pass, one summary.                                                                                                                                                                         |
| `--yes` cost threshold gate             | ~30 cells ≈ pennies. Print cost after.                                                                                                                                                                                                                                                      |
| YAML + Zod corpus                       | Zero YAML parsers in any manifest; the repo's own eval corpus is TypeScript.                                                                                                                                                                                                                |
| Per-scenario model override             | Reopens the exact duplicate-model-list gap core flagged. One shared list.                                                                                                                                                                                                                   |
| An eighth hand-rolled OpenRouter client | Seven already exist (five in `apps/mastra`, two in `apps/admin`). Reuse `createDevotionalLlm`'s shape (`devotional/llm.ts:70`) or lift it to a shared module.                                                                                                                               |
| A `packages/` home                      | Needs `apps/mastra`'s env module; the cross-app import ban means it buys no reach.                                                                                                                                                                                                          |

---

## Known limits — state these in the summary, do not hide them

1. **No tool loop in v1 — roughly half the prompt is untested.** The subject runs without
   `retrieveAnswer`, so the tool-coupled citation rules (attribute every claim, never cite
   an unseen source, handle `empty` / `unavailable`) are **not exercised**. This is a
   deliberate trade: including retrieval would make every cell a joint measurement of
   prompt quality and RAG corpus quality, where the corpus is owned by another repo on
   another release cadence, and a red cell would be unattributable. Seed the corpus with
   scenarios that do not need retrieval; citation items resolve to `not-applicable` and the
   scorer normalises them out. A tool-enabled subject is exactly what the `EvalSubject`
   seam (D11) exists to allow.
2. **Single-turn only.** Production accepts conversation history. Multi-turn is deferred;
   the output-token cap (D7) is the part that could not wait.
3. **Judge variance is bounded, not eliminated.** The band discipline (D8) is the control.
4. **A cell measures `prompt × model × judge`.** The within-cell difference (D4) isolates
   the prompt; a single absolute cell score does not.
5. **`error` cells are excluded from the denominator** and reported separately — never
   silently folded into failures.

---

## Definition of Done

- `pnpm --filter @forge/mastra eval:prompt -- --limit=1` completes and prints one cell with
  its answer text, per-item verdicts, quotes, latency, and cost.
- A full run emits `summary.md` with a scenario × model grid in bands, a category rollup,
  the prompt `sha256` + `source` + `version` in the header, and a separate `error` section.
- Two prompt arms are compared in the same run and the within-cell delta is reported.
- `buildSeekerSystemPrompt()` is exported and consumed by **both** the agent and the eval;
  no copy of the instructions exists anywhere.
- `apps/mastra/CLAUDE.md` carries the paste-the-grid-in-the-PR convention.
- The dead band is measured once and recorded in `summary.md`.
