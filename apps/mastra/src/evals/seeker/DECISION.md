# Seeker chat eval suite — decision doc

> **Experiment workflow decision — 2026-08-10.** Git is the authoritative
> ledger for every completed experiment, irrespective of outcome. An experiment
> declares one causal axis and resolves managed prompts to immutable versions;
> movable labels are intake and operational markers only. Production remains
> pinned to an exact reviewed version and hash. Experiment evidence and the
> later production/benchmark promotion must be separate changes; an alerting
> `production`-label mismatch never changes traffic or blocks deployment.

> **Status note — 2026-08-17.** feat-296 and feat-272 shipped on 2026-07-29.
> The ENTIRE seeker instruction set is managed in Langfuse as ONE prompt,
> `seeker-system`; code keeps a separately reviewed full outage fallback. The
> managed production pin and fallback each have their own immutable hash, so a
> reviewed managed promotion does not copy managed prompt text into Git. This
> explicitly supersedes the prototype's composition-split proposal. The eval
> resolves that one prompt through the agent's production helper, stamps its
> source/label/version and whole-text hash, and pins every cell to that exact
> resolved text. Eval-owned section tags are analysis over the whole prompt,
> never runtime composition. The judge design was also amended: per-criterion binary
> verdicts + free-text reasoning (no quote-evidence verification), with the run
> score derived in code as a weighted pass rate over verdicts; (3) the production
> `:free` model fix (section 6) has NOT landed yet. The build plan is being
> re-cut into smaller learning-sized chunks; section 7's PR A/B/C remains the
> content map.

## Terms used throughout

- **The seeker agent** is the chat agent in `apps/mastra/src/mastra/agents/seeker-agent.ts` that answers questions from curious non-Christians. It has one tool today, `retrieveAnswer`, which asks a separate search service for trusted, biblically grounded text passages; the agent then writes its answer from those passages. That retrieve-then-write pattern is what "RAG" (retrieval-augmented generation) means.
- **Grounded / grounding** — an answer is grounded when every claim or citation in it can be traced back to a passage the retrieval service actually returned; an answer is ungrounded when it states something the source passages didn't support (including scripture cited from memory instead of from a retrieved passage).
- **A fixture** is a saved, committed copy of real data that gets replayed identically on every run. Here it is a file of real passages the retrieval service actually returned, stamped with a fingerprint (a hash, `4909d1b97c9b`) so two runs can prove they saw identical data.
- **An eval** is a test suite for AI behavior: a set of questions, a way to produce answers, and a way to score them.
- **The LLM judge** is a second AI model (`anthropic/claude-haiku-4.5` — note the dot; the dashed spelling used elsewhere in the repo does not exist on OpenRouter) that grades each answer with per-criterion binary verdicts plus required free-text reasoning. Everything mechanical — word counts, "did it only cite sources it was actually given" — is checked by plain code instead of the judge. Quote-evidence verification was dropped because the prototype measured 18–22% quote fabrication overall and mechanical criteria specifically drove 9–10 false protocol errors per run.
- **A protocol error** is malformed judge output — such as an unknown criterion, a missing verdict, a disagreeing duplicate, or empty reasoning — as opposed to a real problem with the agent's answer.
- **Langfuse** is the hosted service that stores and versions the seeker's complete system prompt outside the repo. The agent resolves the exact repository-pinned `seeker-system` version and hash; `SEEKER_SYSTEM_PROMPT_FALLBACK` is a separately reviewed full outage prompt, not a separately composed prompt portion.
- **CI** stands for continuous integration — the automated checks that run on every pull request before it can merge. "The eval is green in CI" means the eval passes as one of those automated checks.
- **A hard-fail** is a check that fails the whole run outright and blocks the change — no partial credit, no averaging into a score.
- **The baseline / delta gating**: the gate compares each run against a committed last-known-good run rather than an absolute score, because judge scores wobble slightly between runs. A checklist item that passed in the baseline and now fails is a red; a small score wiggle is not.

## 1. The decision in five lines

1. Two designs were compared: a hand-built harness that grades the model against frozen retrieval data (Approach 1, "Pinned-Fixture Report Card"), and a harness that runs the real production agent with only its retrieval service swapped for that same frozen data (Approach 2, "Real Agent, Frozen World").
2. Roughly three quarters of the work is identical either way, and most of it already exists in the prototype at `apps/mastra/src/prototypes/chat-eval/`. The judge design, the questions, the free code checks, and the run bookkeeping all carry over.
3. **Recommendation: build Approach 2 — run the real agent against a frozen world — as the gate** that must go green before any prompt or tool change ships. In parallel, land the small production model fix described in section 6; the eval's own evidence says the grounding hole is live today.
4. **The deciding fact:** the grounding defect that actually happened is only visible to a run that lets the model decide for itself whether to call the `retrieveAnswer` tool. Approach 2 makes that class of failure a first-class deterministic hard-fail (a plain-code check, so its verdict is the same on every run) in every gating run; Approach 1 relegates it to a separate probe (a small side-check that runs on its own) that must be remembered and maintained.
   The defect in question: the failover model (gemma-26b — the backup model traffic switches to when the primary model fails) skipped the `retrieveAnswer` tool on 3 of its 6 questions, and the prototype caught it only in its opt-in tool-loop mode — a run where the model itself decides whether to call the tool. The other production defect — the primary model's `:free` route (the free-of-charge variant of the model on OpenRouter) being unreachable — surfaced on the very first prompt-only run (a run where the tool's answer is handed to the model upfront, so no tool decision is involved) and does not favor either approach.
5. Approach 1's injected fast mode (a run where the tool's answer is scripted in ahead of time, so only the model's wording is being tested) is kept as a non-gating developer convenience, and its best idea — tagging every checklist item with the prompt section that owns it — is folded into the gate.
   To keep that fast mode alive, PR C ports its one runner file onto the new scoring core.

### What PR A, PR B, and PR C mean

The build plan in section 7 is three pull requests, referenced by letter throughout this doc:

- **PR A — shared scoring core.** The judge, the code checks, the questions, and the run bookkeeping that both approaches need either way. No production code changes.
- **PR B — agent factory seam.** A small production change that lets the eval construct the real agent with its retrieval service swapped out.
- **PR C — loop runner, report, gate.** The runner that drives the real agent against the frozen data, plus the report and the pass/fail gate.

When a section below says "PR A step 5" or "PR C step 2", it points at the numbered step lists in section 7.

## 2. The two approaches, plainly

### Approach 1 — Pinned-Fixture Report Card (component-first)

The harness calls the answering model directly, using its own copied HTTP client. It hands the model the complete resolved system prompt plus the question, plus a **pre-completed tool exchange**: a scripted "you already called retrieveAnswer and here is what came back" message built from the committed fixture file — this is the injected fast mode described in Section 1. The model never decides whether to call the tool — that decision would be tested separately by a cheap one-step probe that sends the prompt plus the tool definition and asserts only that the model's first move is to call `retrieveAnswer`.

Because the harness never touches the real agent code, it must carry a hand-maintained copy of the tool's contract, kept honest by a schema-diff unit test. Its design center is attribution: an **eval-owned analytical mapping** names behavioural areas (persona, tool-usage, citation-discipline, safety), tags each checklist item, and rolls failures up by area. It does not split, assemble, or fetch prompt sections. This promotes the useful analytical part of the prototype without carrying over its superseded runtime composition model.

Which of those pieces already exist in the prototype and which would be new:

| Piece                                       | Status (exists in prototype / proposed, new) | Where                                                                                                  |
| ------------------------------------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Copied HTTP client                          | Exists in prototype                          | `env.ts`, `openrouter.ts`                                                                              |
| Pre-completed tool exchange                 | Exists in prototype                          | The prototype's injected mode                                                                          |
| One-step tool-call probe                    | Proposed, new                                | The prototype has no probe mode today                                                                  |
| Hand-maintained copy of the tool's contract | Exists in prototype                          | `rag.ts` mirrors the shapes and message constants in `apps/mastra/src/mastra/tools/retrieve-answer.ts` |
| Schema-diff unit test                       | Proposed, new                                | The prototype has no test files                                                                        |
| Eval-owned section mapping                  | Proposed, new                                | Analytical tags over the one resolved prompt; never shared runtime composition                         |

### Approach 2 — Real Agent, Frozen World (full-loop)

The harness constructs the **actual production agent** — resolving the one whole prompt through the shipped feat-272 path, with the same tool code and the same tool-calling loop run by Mastra — with exactly one substitution: the retrieval service's HTTP client is replaced by a small function that serves the committed fixture passages. The substitution threads through an override point that already exists in production code: `executeRetrieveAnswer(input, { search })` in `apps/mastra/src/mastra/tools/retrieve-answer.ts` was built with an injectable search function for exactly this.

Fixtures are keyed on the **question**, not on the model's search query. The prototype showed every model rewrites the query, so query-keyed fixtures would never match. Across the ~15 tool calls observed, no model ever passed the question through verbatim, and gemma-26b made no call at all on 3 of its 6 questions. The model's actual query is recorded in the transcript as an observable instead. Each run produces a full transcript per question: the resolved prompt (with its hash and the section-mapping version — a version number for the file that says which prompt line belongs to which named section, detailed in Section 7), every tool call with its arguments and served passages, and the final answer. Requires one small production change: refactor `seeker-agent.ts` to export `buildSeekerAgent(overrides?)`, with the production singleton becoming `buildSeekerAgent()` unchanged. Proposed home: `apps/mastra/src/evals/seeker/`.

The genuine fork between them is one file: Approach 1's `run-answers.ts` (harness-owned model calls, scripted exchange) versus Approach 2's `run-loop.ts` (real agent, injected search). Everything downstream — checks, judge, report, gate — is the same design.

## 3. Where the two approaches agree — build this either way

This section matters for the decision: because the shared foundation is most of the build, choosing wrong is recoverable. If the full loop proved too flaky, retreating to injected mode loses one runner file, not the suite.

Both approaches, independently, specify:

- **Judge mode A with three proven fixes.** Per-criterion pass/fail verdicts (the prototype's head-to-head winner; the dimension-scores alternative — this is what the document elsewhere calls "judge mode B" — rewarded verbosity, failed a correct refusal at 0.70, and squeezed 15 of 17 answers into a 0.88–0.94 band that cannot show a regression). The fixes the prototype proved necessary but never built: evidence gets a type (`quote`, `whole-answer`, or `absence` — the old "every violation needs a quote" rule manufactured 9–10 false errors per run on whole-answer properties like length); a fabricated quote voids the verdict instead of counting as evidence; and mechanical checks (word count, prose format) move out of the judge into code.
- **Grounding checked by code, not the judge — in two tiers, because the checks are not equally proven.** The core is a plain list-membership check: things the answer cites must appear in the passages it was served. Tier one, hard-fail from day one: URLs and source names — the URL check has a measured 0-false-positive record across 31 citations, and the prototype's `citableSources()` already returns the source-name set too, but only `urls` is consumed today (`run-report.ts:111`; see `sample-run/FINDINGS-RUN-3-RETRIEVAL.md` "Still open"). Tier two, report-only in week one: scripture references — these must be extracted and normalized from free text on both sides (book aliases like "1 Cor" vs "1 Corinthians", verse ranges, references embedded in passage prose), and a noisy parser in the hard-fail lane is exactly how gates become flaky theater. It gets promoted to hard-fail only after validation (see PR A step 5). The judge's equivalent checklist item passed 17 of 17 answers that cited scripture from memory, which is why this belongs in code at all.
- **The same question corpus**, extended from 6 to ~10–12, each criterion tagged with the behavioural prompt area it probes.
- **Run identity and refuse-to-compare.** Every run stamps the resolved whole-prompt hash plus its source, Langfuse label/version when served, the eval-owned section-mapping version, question set, fixture fingerprint, judge rubric hash, model list, and sample id; `identityMismatch()` refuses incompatible comparisons. There are no per-section prompt versions because feat-272 deliberately manages one prompt.
- **File between steps.** Answers (or transcripts) are the expensive paid artifact; the judge re-runs against the cached file for cents (~$0.02–0.25, 1–3 minutes), so rubric iteration is nearly free.
- **Delta gating against a committed baseline** under `apps/mastra/evals/results/`, with hard-fails reserved for deterministic breaks (ungrounded citation, tool never called, safety violations) and judge-score drops routed to nightly triage — the industry-consensus recipe for keeping paid, slightly-noisy gates from becoming flaky theater.
- **Tiered cadence**: free deterministic tests on every PR; the paid run only on PRs that touch the agent, tool, or eval (path filter); a fuller multi-sample sweep nightly.
- **Spend hygiene**: only the dedicated `CHAT_EVAL_OPENROUTER_API_KEY` (fetched by `scripts/fetch-chat-eval-key.sh`); production keys refused; paid model variants, never `:free` ones (which returned rate-limit errors on 6 of 6 attempts). One warning: this guarantee is not free under Approach 2. The prototype enforces it inside its own copied HTTP client, but Mastra's model router reads `OPENROUTER_API_KEY` straight from the process environment — so the loop runner must re-establish the invariant explicitly, or it will bill whatever key happens to be in `.env.local`. PR C step 2 does exactly that.
- **Langfuse readiness**: fetch the ONE managed `seeker-system` prompt through `getManagedPrompt()`, pin its exact resolved text across the run, stamp source/label/version and whole-text hash into run identity, and use the eval before label promotion. No section registry or section-fetch path is required.

## 4. Scores against the five bar criteria

"The bar" is the set of five pre-declared criteria the maintainer set for judging the two approaches — the five tests each design has to clear, listed in the table's left column.

In row 5 below, attribution is analytical: checklist tags identify the behavioural area most likely involved, but the managed artifact and rollback unit remain the whole prompt.

| Bar criterion                    | Approach 1: Pinned-Fixture                                                                  | Approach 2: Real Agent, Frozen World                                            |
| -------------------------------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| 1. Catches grounding regressions | Strong on prompt wording; tool-skipping caught only by a separate probe                     | Strong on wording AND tool-skipping, in one run                                 |
| 2. Cheap enough to run routinely | ~$0.10–0.50 and 5–10 min per gated PR; ~$1.50 nightly                                       | ~$0.10–0.50 and 5–10 min per gated PR; ~$1.00–1.50 nightly                      |
| 3. Survives the roadmap          | Good until tools interleave; each new tool needs a scripted exchange plus a contract mirror | Best fit; each new tool needs one fixture file; router eval is a dataset column |
| 4. Works with Langfuse prompts   | Possible only by injecting the one resolved prompt through a parallel harness path          | Native, via the agent's own whole-prompt fetch path and provenance stamp        |
| 5. Failures point somewhere      | Good: analytical section tags over the whole prompt                                         | Good: the same tags; attribution is explicitly heuristic                        |

**Criterion 1 — one concrete bad change each would catch.** Approach 1: a PR softens "Cite only sources returned by retrieveAnswer" to "Prefer sources returned by retrieveAnswer". The prototype measured scripture cited from memory at 8 of 18 answers without retrieval discipline versus 3 of 18 with it. The softened line pushes the rate back up. In week one that surfaces two ways: the report-only scripture-reference check flags it, and the judge's citation-discipline criterion flips against the baseline. Once the scripture check is validated and promoted (PR A step 5's follow-up milestone), it becomes a deterministic hard-fail, joining the URL and source-name checks that hard-fail from day one. Approach 2 catches that same change the same way. It also catches a class Approach 1 only reaches through its separate probe: a prompt reordering that causes the model to stop calling `retrieveAnswer` on grief and suffering questions. That is not hypothetical. Production's failover model (gemma-26b) does it today on 3 of 6 questions, observed in the prototype's tool-loop run, meaning roughly half its answers may be ungrounded while the prompt claims otherwise. In the full loop, "tool never called on a factual question" is a deterministic hard-fail in the main run. In Approach 1 it is invisible to the main run by construction (the tool exchange is pre-completed) and depends on the probe firing.

**Criterion 2 — cost.** Both anchor on the prototype's paid actuals: $0.10, $0.14, and $0.13 for full 18-cell runs including judging, about $0.008 per answer all-in. The full loop adds one extra model call per question (the tool-decision step), but Approach 1 pays a comparable extra call for its probe, so per-PR cost and wall clock converge: cents to half a dollar, minutes not hours, for both. Nightly at 10–12 questions, 2–3 models, 3 samples lands around $1.00–1.50 per night — under $45 a month worst case. Neither approach is expensive enough for cost to decide anything.

**Criterion 3 — roadmap.** This is the largest real gap. When the seeker gains a second tool, Approach 2 adds one fixture file behind the same override pattern; Approach 1 adds a fixture, a hand-written scripted exchange, and another contract mirror to keep in sync — and genuinely interleaved tool use (call tool A, reason, call tool B with A's output) cannot be faithfully pre-scripted at all. When the router and the disciple and organisation agents arrive, the router eval is the cheapest suite in the system under either approach (a gold-labeled "which agent should get this query" classification check, no judge needed), but Approach 2's harness absorbs it as a dataset column on machinery that never assumed one agent and one tool.

**Criterion 4 — Langfuse.** Both can consume the one resolved prompt, but Approach 2 resolves it through the same helper production uses and stamps whether Langfuse or the fallback served, plus the resolved label/version and text hash. A fallback run is not inherently invalid; its distinct provenance prevents it from masquerading as a Langfuse-served run. Approach 1 would need a parallel resolution/injection path with no runtime section registry to share.

**Criterion 5 — attribution.** Both approaches use the same eval-owned section tags and per-section rollups over the response criteria. Those tags are inference, not construction: there is no section version to report or independently roll back, and tags can mislead under interactions. The managed comparison and rollback unit is the complete prompt version. The prototype already showed why this honesty matters: a seeming "persona defect" disappeared when tool wording changed.

## 5. The three decision axes

### Axis A — mock tool built for the eval, or the full Mastra flow with frozen tools?

**Approach 1's position:** exercise the model-plus-prompt layer with the tool's output injected; the full flow is covered by unit tests and an opt-in nightly live mode. **Approach 2's position:** run the real agent and freeze only the outermost HTTP client. **Verdict: the full flow, frozen at the retrieval client.** Three reasons. First, the mission sentence: a change that makes answers less biblically grounded must fail the eval — and the most-proven grounding failure on record (the failover model skipping retrieval) lives in the tool-decision step, not in the prompt wording; the prototype could only observe it once its tool-loop mode existed. Second, the mirror problem: Approach 1 maintains a byte-for-byte copy of the tool contract per tool, a standing drift risk its own author flags, and the copy count doubles with every roadmap tool; Approach 2 has no mirror because there is nothing to mirror. Third, both approaches share the one real blind spot at this seam — question-keyed fixtures mean a prompt change that degrades the model's search queries shows up only as a heuristic query-drift warning, with true retrieval quality delegated to the RAG repo's own (currently nonexistent) evals. Since neither approach closes that gap, it cannot decide between them.

### Axis B — how much of the system prompt lives in Langfuse?

**Decision (owner, 2026-07-29): all of it, as one prompt.** feat-272's
original split proposal was considered and explicitly overruled before the
integration shipped. The safety line, tool-usage instructions, citation
wording, persona, and empty/unavailable handling all live together in the
single Langfuse prompt `seeker-system`. Nothing is independently composed at
runtime; `SEEKER_SYSTEM_PROMPT_FALLBACK` remains a full reviewed outage prompt
but no longer has to mirror each promoted managed version byte-for-byte.

Consequences for this eval:

- Resolve one prompt through the agent's `getManagedPrompt()` path and pin its
  exact text for the complete run.
- Stamp one Langfuse label/version plus the whole-text hash. Never invent
  per-section versions or fetches.
- Keep `prompt-sections.ts` only as eval-owned analytical tagging. It does not
  compose production instructions and is not shared with the agent.
- Evaluate a candidate whole-prompt version before moving its label. A label
  move can change every line—including safety—and bypasses PR/CI; the eval is
  a review mechanism, not a technical enforcement control.
- Managed promotions do not rewrite the compiled fallback. The exact managed
  version/hash and the reviewed fallback hash are pinned independently; an
  intentional fallback revision remains a normal code-reviewed change.

### Axis C — score the whole response, or per prompt section?

Both approaches agree here, and the evidence is decisive: **generate whole answers with the one complete resolved prompt; score per checklist item; tag every item with the behavioural area it probes.** Grading a section in isolation would measure a prompt no user ever sees, and the prototype proved instruction areas interact. Attribution therefore comes from heuristic tags and report rollups; confirmation comes from comparing complete prompt versions. True per-section evals are rejected: they multiply cost, freeze artificial boundaries, and can score green while the whole prompt regresses.

## 6. Recommendation

**Build Approach 2 — Real Agent, Frozen World — as the gate.** This is a single recommendation, not a blend: the thing that goes red and blocks a change is the full loop, full stop.

Reasoning, ranked:

1. **It makes the failure that actually happened impossible to miss.** The eval exists so that a change making answers less grounded cannot ship. The clearest ungrounding event on record — the failover model skipping the retrieval tool on 3 of its 6 questions — is only visible to a run where the model decides for itself whether to call the tool; the prototype caught it in its opt-in tool-loop mode, not in any prompt-only run. Approach 2 makes that class a first-class deterministic hard-fail in every gating run; Approach 1 relegates it to a separate probe that someone must remember to run and keep in sync. When the two designs disagree about what to make structurally impossible to miss, the mission sentence decides.
2. **It is the design that survives the roadmap without rewrites.** More tools mean more fixtures, not more mirrors and scripted exchanges; the router eval is a dataset column; new agents are new question sets on the same machinery.
3. **The costs are equal and the attribution gap is closable.** Per-run cost and wall clock are within noise of each other. Approach 1's genuine edge — failures pointing at a prompt section — is carried over via section-tagged criteria, per-section rollups, and the ablation flag, at the price of "by inference" instead of "by construction". That price is acceptable because the prototype showed even constructed per-section labels lie under section interactions.
4. **The retreat path is cheap.** Because the scoring core is approach-agnostic, if the loop proves too noisy to gate on (the judge-repeatability milestone in PR A step 8 has a defined pass/fail line for exactly this), swapping the runner back to injected mode is a one-file change, not a rebuild.

**Do in parallel, not after: fix the production model list.** The eval's own evidence says dogfood users (the team's own internal/early testers using the live product) may be receiving ungrounded answers today — the primary model's `:free` route errors, traffic fails over to gemma-26b, and gemma-26b skips retrieval on half its questions. This is the exact harm the eval exists to prevent, and it does not need the eval to fix. File and land a small production PR alongside PR A: switch the seeker model list in `apps/mastra/src/mastra/agents/seeker-agent.ts:121-123` from the `:free` Gemma variants to the paid variants (or reorder the chain) — roughly an afternoon including the seeker-agent tests. The baseline policy in PR C step 6 depends on whether this lands first, and is spelled out there.

Two carve-outs, so this is not indecision dressed as a hybrid: the prototype's **injected mode is kept as a non-gating developer tool** for fast prompt-wording iteration — but "kept" requires one concrete act, because PR A's changes to the scoring core (evidence types, judge hardening, new run identity) break the prototype's types, leaving it dead code or a maintenance fork. So PR C ports the prototype's `run-answers.ts` onto the new core (one file, a few hours) and then deletes `src/prototypes/chat-eval/` entirely. And the **first thing built is the shared scoring core**, because it is required under either approach and de-risks the choice.

Honest residual weaknesses of the winner, stated flat: it touches production code once (the factory seam, which needs the repo's call-site source-pin test discipline so a one-line revert cannot silently restore the old wiring); single-sample loop runs wobble, so delta gating and the 3-sample nightly are load-bearing, not decoration; query-quality regressions still pass through the frozen-fixture seam; multi-turn conversations (the seeker has persistent memory) are not exercised in version 1; and the judge has never been validated against human labels — closing that is a required milestone below, not an assumption.

## 7. First-week build plan (ready to paste into a GitHub issue)

All paths relative to repo root `/Users/jacobusbrink/Jaxs/projects/forge`. Three pull requests, in order, plus the parallel production model PR from section 6. One-time setup: `bash scripts/fetch-chat-eval-key.sh` writes `CHAT_EVAL_OPENROUTER_API_KEY` to `apps/mastra/.env.local`.

**Prompt analysis in week one — what exists and what does not.** Production resolves one complete `seeker-system` prompt; it has no independently managed or composed sections. Week one therefore uses an **eval-owned mapping** in `prompt-sections.ts` that tags each fallback instruction line with an informal behavioural area (persona, tool-usage, citation-discipline, safety). A drift test keeps that fallback mapping reviewed, while run identity separately stamps the exact resolved whole-prompt hash and Langfuse provenance. No per-section prompt versions or shared registry will arrive: feat-272 explicitly rejected that model. PR B touches `seeker-agent.ts` for the factory seam only; it does not restructure prompt ownership.

**PR A — shared scoring core (days 1–2, no production code changes)**

1. Create `apps/mastra/src/evals/seeker/` (outside `src/mastra/**` so it can never enter the Mastra runtime bundle).
2. Copy from `apps/mastra/src/prototypes/chat-eval/`: `fixtures/rag-fixtures.json` (the paid-for real passages, fingerprint `4909d1b97c9b`, topK 5 — meaning the search service returns the 5 most relevant passages it finds), `questions.ts`, `types.ts`, `run-judge.ts`, `run-report.ts`, `capture-rag.ts`, `models.ts`, `env.ts`, `openrouter.ts`.
3. Apply the proven fixes: delete judge mode B entirely; add the evidence type (`quote | whole-answer | absence`); enforce quote fidelity (fabricated quote voids the verdict into a protocol error); add judge protocol hardening (reject duplicate or unknown verdicts, require a reason for `not-applicable`); add run-level `validity: complete | incomplete | invalid`; reinstate the byte cap (a hard limit on how much response data gets read into memory at once, so one bad response can't crash the process) on the copied HTTP client (repo law); extend run identity with judge rubric hash, decoding parameters (the settings — like temperature — that control how random or deterministic the model's wording is), `sampleId`, the whole-prompt hash, and the section-mapping version.
4. New `checks.ts`, with the grounding check split into two tiers. **Hard-fail lane (proven):** URL and source-name list-membership — `citableSources()` already returns both sets; wire in the `names` half, which today is never consumed (only `urls` is checked, `run-report.ts:111`). Plus word count, prose format, tool-called, empty-path behavior. **Report-only lane (unproven):** scripture-reference membership — extraction and normalization from free text on both sides is genuinely hard (book aliases, verse ranges, references inside passage prose), and a noisy parser must not sit in the lane reserved for deterministic breaks.
5. New `prompt-sections.ts`: the eval-owned line-to-section mapping described above, plus its drift test. Named follow-up milestone (week two or later): validate the scripture-reference check against the committed run-3 corpus — the 3 of 18 answers that cited scripture WITH retrieval are the natural test cases — and promote it to the hard-fail lane only when it produces zero false reds there.
6. Extend `questions.ts` from 6 to ~10 questions; add `promptSections` tags (from `prompt-sections.ts`) to every criterion. No crisis question yet (the crisis guardrail does not exist; adding the question would only confirm a known gap).
7. Package scripts in `apps/mastra/package.json`: `eval:seeker:judge`, `eval:seeker:report`, `eval:seeker:capture-rag`.
8. **Verify cheaply against known data:** from `apps/mastra/`, run `pnpm eval:seeker:judge` against the committed `src/prototypes/chat-eval/sample-run/answers-injected.json` (cents, minutes). Then the judge-repeatability milestone, with a decidable pass/fail line: run the judge **three times** on that identical committed answers file (~$0.06–0.75 total) and diff — **pass** if under 5% of per-criterion verdicts flip across the three runs AND zero flips occur on the criteria the gate hard-fails on; **fail** is the documented trigger for tightening the rubric or falling back to code-check-only gating. Nothing gates until this passes. (This is the prototype's "Still unmeasured" item in `sample-run/FINDINGS-RUN-2.md`.) Also hand-write 2–3 deliberately bad answers (invented citation, shaming tone) and confirm the checks and judge actually flag them.

**PR B — agent factory seam (day 3, small, production-touching)**

1. `apps/mastra/src/mastra/agents/seeker-agent.ts`: export `buildSeekerAgent(overrides?: { ragSearch?; models?; memory? })`; the production singleton becomes `buildSeekerAgent()` with byte-identical default behavior. The seam needs two exports, not one: `executeRetrieveAnswer(input, { search })` is already injectable, but the tool registration is a module-level `createTool(...)` that closes over the default client and accepts no injection (`retrieve-answer.ts:172-179`). So also export `buildRetrieveAnswerTool(options?: { search? })` from `retrieve-answer.ts` (production's `retrieveAnswerTool` becomes `buildRetrieveAnswerTool()`), and have `buildSeekerAgent` construct the tool through it when `ragSearch` is supplied — otherwise the override is unreachable.
2. Re-pin `seeker-agent.test.ts` (it asserts instruction sentences verbatim).
3. Add the call-site source-pin tests the repo's testing discipline requires for injectable seams (feat-283 precedent): a test proving the production call site passes no overrides, plus an anti-vacuous positive companion (a second test that deliberately passes an override, to prove the first test would actually catch a real regression instead of passing by default).
4. Run `pnpm test` in `apps/mastra/` and confirm green with zero behavior change.

**PR C — loop runner, report, gate (days 4–5)**

1. `fixture-rag.ts`: wraps `rag-fixtures.json` as a search function keyed on the question; records the model's actual query verbatim in the transcript; flags queries with near-zero keyword overlap with the question (the query-drift heuristic).
2. **Key hygiene in `run-loop.ts`, before the agent is constructed.** The prototype's dedicated-key guarantee (commit `0cf4c8be`) lives inside its own copied HTTP client and does NOT carry over here: Mastra's model router reads `OPENROUTER_API_KEY` straight from the process environment (documented in `apps/mastra/CLAUDE.md`), and `apps/mastra/.env.local` commonly holds the dev/prod key right next to the eval key. So: (a) require `CHAT_EVAL_OPENROUTER_API_KEY` and exit before any model call if absent; (b) refuse to run if `OPENROUTER_API_PAID_KEY` is set; (c) overwrite `process.env.OPENROUTER_API_KEY` with the eval key in-process before Mastra's provider initializes — or pass explicit provider-bound model instances in the `models` override so the key never comes from ambient env. Add a unit test that pins the key source, mirroring the prototype's fails-before-spending behavior.
3. `run-loop.ts` proper: resolves the one managed prompt once through `getManagedPrompt`, then drives `buildSeekerAgent({ ragSearch, models: claude-sonnet-5, memory: in-memory, instructions: resolvedPrompt.text })` per question so every cell uses exactly the text stamped in identity; writes `transcripts.json` with the prompt hash/source/label/version, section-mapping version, every tool call with arguments and served passages, final text, finish reason, usage, cost, latency, and sample id. Script: `eval:seeker:loop`.
4. `run-report.ts` additions: trajectory columns (tool called? query drift? passages used?), per-section rollup (via `prompt-sections.ts` tags), validity.
5. `run-gate.ts` (`eval:seeker:gate`): delta comparison against the committed baseline in `apps/mastra/evals/results/`; hard-fail only on deterministic breaks (ungrounded citation by URL or source name, tool never called on a factual question, safety criterion); judge-score regressions beyond tolerance are reported for triage, not hard-failed. `identityMismatch()` refuses cross-identity comparisons.
6. First full run: 10 questions, 2 paid models, 1 sample (~$0.20–0.50, ~10 minutes). Commit the baseline. **Baseline policy for gemma-26b's tool-skipping, decided by whether the parallel production model PR (section 6) landed first:** if it did, the baseline records zero tool-skip known-fails and the hard-fail check applies uniformly to every model; if it did not, pin gemma-26b's tool-skips per-question as known-fails **with an expiry condition** — the pins are removed the moment the production model config changes — so the exemption cannot silently outlive the defect it excuses.
7. **Prove the gate can catch a bad change before trusting it:** locally soften the citation-discipline line, rerun, and confirm the gate goes red on the grounding check. If it does not, the suite is not done.
8. Port the prototype's `run-answers.ts` onto the new scoring core as `eval:seeker:answers` (the non-gating injected fast mode), move `sample-run/` reference data into `apps/mastra/src/evals/seeker/reference-runs/` (PR A step 8 and the scripture-validation milestone depend on it), then delete `apps/mastra/src/prototypes/chat-eval/`. A few hours; if the week runs tight, this is the one step that can slip to week two — nothing gates on it.
9. Update the feat-322 ticket file proposed in PR #1773 (`docs/roadmap/ai-chat/feat-322-seeker-prompt-eval-suite.md`) to match this decision before merging it.

CI wiring (path-filtered GitHub Actions job on `apps/mastra/src/mastra/agents/seeker*`, `apps/mastra/src/mastra/tools/retrieve-answer*`, `apps/mastra/src/evals/seeker/**`, plus a nightly 3-sample cron) is week two, and depends on Question 1 below.

## 8. Two questions only the maintainer can answer

1. **May the eval spend money in CI?** Putting `CHAT_EVAL_OPENROUTER_API_KEY` into GitHub Actions secrets lets path-filtered PRs run the paid gate automatically (~$0.10–0.50 per triggered run, roughly $5–15/month plus ~$30–45/month nightly). The prototype was deliberately operator-run only. If the answer is no, the gate stays a documented pre-merge operator step until Langfuse label promotion gives it a natural automated home — the build plan is unchanged either way, but the CI wiring PR is.
2. **Should the full-mirror fallback decision ever be reopened?** **Resolved 2026-08-17:** yes. The owner accepted managed-prompt promotion without preserving particular managed wording in the compiled fallback. The fallback remains complete and reviewed, but its hash is independent from the exact managed production pin.

**Decisions flagged rather than assumed:** (a) the production model fix is now an active recommendation (section 6), not a neutral flag — the maintainer's remaining call is only whether it may land this week ahead of the eval work, which flips PR C's baseline policy as written in step 6; (b) the repo-wide dashed judge slug (`anthropic/claude-haiku-4-5` in `SEARCH_EVAL_JUDGE_MODEL` and `EVAL_QUERY_GENERATION_MODEL` defaults) is a separate bug worth its own small ticket; (c) the crisis question enters the corpus only when the crisis guardrail ships.

Next action: read PR A's step list above, then confirm or veto the two questions and the parallel model-fix PR — everything else can start immediately.

## Addendum — 2026-08-04: four gate-policy decisions (post-review)

Recorded after the eval-suite code review (ce-code-review 20260804-104418)
resolved its four decision-gate items. These are the governing semantics
where they conflict with §3/§7 above; the history above is left unchanged.

1. **Tool skips (#5): any skip = red; a skipping baseline = refused.** The
   pooled rule ("red only when a clean baseline gains a skip") is replaced:
   ANY tool skip in the current gating run is an unconditional deterministic
   red, and a baseline containing any skip REFUSES (exit 2) with
   "re-capture a clean baseline; a skipping run is not a valid known-good".
   The measured pooled counts on the unchanged system (3, 2, 3, 3, 4, 6, 5,
   5, 4) falsified every magnitude threshold, so the policy is zero on both
   sides. §7 step 6's per-question known-fail pin option is retired.
   Infra-failed cells (`ok: false`) are never skips (review finding #1).

2. **Grounding flips (#7): confirmation rerun.** A grounding-class verdict
   flip on a changed prompt is red ONLY when the same (question, model,
   criterion) flip reproduces in a second independent judged run passed via
   `--confirm-judged=<judged.json>`. Flips with no confirm run REFUSE
   (nonzero exit — fail-safe for CI) with a rerun instruction; flips that do
   not reproduce surface as `unconfirmedGroundingFlips` — noise, never red,
   never dropped. Rationale: byte-identical-prompt reruns measured ~1 flip
   of pure sampling noise per run, so red-on-one-flip breeds
   rerun-until-green.

3. **CLI helpers (#9): consolidated.** `flag()`, `csv()`, and the ONE
   fail-closed `loadFixtures` (absent / corrupt / wrong-kind distinguished,
   always throws) live in `cli.ts`, imported by all seven entrypoints; the
   per-file copies — including run-report's last swallow-to-null variant —
   are deleted. The mode-"none" proceed-without-fixtures lane lives at the
   pure APIs (`evaluateGate`'s nullable input; `runRequiresFixtures`), never
   in the loader.

4. **Decoding (#14): the gating loop is unpinned.** `run-loop.ts` no longer
   sets temperature/max-tokens — gating runs sample provider defaults
   exactly like production, and stamp `decoding: null` in run identity.
   Null-vs-pinned is a refusal dimension (different sampling
   distributions). The injected fast mode keeps its `ANSWER_DECODING` pin
   (developer loop only; §5's ANSWER_DECODING note now applies to that mode
   alone).

**Consequence — the committed baseline is invalid by policy.** The baseline
at `apps/mastra/evals/results/seeker-baseline` carries 3 tool skips (refused
under decision 1) and was generated at the pinned 0.7/1600 decoding
(incomparable under decision 4). Decision 1's clean-baseline requirement and
decision 4's provider-default requirement land on the SAME single future
paid run: first land the §6 production skip fix, then ONE
re-capture/rebaseline at provider defaults replaces the committed baseline.
Until then every gate run against it refuses — by design, not by accident.

---

## Addendum — 2026-08-06: Sonnet-only answering set; valid baseline minted

- **Answering-model registry** (`models.ts`): `anthropic/claude-sonnet-5`
  only — the eval measures the flagship model the chat surface is
  standardizing on. The judge stays `anthropic/claude-haiku-4.5`; the
  answering-vs-judge separation is unchanged. `eval:seeker:loop` and
  `eval:seeker:answers` both default to the full registry (one seam;
  `run-loop.ts` no longer carries its own default list), and `--models`
  remains the ad-hoc override.
- **The committed baseline is valid again.** One provider-default capture
  (loop → judge → score, 2026-08-06, ~$0.29) replaced
  `apps/mastra/evals/results/seeker-baseline`: 10/10 cells, zero tool
  skips, zero infra failures, runScore 1.000 (pass). Both refusal grounds
  the addendum above recorded against the old baseline (baseline tool
  skips, pinned decoding) are cleared; minting required no production
  precondition.
- **Measured single-sample noise on the new model** (gate smoke,
  2026-08-06): an independent second sample against this baseline exited
  RED on one NEW ungrounded source name (`q-trinity`, a re-titled source),
  with zero tool skips and score delta −0.0135 (inside tolerance). At one
  sample per cell the deterministic citation hard-fail lane will
  occasionally red on an unchanged system; the multi-sample cadence
  (Question 3 above) is where that sensitivity gets addressed.
