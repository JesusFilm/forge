---
id: "feat-322"
title: "Seeker system-prompt eval suite (scenario × model matrix)"
owner: "jaco"
priority: "P2"
status: "not-started"
start_date: "2026-07-29"
duration: 5
depends_on:
  - "feat-296"
blocks:
  - "feat-323"
tags:
  - "ai-pipeline"
---

## Problem

We cannot tell a good Seeker system prompt from a bad one. Prompt changes ship on
impressions — someone opens Studio, asks three questions, and decides it reads better.
There is no way to answer "did that edit help?", and no way to answer "which model
handles which kind of question badly?"

forge has a mature eval system for **search**
(`apps/mastra/src/services/offline-search-eval/`, ~8.7k LOC) and nothing for **agent
answer quality**. feat-199's Resolution names the gap explicitly: _"Relevance-threshold
tuning, weak-passage decline behavior, faithfulness/groundedness evals, and the guardrail
gate are deferred."_ No follow-up ticket was ever created. This is it.

**The trap this ticket exists to avoid.** The obvious design — hold the prompt constant,
vary the model, score each answer — **cannot measure the prompt**. Every number is a joint
`prompt × model × judge` measurement with zero degrees of freedom on the axis of interest.
Edit the prompt, re-run, see the grid move 0.05, and that is indistinguishable from model
drift, OpenRouter routing changes, judge drift, or single-sample noise. A measuring
instrument that produces confident meaningless numbers is worse than no instrument,
because the numbers get acted on.

The full architecture, the alternatives considered, and the reasoning behind every
decision are in
**`docs/plans/2026-07-28-002-feat-seeker-prompt-eval-suite-plan.md`**. Read it first —
this ticket is the build brief, that document is the _why_.

## Entry Points — Read These First

1. **`docs/plans/2026-07-28-002-feat-seeker-prompt-eval-suite-plan.md`** — the architecture.
   Decisions D1–D13, the rejected-alternatives table, and the known limits. Everything
   below assumes you have read it.

2. **`apps/mastra/src/mastra/agents/seeker-agent.ts:187-215`** — the subject under test.
   Note that `instructions:` is an **unexported array literal inside the `new Agent({...})`
   call**, and that the module at load evaluates `buildSeekerModelList()` (L216) and
   `getAiChatMemory()` (L224). Importing this module to read a string stands up a memory
   store. Step 1 below fixes that.

3. **`apps/mastra/src/services/devotional/safety-gate.ts:155-175`** — the house pattern for
   an absolute-rubric LLM gate. Per-dimension thresholds, and the gate decided **in code,
   not by the model** ("Code — not the model alone — decides"). Copy this shape.

4. **`apps/mastra/src/services/devotional/llm.ts:70`** — `createDevotionalLlm`, the
   generalized OpenRouter JSON client (retry/backoff, typed errors, byte-capped reads via
   `bounded-response.ts`). **Seven hand-rolled OpenRouter clients already exist in
   production code here (five in `apps/mastra`, two in `apps/admin`). Do not write an
   eighth** for the judge — reuse this one.

   **Known gap you must close:** `createDevotionalLlm` returns parsed JSON only. It does
   not surface `finishReason`, token usage, latency, or the served provider, and it has no
   `provider` / `allow_fallbacks` request fields. The **judge** can use it as-is. The
   **subject** cannot — it needs all four (D7 and D9 depend on them). Either extend
   `devotional/llm.ts` with an opt-in text-mode return carrying those fields, or lift a
   shared `src/services/openrouter-json-llm.ts` that both callers use. Extending is
   preferred; adding an eighth client is not.

5. **`apps/mastra/src/services/offline-search-eval/seed-prompt-set.ts:18-32`** — the
   `seedPrompt({...})` corpus helper and the `readonly SeedPromptCase[]` export. The
   scenario corpus mirrors this exactly.

6. **`apps/mastra/src/services/offline-search-eval/runner.ts:52-54, 660-678`** — the
   `costFor()` token/USD reporting shape. Reuse it.

7. **`apps/mastra/src/services/offline-search-eval/artifacts.ts:59-67`** — the failure
   taxonomy that separates `judge-failure` from a real loss. The `error` bucket in this
   ticket follows it.

8. **`apps/mastra/src/scripts/run-content-embedding-search-eval.ts`** — the tsx CLI
   precedent (273 LOC). Same shape: `#!/usr/bin/env tsx`, imports from `../services/...`.

9. **`apps/mastra/src/services/langfuse-prompt-client.ts:735`** — `getManagedPrompt`.
   Returns `{ text, source: "langfuse"|"fallback", version?, resolvedLabel, stale?, reason? }`
   and **never throws**. Label pinning is supported; **exact-version pinning is not**
   (feat-272 item 4).

10. **`docs/roadmap/ai-chat/feat-272-seeker-langfuse-managed-prompt-integration.md:103-108`**
    — the composition decision that makes step 1 non-optional: the SAFETY line and
    tool-coupled citation wording stay **code-owned**; Langfuse owns **only the tunable
    persona portion**. `getManagedPrompt` returns a _fragment_, not the system prompt.

11. **`docs/roadmap/ai-chat/feat-296-langfuse-configuration.md`** — provisioning,
    `not-started` on the roadmap but **landing imminently** (another engineer is on it).
    This ticket **depends on it** — per Decision 0 the eval reads only from Langfuse, so at
    least one prompt must exist there under a label before a run can do anything. The plan
    doc's D12 originally said "do not block"; that was correct only while the in-code
    fallback was a valid eval arm, and Decision 0 removed it.

## Grep These

```bash
# The subject under test — confirm instructions are still inline and unexported
grep -n "instructions:" apps/mastra/src/mastra/agents/seeker-agent.ts

# Every existing OpenRouter client — proof you should not write another
grep -rln "openrouter.ai/api/v1/chat/completions" apps/mastra/src apps/admin/src

# The key resolver and the *_MODEL env var convention
grep -n "getOpenRouterApiKey" apps/mastra/src/config/env.ts
grep -nE "_MODEL: z\.string\(\)" apps/mastra/src/config/env.ts

# Absolute-rubric gate precedent
grep -n "Code — not the model alone — decides" apps/mastra/src/services/devotional/safety-gate.ts

# Corpus helper precedent
grep -n "function seedPrompt" -A 8 apps/mastra/src/services/offline-search-eval/seed-prompt-set.ts

# Cost reporting shape
grep -n "costFor" apps/mastra/src/services/offline-search-eval/runner.ts

# Confirm the eval is unreachable from the Mastra bundler entry (must return nothing)
grep -rn "prompt-eval" apps/mastra/src/mastra/
```

## What To Build

### Decision 0 — there are TWO system prompts, and only one of them is evaluated

**Read this before anything else. Getting it wrong produces a green run that measured the
wrong artifact.**

|             | **Fallback prompt**                                        | **Managed prompt**             |
| ----------- | ---------------------------------------------------------- | ------------------------------ |
| Where       | `SEEKER_FALLBACK_PROMPT` in code                           | Langfuse, under a label        |
| Visibility  | **Public by design** (this repo is public)                 | **Secret** — never in the repo |
| Purpose     | Offline safeguard. Used only when Langfuse is unreachable. | The real production prompt     |
| Quality bar | Good enough to stay grounded and protect the brand         | The thing we iterate on        |
| Evaluated?  | **Never**                                                  | **Always**                     |
| Leak checks | **Exempt** — it is meant to be readable                    | Subject to every guard         |
| Future      | Tweaked occasionally, never extended                       | Rewritten from the ground up   |

Langfuse v1 will be a **copy of the fallback text**. That copy _is_ evaluated — as the
managed prompt, not as the fallback. Same words today, different artifacts, and they
diverge at the first experiment. That divergence is why the managed prompt is secret.

**Consequences that are not optional:**

- The eval reads **only** from Langfuse. Both arms are Langfuse labels.
  `SEEKER_FALLBACK_PROMPT` is never an eval arm.
- If `getManagedPrompt` returns `source: "fallback"`, the run **hard-fails with a clear
  message** and writes nothing. Silently evaluating the fallback is the failure mode this
  rule exists to prevent.
- The constant is named `SEEKER_FALLBACK_PROMPT` — not `DEFAULT_`, not `SEEKER_PROMPT`.
  The name is load-bearing; a future reader must not mistake it for the real prompt.
- feat-323's leak guards **allowlist this constant and its file**. Do not "fix" a sentinel
  hit against it.

### Decisions already made — do not re-litigate these

A cold-start review of this ticket surfaced eight further points an implementer would
otherwise have had to guess at. They are settled here.

1. **The subject runs WITHOUT the `retrieveAnswer` tool in v1.** `EvalSubject.run` takes a
   system prompt and a question, and returns text. No tool loop.
   _Why:_ giving it retrieval would make every cell a joint measurement of prompt quality
   **and** RAG corpus quality — and the corpus is owned by a different repo on a different
   release cadence. A red cell would be unattributable.
   _The cost of this choice, stated plainly:_ roughly half the Seeker's instruction lines
   are tool-coupled citation rules, and **v1 does not test them.** Seed the corpus with
   scenarios that do not require retrieval, and let citation items resolve to
   `not-applicable` (the scorer already normalises by applicable items, so this does not
   distort compliance). A tool-enabled subject is the first thing `EvalSubject` exists to
   allow — it is deferred, not designed out.

2. **Swept models: three.** The two the Seeker actually runs today
   (`openrouter/google/gemma-4-31b-it:free`, `openrouter/google/gemma-4-26b-a4b-it:free` —
   see `seeker-agent.ts:122-123`), plus **one paid reference model of your choice** so the
   grid shows headroom rather than only free-tier behaviour. Any current mid-or-high tier
   OpenRouter slug is acceptable; it must **not** be the judge model (Decision 3). Confirm
   all three slugs resolve before committing the list.

   **Pricing:** `costFor()` currently prices only `anthropic/claude-haiku-4-5` and returns
   `totalUsd: null` for anything else. Either add the chosen model's per-token constants to
   that table, or accept `null` and report tokens only. Do not let an unpriced model
   silently report `$0`.

3. **Judge model: `anthropic/claude-haiku-4-5`** (the `runner.ts:52` precedent), pinned via
   `PROMPT_EVAL_JUDGE_MODEL`. It is **excluded from the swept list** — judge and subject
   must never be the same model in the same run.

4. **Band thresholds ship as explicit placeholders**, because the real ones come from a
   measurement that cannot run until the suite exists. Ship
   `pass ≥ 0.8`, `borderline 0.6–0.8`, `fail < 0.6`, with a comment marking them
   provisional. Verification 6 replaces them with the measured dead band and records both
   the number and the run that set it.

5. **The import ban is one-directional.** Nothing under `src/mastra/**` may import the
   eval. The eval **may** import `seeker-system-prompt.ts` — that module is a leaf with no
   model or memory imports, which is the entire reason PR1 extracts it.

6. **The LLM client:** judge reuses `createDevotionalLlm`; the subject needs the extended
   text-mode return described in Entry Point 4.

7. **`apps/mastra/evals/results/` is committed**, one directory per run (see the reporter
   section). Comparison is a file diff between two run directories. Results contain scores,
   answers, and hashes — **never prompt text**.

8. **The `null` arm is a CLI flag** (`--arm=null`), run occasionally for the
   construct-validity check in Verification 7, not on every run. It is expressed as
   `buildSeekerSystemPrompt("")` — the persona half empty, the code-owned SAFETY and
   citation rules still present.

9. **There is no production output cap to match.** An earlier draft said to set
   `PROMPT_EVAL_MAX_TOKENS` to "production's cap" — but the Seeker agent and its routes set
   no `maxOutputTokens` / `max_tokens` anywhere. So: set an explicit, generous eval cap as
   a **runaway guard only** (it should almost never bind), record `finishReason` on every
   cell, and treat `finishReason: "length"` as `error`. Verbosity bias is instead controlled
   by two things already in the design — rubric items that name behaviours rather than
   phrases, and the within-cell prompt delta, which puts identical length pressure on both
   arms. If production later adds a cap, match it here and say so in `summary.md`.

### The two PRs

PR1 is small and unblocks PR2.

### PR1 — Extract the Seeker system prompt (≈0.5 day)

New module `apps/mastra/src/mastra/agents/seeker-system-prompt.ts`:

```ts
/**
 * PUBLIC BY DESIGN. This is the offline safeguard, used only when Langfuse is
 * unreachable. It is NOT the production prompt and it is NEVER evaluated —
 * see feat-322 Decision 0. Exempt from prompt-leak checks (feat-323).
 * Keep it good enough to stay grounded and protect the brand; do not extend it.
 */
export const SEEKER_FALLBACK_PROMPT: string

/** Composes the effective Seeker system prompt. The agent and the eval suite
 *  MUST both call this — a second copy of this text anywhere is a drift bug.
 *  With no `managedPersona`, returns the FALLBACK composition (safeguard only). */
export function buildSeekerSystemPrompt(managedPersona?: string): string
```

- Moves the current instruction array out of the `new Agent({...})` literal into
  `SEEKER_FALLBACK_PROMPT`. **The name matters** — a future reader must not mistake it for
  the real prompt.
- `managedPersona` is the Langfuse-owned tunable half. The **code-owned** SAFETY line and
  tool-coupled citation rules are always appended, per feat-272's composition decision.
- `seeker-agent.ts` calls it: `instructions: buildSeekerSystemPrompt()`.
- The module must import **nothing** that touches models or memory, so a CLI can import it
  without standing up a store. This is the whole point of the extraction.
- Tests: the composed output still contains the SAFETY line and every citation rule; and
  the fallback composition is byte-identical to today's agent instructions.

### PR2 — The eval suite (≈4 days)

**`apps/mastra/src/services/prompt-eval/types.ts`**

```ts
export type EvalScenario = {
  id: string
  category:
    | "intellectual-doubt"
    | "pastoral-grief"
    | "doctrine"
    | "ethics"
    | "scope-refusal"
    | "over-refusal"
  question: string
  mustDo: readonly string[]
  mustNot: readonly string[]
}

/** The one reusability seam. v1 ships a single implementation. */
export type EvalSubject = {
  id: string
  run: (systemPrompt: string, question: string) => Promise<SubjectAnswer>
}

export type SubjectAnswer = {
  text: string
  finishReason: string
  servedProvider?: string // OpenRouter may route a slug across providers
  inputTokens: number
  outputTokens: number
  latencyMs: number
}

export type ItemVerdict = {
  item: string
  verdict: "satisfied" | "violated" | "not-applicable"
  quote: string | null
}

export type CellOutcome = "pass" | "borderline" | "fail" | "error"
```

**`apps/mastra/src/services/prompt-eval/scenarios.ts`** — the corpus, mirroring
`seedPrompt({...})`. Seed with ~10 scenarios, at least one per category. Include the
`over-refusal` pair (an on-topic question that a refusal-tuned model wrongly declines) —
in core's committed run that cluster was the worst-scoring in the entire matrix.

**Rubric authoring rule:** every `mustDo` / `mustNot` item names a **behaviour**, never a
**phrase**. An item written from one model's remembered output measures "sounds like
model A", not quality.

**`apps/mastra/src/services/prompt-eval/models.ts`** — one shared model list (Decision 2).
No per-scenario override. Every entry pins `allow_fallbacks: false` and a `provider.order`
so OpenRouter cannot silently route a slug to a different provider or quantisation between
runs.

⚠️ **`allow_fallbacks` / `provider.order` have zero precedent in this repo** — every
existing client omits them. Verify the field names and nesting against current OpenRouter
API docs before relying on them, and assert in the report that the **served** provider
matches the pinned one rather than assuming the request was honoured.

**`apps/mastra/src/services/prompt-eval/judge.ts`** — reuses `createDevotionalLlm`'s shape.

- The judge sees **the system prompt under test**, the question, the answer, and the two
  rubric lists.
- It returns **per-item verdicts**, never a holistic score:
  `{ items: ItemVerdict[], safetyViolations: {kind, quote}[] }`.
- `safetyViolations` draws from a **closed enumerated list** (denies bodily resurrection;
  salvation by works; self-harm content without referral; fabricated citation). Each
  requires a quoted span — **no quote, no violation**.
- Pinned dated judge slug via `PROMPT_EVAL_JUDGE_MODEL`, `temperature: 0`. The judge is
  **never** one of the swept models.

**`apps/mastra/src/services/prompt-eval/score.ts`** — the gate, in code:

```ts
compliance = satisfied / applicable // computed here, never by the model
```

- `violated` with no quote → `error`.
- Any **missing** item verdict → `error` (judges silently skip ~4% of items in batches).
- `finishReason === "length"` → `error`, not `fail`.
- Band assignment from the measured dead band (see Verification).
- `error` cells are **excluded from the denominator** and reported separately.

**`apps/mastra/src/services/prompt-eval/report.ts`** — writes
`apps/mastra/evals/results/<experimentId>/<ISO-timestamp>/summary.md` + `results.json` in a
single pass. **One directory per run — never overwritten.** `experimentId` defaults to
`adhoc` when `--experiment` is not passed.

Comparing "did this edit make it worse" must be a plain file diff between two run
directories, not git archaeology on an overwritten file. feat-323 builds the experiment
workflow on top of this layout, so getting it right here avoids a retrofit.

**`results.json` must never contain prompt text** — only `sha256`, `label`, `version`, and
`source`. See Decision 0 and feat-323's leak guards.

`summary.md` contains, in order:

1. Header: prompt `sha256`, `source` (`langfuse` | `fallback`), `version`, judge slug,
   temperature, dead-band definition and the run that set it, total cost, total wall-clock.
2. **Scenario × model grid in bands** (`pass` / `borderline` / `fail`) — the paste-ready
   table. **No decimal rankings.**
3. Category × model rollup.
4. Prompt-arm delta: within-cell `candidate − baseline`.
5. `error` section, separate and itemised.
6. Per-cell detail: the **full answer text**, every item verdict with its quote, latency,
   cost.

**`apps/mastra/src/scripts/run-prompt-eval.ts`** — the CLI.

```bash
pnpm --filter @forge/mastra eval:prompt
pnpm --filter @forge/mastra eval:prompt -- --scenario=<id>
pnpm --filter @forge/mastra eval:prompt -- --model=<key>
pnpm --filter @forge/mastra eval:prompt -- --limit=1        # wiring smoke, ~2 calls
pnpm --filter @forge/mastra eval:prompt -- --repeat=5       # variance measurement
```

- Fetches the prompt **once per run** (not per cell) and hashes it.
- Runs at least two prompt arms: `baseline` (in-code) and, when Langfuse is provisioned,
  `candidate` (a non-prod label). The within-cell delta is the prompt signal.
- Small concurrency cap; one progress line per completed cell.
- Prints cost **after** the run. No spend gate — a 30-cell grid costs pennies.

**Env vars** — all `.optional()` or `.default()`, never required-at-load:

| Var                       | Default                      | Purpose                                               |
| ------------------------- | ---------------------------- | ----------------------------------------------------- |
| `PROMPT_EVAL_JUDGE_MODEL` | `anthropic/claude-haiku-4-5` | judge model (Decision 3)                              |
| `PROMPT_EVAL_LABEL`       | unset                        | Langfuse non-prod label for the `candidate` arm       |
| `PROMPT_EVAL_MAX_TOKENS`  | a generous runaway guard     | subject output cap (Decision 9 — production has none) |

Key resolution reuses `getOpenRouterApiKey()` (`OPENROUTER_API_PAID_KEY ?? OPENROUTER_API_KEY`).

**`apps/mastra/CLAUDE.md`** — add a "Seeker prompt eval" section with the run recipe, the
setup (one key, one command — no Docker, no local model, no corpus build), the
`MASTRA_SKIP_DOTENV=true` gotcha for inline env overrides, and **the adoption rule**:

> Any PR that changes the Seeker system prompt must paste the eval grid into its PR
> description.

That one line is what makes this get used. Without it, this is a script nobody invokes —
which is exactly how the prior art (`JesusFilm/core` PR #9213) died after two months.

## Constraints

- **Do not hold the prompt constant.** A run with one prompt arm cannot measure the
  prompt. This is the ticket's central requirement, not a nice-to-have.
- **Do not score a fallback chain.** Never drive a cell through `buildSeekerModelList()` —
  it returns 2–3 entries and Mastra advances on any thrown error, so a transient free-tier
  failure silently changes which model produced the answer.
- **Do not let the judge decide pass/fail.** It returns per-item verdicts; the runner
  computes the score. Comparing a number the model invented is still the model's gate.
- **Do not add a second 0–1 "soundness" axis.** It is not orthogonal to compliance here
  (same string, same capability) and has no reference text, so the judge's denominational
  prior becomes ground truth. Enumerated violation flags with mandatory quotes instead.
- **Do not build a persona judge panel.** Proven to converge on one base model — zero
  escalations across four consecutive jesusfilm-rag slices.
- **Do not write an eighth OpenRouter client.** Seven already exist in production code.
  Reuse or extend `createDevotionalLlm`.
- **Do not add a YAML dependency.** Zero YAML parsers are declared in any manifest here.
- **Do not use the Langfuse `production` label.** It is reassigned on every ship, so two
  runs on different days silently exercise different prompts.
- **Do not import the eval from anything under `src/mastra/**`.** The Mastra bundler roots
at `src/mastra/index.ts`; safety is unreachability from that entry. The ban is
**one-directional** — the eval importing `seeker-system-prompt.ts` is expected and fine
  (Decision 5).
- **Do not put this in `packages/`.** It needs `apps/mastra/src/config/env.ts`, and the
  cross-app import ban means a package home buys no reach.
- **Do not run this in CI.** Operator-invoked only. Slow, flaky, costs money per push.
- **Do not commit per-cell artifact files.** One `summary.md`, one `results.json`,
  overwritten. Baseline is git history.
- **Do not evaluate the fallback prompt, ever** (Decision 0). Both arms are Langfuse
  labels. A run that reads `source: "fallback"` hard-fails and writes nothing.
- **Do not commit prompt text or a prompt diff** to this repo — it is public. Scores,
  answers, judge quotes, and hashes are fine; the prompt is not.
- **Do not overwrite results.** One directory per run.

## Verification

1. **Wiring smoke.** `pnpm --filter @forge/mastra eval:prompt -- --limit=1` completes and
   prints one cell showing: the full answer text, every item verdict with its quote,
   latency, and cost.

1b. **Fallback hard-fail.** With `LANGFUSE_BASE_URL` unset, a run **exits non-zero** with a
message naming the cause, and writes no result files. A green run in this state is the
bug Decision 0 exists to prevent.

1c. **No prompt text on disk.** `grep -rn "$(head -c 40 <<< "$SEEKER_PROMPT_FIRST_LINE")"
   apps/mastra/evals/results/` returns nothing after a full run. Results carry `sha256`,
`label`, `version`, `source` — never the text.

2. **Prompt-drift guard.** `grep -rn "You help people who are exploring Christianity"
apps/mastra/src` returns exactly **two** hits and no more:
   - `src/mastra/agents/seeker-system-prompt.ts` — the single source of truth.
   - `src/services/langfuse-prompt-client.test.ts:~1509` — a **pre-existing, deliberate,
     comment-documented byte-for-byte fixture**. Leave it; feat-272 item 2 already
     schedules re-pinning it to the composed shape.

   A **third** hit is a drift bug. (Do not "fix" this check by deleting the fixture — that
   is someone else's ticket.)

3. **Bundler isolation.** `grep -rn "prompt-eval" apps/mastra/src/mastra/` returns nothing,
   and `pnpm --filter @forge/mastra build` succeeds.

4. **Gate is in code.** A unit test feeds a judge response whose item verdicts contradict
   any holistic claim, and asserts the runner's computed `compliance` follows the item
   verdicts.

5. **Error taxonomy.** Unit tests assert that each of these yields `error`, not `fail`:
   a `violated` verdict with `quote: null`; a response missing a verdict for a rubric item;
   `finishReason: "length"`.

6. **Dead band measured.** `--repeat=5` over ~3 scenarios × 3 models is run **once**; the
   observed spread sets the band, and both the number and its provenance appear in
   `summary.md`.

7. **Construct validity — the run that decides whether any of this means anything.**
   Run the `null` arm (persona half emptied) over the full scenario set on one model.
   If `compliance(null) ≈ compliance(baseline)`, the prompt is inert and the suite is
   measuring model priors, not prompt quality. **Record the result in `summary.md`
   either way.** Roughly 10 calls.

8. **Full run produces the two views that answer the original question**: a scenario ×
   model grid in bands, and a category × model rollup showing which model falls over on
   which kind of question.

9. **Adoption rule landed.** `apps/mastra/CLAUDE.md` carries the paste-the-grid
   requirement.

10. **Falsify the safety check.** After run 1, if safety-flag incidence is ~0 across the
    whole grid, the check is decorative — simplify it and record that decision. A guard
    that never fires is latency, not oversight.
