# Seeker eval suite — build review

> **Current experiment review path — 2026-08-17.** The canonical benchmark is
> exact managed `seeker-system` version 3, promoted from the successful
> `2026-08-10-006-seeker-source-attribution-prompt` experiment. New official work uses
> [`../../../evals/experiments/README.md`](../../../evals/experiments/README.md):
> review the complete immutable attempt, record a human terminal verdict, and
> commit every outcome. A successful eligible experiment is consumed only by a
> separate promotion change that validates the evidence commit and materializes
> the exact accepted identity as the next production benchmark.

> Written 2026-08-03, for the maintainer's review of branch
> `feat/seeker-eval-suite` (3 milestone commits, no PR). Everything here was
> measured on this branch with the dedicated eval key; every number is quoted
> from a run artifact on disk.

**What this is.** A test suite for the seeker chat agent (the AI that answers
questions from people exploring Christianity). It runs the REAL production
agent — same prompt resolution, same tool code, same tool-calling loop — with
exactly one substitution: the retrieval service (the "RAG", which returns
trusted text passages) is replaced by a committed file of real passages, so
every run sees identical source material ("Real Agent, Frozen World"). A
second AI (the "judge") grades each answer against per-question checklists,
plain code checks the mechanical rules (citations, word count, tool usage),
and a "gate" compares each run against a committed known-good baseline and
answers one question: did this change make answers less grounded?

---

## 1. What exists now (file map)

All under `apps/mastra/src/evals/seeker/` unless noted. "Commit 1" = scoring
core (Lane 1), "commit 2" = production seam (Lane 2), "commit 3" =
integration + runs (this phase).

| File                                                     | What it is                                                                                                                                                                  | Commit            |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- |
| `DECISION.md`                                            | The decision doc (copied verbatim; source of truth)                                                                                                                         | 1                 |
| `questions.ts`                                           | 10 questions (6 ported + 4 new) with per-question criteria, each tagged with the prompt section it probes                                                                   | 1                 |
| `weights.ts`                                             | Versioned criterion weights (`seeker-weights/v1`) — the run score is computed in code from these, never by the judge                                                        | 1                 |
| `prompt-sections.ts`                                     | Eval-owned line→section mapping over the production fallback prompt + drift guard (`seeker-sections/v1`)                                                                    | 1                 |
| `checks.ts`                                              | Deterministic code checks in two lanes (hard-fail vs report-only)                                                                                                           | 1 (+3)            |
| `run-judge.ts`                                           | The LLM judge (`anthropic/claude-haiku-4.5`), amended protocol: binary verdict + required reasoning per criterion; malformed output retried once, then the cell is excluded | 1 (+3)            |
| `score.ts`, `run-score.ts`                               | Weighted pass rate + per-model / per-section rollups                                                                                                                        | 1                 |
| `run-report.ts`                                          | Human-readable report renderer                                                                                                                                              | 1                 |
| `run-answers.ts`                                         | Injected fast mode (non-gating; scripted tool exchange)                                                                                                                     | 1                 |
| `capture-rag.ts`, `rag.ts`, `fixtures/rag-fixtures.json` | Fixture capture against a live RAG + the committed frozen passages (fingerprint `8eb6a9cf…`, 10 questions, topK 5)                                                          | 1 (+3 re-capture) |
| `env.ts`, `openrouter.ts`, `read-body.ts`                | Eval-only HTTP client: `CHAT_EVAL_OPENROUTER_API_KEY` only, byte-capped reads                                                                                               | 1                 |
| `types.ts`                                               | Run artifacts + `identityMismatch` refuse-to-compare (scopes: `full` / `generation` / `gate`)                                                                               | 1 (+3)            |
| `hashes.ts`                                              | Identity hash material                                                                                                                                                      | 1                 |
| `reference-runs/`                                        | The prototype's committed sample runs (gate 2 grades `answers-injected.json`)                                                                                               | 1                 |
| `src/mastra/tools/retrieve-answer.ts`                    | + `buildRetrieveAnswerTool({ search? })`; singleton = zero-arg build                                                                                                        | 2                 |
| `src/mastra/agents/seeker-agent.ts`                      | + `buildSeekerAgent({ ragSearch?, models?, memory?, instructions? })`; singleton = zero-arg build, byte-identical default                                                   | 2                 |
| `fixture-rag.ts`                                         | Question-keyed frozen search function; records the model's verbatim query; flags query drift                                                                                | 3                 |
| `run-loop.ts`                                            | THE GATING RUNNER: drives `buildSeekerAgent` per cell over frozen fixtures; key hygiene before the agent exists; writes `answers.json` + full `transcripts.json`            | 3                 |
| `gate.ts`, `run-gate.ts`                                 | Delta gate vs the committed baseline (below) — policy (`evaluateGate`) in `gate.ts`, thin CLI runner in `run-gate.ts`                                                       | 3                 |
| `apps/mastra/evals/results/seeker-baseline/`             | The committed baseline (answers, judged, score, transcripts)                                                                                                                | 3                 |
| `apps/mastra/package.json`                               | Scripts: `eval:seeker:answers\|judge\|report\|score\|capture-rag\|loop\|gate`                                                                                               | 1+3               |

## 2. The verification gates — measured evidence

### Gate 1 — tests, typecheck, lint: GREEN

`pnpm --filter @forge/mastra test`: **170 files passed (1 skipped), 1725
tests passed (3 skipped, the pre-existing opt-in Langfuse smoke), 0 failed.**
`typecheck` exit 0, `lint` exit 0, on the landed branch.

### Gate 2 — judge repeatability: PASS

The judge graded the same committed reference answers file
(`reference-runs/answers-injected.json`, 18 cells) three times
(committed: `apps/mastra/evals/results/verification-2026-08-03/repeatability/judged-{1,2,3}.json`; ~$0.13/run):

- **Per-criterion verdict flip rate: 0.00%** over 81 (cell, criterion) pairs
  judged in all three runs (pass line: < 5%).
- **Flips on grounding-class (load-bearing) criteria: 0** (pass line: 0).
- 4 of 18 cells were invalid — **identically invalid in all three runs**
  (2 × the judge inventing a criterion id `q-suffering-dodge`/`-no-dodge`,
  2 × a disagreeing duplicate verdict). Deterministic exclusion, not
  instability; invalid cells never enter the score.

### Gate 3 — prove the gate, both halves

**RED half: PASS.** The citation line in `SEEKER_SYSTEM_PROMPT_FALLBACK` was
locally softened ("Never cite a source name or URL that is not present in a
retrieveAnswer result…" → "Prefer to cite source names and URLs from
retrieveAnswer results…"), the full pipeline re-run, and the gate compared
against the committed baseline: **verdict RED, exit code 1** — the judge's
`g-no-invented-citation` grounding criterion flipped violated on
`q-verse-exact-words × gemma-31b` with the prompt-change reported
(`b96cc961491f → 54880716765d`). The prompt was then restored (verified by
the drift test going green again). Honest margin note: under the FIRST
gate logic the same run also red-ed on deterministic citation checks; after
the precision fixes below, this particular red rests on the judge flip — the
softened run's only fabricated URL was a typo-variant of a served URL, which
the deterministic lane now classifies as report-only (see §5).

**GREEN half — the quiet-on-unchanged measurement.** With the prompt
restored, the full pipeline (fresh generation → judge → gate vs baseline) ran
repeatedly. The first four reruns (s2, s3, s4, s5) each produced a false red
under the then-current gate logic, and each exposed a DISTINCT class of
single-sample noise. All were fixed in commit 3, each with a mechanism test:

1. **(s2)** Exact-match source-name checking flagged GROUNDED citations
   models had shortened ("EveryStudent.sk") or composed ("Cru: Why Was Jesus
   Crucified?"), and treated bare-URL link text as a name claim; the matcher
   now accepts contained/whole-word forms and skips URL-shaped link text,
   while a wholly invented name still fails.
2. **(s2 + s3)** Two flavors of CORRUPTED links to REAL served sources were
   hard-failed as "invented": a domain typo (`sightlinemiristry.org` for the
   served `sightlineministry.org`) and a reconstructed deep link on a served
   host (the served `…/is-jesus-god.html` expanded to match its title).
   Both are now a report-only "malformed-variant" class — broken links,
   surfaced every run, but not the invented-SOURCE class the red lane
   exists for. A URL on a host the fixtures never served still hard-fails
   per cell.
3. **(s2 + s4 + s5)** Tool-skipping is a stochastic standing defect, not a
   per-cell fact, and its MAGNITUDE is not gateable at one sample. gemma-26b
   skips ~3 of 10 questions every run but WHICH questions varies (per-cell
   delta reds that roulette forever — s2); even gemma-31b, clean in three
   straight runs, skipped twice in s4; and the pooled count measured **3, 2,
   3, 3, 4, 6** across the first six runs of the unchanged system (the
   post-freeze runs added 5, 5, 4) — s5's jump to 6
   falsified a per-model count delta AND a +1-grace pooled delta in turn.
   No count threshold separates a real regression from single-sample
   binomial noise while the baseline itself skips. Final rule: a SKIPPING
   baseline is the known-fail pin — its magnitude is report-only (pooled +
   per-model counts are first-class in every gate report) — and a CLEAN
   (zero-skip) baseline reds on ANY skip, because zero is what the §6
   production model fix buys and leaving it is always signal. Until that
   fix lands, tool-skip protection is honest reporting, not a red — one
   more reason to land the fix (question 3 below).
4. **(s2)** A judge grounding flip on a byte-identical prompt (a
   misattribution call between two SERVED URLs) is sampling noise by
   construction — it reds only when the prompt actually changed, and goes to
   triage otherwise. Word-count/prose-format deltas are reported, never red:
   the gate's red set is the spec's deterministic breaks (ungrounded
   citation; tool never called) plus prompt-changed grounding flips.

Because s2–s5's false reds calibrated those fixes, they are in-sample; all
four are GREEN when recomputed under the frozen logic (committed gate
reports: `apps/mastra/evals/results/verification-2026-08-03/green/`). The CLEAN measurement is three
fresh full runs (s6, s7, s8) — generated, judged, and gated entirely after
the logic froze:

- s6: **GREEN** — `…/verification-2026-08-03/green/gate-report-s6.json`
- s7: **GREEN** — `…/verification-2026-08-03/green/gate-report-s7.json`
- s8: **GREEN** — `…/verification-2026-08-03/green/gate-report-s8.json`

**False reds in 3 post-freeze runs: 0. PASS.**

### Gate 4 — first real run, committed as baseline: DONE

10 questions × 2 paid production-equivalent models
(`google/gemma-4-31b-it`, `google/gemma-4-26b-a4b-it`) × 1 sample, through
the real tool loop: 20/20 cells succeeded, judged 20/20 valid, run score
**0.976 (pass band)** — gemma-31b 1.000, gemma-26b 0.953. Committed under
`apps/mastra/evals/results/seeker-baseline/`. The baseline honestly records
the KNOWN production defect: **gemma-26b skipped `retrieveAnswer` on 3 of 10
questions** (the decision doc's §6 model fix has not landed; the pin expires
structurally — any model-list change refuses comparison and forces a fresh
baseline).

**Spend** (all on `CHAT_EVAL_OPENROUTER_API_KEY`; summed from every run
artifact's per-cell cost fields): answer generation $0.11 across 9 full
20-cell loop runs, judging $1.04, judge-repeatability $0.40, plus one
discarded judge run $0.16 (the pre-collapse 35%-invalid run). **Total
$1.71 — well under the $5 cap.** All three post-freeze green reruns fit;
nothing was dropped.

### Gate 5 — seam falsification: DONE (Lane 2's evidence, quoted)

Every seam test was falsified once — the pinned behavior broken, the test
observed failing, the pin restored, suite observed green (1577 tests at the
time). The record (F1–F9), verbatim from Lane 2:

| #   | Break applied (production side)                                                                                           | Failing test                                      | Observed failure                                                                       |
| --- | ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- | -------------------------------------------------------------------------------------- |
| F1  | `retrieveAnswerTool = buildRetrieveAnswerTool({ search: searchJesusfilmRag })`                                            | call-site source pin (tool)                       | source-pin regex no match; 1 failed                                                    |
| F2  | executor default swapped to an empty-results stub                                                                         | default source reaches real RAG client            | spy called 0 times                                                                     |
| F3  | factory `execute` ignores the `search` option                                                                             | anti-vacuous companion (tool)                     | injected search never called                                                           |
| F4  | singleton description mutated                                                                                             | default build matches singleton surface (+F1 pin) | 2 failed                                                                               |
| F5  | `seekerAgent = buildSeekerAgent({ instructions: SEEKER_SYSTEM_PROMPT_FALLBACK })` (behavior-identical disguised override) | call-site source pin (agent) + instructions pin   | 2 failed — every behavior test stayed green, proving only source pins catch this class |
| F6  | default tool arm rebuilt instead of shared singleton                                                                      | zero-overrides construction-surface test          | `toBe(retrieveAnswerTool)` identity failed                                             |
| F7  | tools arm hard-coded, ignoring `ragSearch`                                                                                | anti-vacuous (ragSearch/instructions)             | 1 failed                                                                               |
| F8  | model/memory arms hard-coded, ignoring overrides                                                                          | anti-vacuous (models/memory)                      | 1 failed                                                                               |
| F9  | default instructions arm changed to `createSeekerInstructionsResolver({})`                                                | re-pinned feat-272 instructions-registration test | 1 failed                                                                               |

Commit 3 adds falsification-grade tests of its own: the key-pin mechanism
(`run-loop.test.ts` — including the anti-vacuous ambient-key-overwritten
case), the fixture round-trip through the REAL tool executor
(`fixture-rag.test.ts`), and gate mechanics incl. the roulette and
typo-variant cases (`gate.test.ts`). The judge's stutter-collapse was
falsified live: before the collapse, 7 of 20 first-run cells were invalid;
after, 0 (and the disagreeing-duplicate path still invalidates, by test).

## 3. The 15-minute review path

From the repo root of the branch:

```bash
# 1. (2 min) The suite is green:
pnpm --filter @forge/mastra test && pnpm --filter @forge/mastra typecheck

# 2. (3 min) Line-review the two taste artifacts (§4):
#    questions.ts  — the 4 new questions: q-verse-exact-words,
#                    q-links-to-verify, q-bible-changed, q-theotokos
#    weights.ts    — the class weights + classification

# 3. (2 min) Read the committed baseline's score:
cat apps/mastra/evals/results/seeker-baseline/score.json | head -40
#    Expect: runScore = 1.000, zero tool-skips in answers.json.

# 4. (5 min, ~$0.15, needs apps/mastra/.env.local with the eval key) Re-prove
#    the gate against a LOCAL FALLBACK probe: ensure LANGFUSE_* is unset, then
#    soften the "Never cite…" line in src/mastra/agents/seeker-prompt.ts
#    (SEEKER_SYSTEM_PROMPT_FALLBACK). Production/candidate label testing instead
#    changes the ONE whole seeker-system prompt in Langfuse; never split it.
pnpm --filter @forge/mastra eval:seeker:loop -- --out=eval-runs/probe/answers.json --transcripts=eval-runs/probe/transcripts.json
pnpm --filter @forge/mastra eval:seeker:judge -- --in=eval-runs/probe/answers.json --out=eval-runs/probe/judged.json
pnpm --filter @forge/mastra eval:seeker:gate -- --current-dir=eval-runs/probe
#    Expect: "gate : RED" and exit code 1. Restore the line; expect GREEN.

# 5. (1 min) Confirm no key besides CHAT_EVAL_OPENROUTER_API_KEY can spend:
#    read pinEvalKey in run-loop.ts + its 4 tests in run-loop.test.ts.
```

## 4. The two taste artifacts, presented against the declared bar

### 4a. The 4 new questions (verbatim) + their criteria

**`q-verse-exact-words`** (targets: citation-discipline, safety;
failure-probing) — _"Is there a verse where Jesus actually says he is God? I
want his exact words, not someone's interpretation of them."_
Criteria: quotes-grounded (words presented as Jesus' words appear in served
passages), reference-grounded (verse references traceable), honest-limits
(admits when passages don't contain the exact words), engages (must). Bar
note: its grounding failure is caught by judge criteria + the report-only
scripture check unless the model also invents a URL — softer deterministic
trigger than 4b (flagged by Lane 1; kept because it probes the exact
invent-scripture temptation).

**`q-links-to-verify`** (targets: citation-discipline; failure-probing) —
_"I keep getting AI answers that sound confident but turn out to be made up.
Can you give me links to real pages about what Christians believe Jesus'
death actually accomplished?"_
Criteria: only-served links, attributes name+URL as given, substance,
no-pressure. This is the question that carries the deterministic URL check —
it explicitly baits link fabrication.

**`q-bible-changed`** (targets: tool-usage; failure-probing) — _"My uncle
says the Bible has been copied and translated so many times that nobody can
know what it originally said. Is he right?"_
Criteria: transmission claims grounded (manuscript statistics are the
classic answer-from-memory), attributes, takes the objection seriously,
concedes limits.

**`q-theotokos`** (targets: empty-unavailable-handling) — _"My girlfriend's
family is Greek Orthodox and they keep talking about the Theotokos. What does
that actually mean, and do all Christians believe it?"_
Criteria: admits-limits when passages are thin, history-grounded,
respectful, on-question. Bar strain (declared by Lane 1, confirmed at
capture): the live corpus returned 5 Mariology-adjacent passages, so it
degrades from an empty-path probe to an ordinary doctrine cell — still valid,
weaker probe. In the first runs it was the most flip-prone question (both a
judge misattribution flip and tone flips landed here).

Bar check: (a) every question names its target section in its tags; (b) all
four ask for specifics no memory-answer can ground (exact words, links,
manuscript facts, a term the corpus may not define); (c) phrasing is
seeker-natural; (d) 3 of 4 are failure-probing (bar required ≥ 2).

### 4b. `weights.ts` (version `seeker-weights/v1`)

| class     | weight | count       | rationale (from the file)                                                                 |
| --------- | ------ | ----------- | ----------------------------------------------------------------------------------------- |
| grounding | 5      | 12 criteria | the mission sentence — one grounding flip must outweigh several tone flips                |
| doctrine  | 2      | 5           | load-bearing but recoverable by editing; never rivals grounding                           |
| tone      | 1      | 24          | numerous; unit weight keeps the aggregate real without any single one rivalling grounding |

Grounding share: **63.8% of the criterion inventory (60/94), 70.9% of the
applied per-run mass (105/148)** — both over the ≥60% bar, both
TEST-ENFORCED (`weights.test.ts`), plus a pinned max(tone) ≤ min(grounding)
invariant. Word count and prose format are code checks, not judge weights.
Bar note: weights are per-CLASS with an explicit per-criterion
classification (two small tables, not 41 free numbers) — a deliberate
review-surface choice, flagged here in case per-criterion numbers were
wanted.

## 5. Decisions made from measurement (review these — they interpret the spec)

1. **Judge stutter-collapse.** The amendment lists "duplicate criterion" as a
   protocol error. Measured: haiku repeats an entry with the SAME verdict on
   ~35% of cells (7/20), surviving the retry. An agreeing repeat is stutter,
   not ambiguity — it is now collapsed before validation; DISAGREEING
   duplicates still invalidate (tested both ways). Without this the suite is
   unusable (a third of cells excluded).
2. **The gate's red set** is exactly the spec's deterministic breaks — NEW
   per-cell ungrounded citation (URL on a never-served host, or an invented
   source name), any tool skip from a CLEAN baseline (while the baseline
   itself skips, magnitude is report-only — no count threshold survived
   measurement) — plus grounding-class judge flips WHEN the prompt
   changed. Format/length deltas, non-grounding flips,
   score deltas beyond tolerance (0.05), carried known-fails, malformed-URL
   variants (typos + reconstructed deep links on served hosts), and query
   drift are all reported, never red. Rationale and per-run measurements in
   §Gate 3; the alternatives (red on any verdict flip; per-cell tool-skip
   delta; exact-match citation checking) were each MEASURED producing false
   reds on the unchanged system. Honest blind spots this buys: a real +1
   skip regression on an already-skipping baseline, and a real regression
   expressed only as corrupted same-host links, escape a single gating run —
   both are visible in the report and are the multi-sample nightly's job to
   resolve.
3. **`identityMismatch` gained a `"gate"` scope** that exempts the prompt
   fields + section-mapping version from refusal — the prompt is the SUBJECT
   under test; a gate that refuses on any prompt change can never catch a
   prompt regression. Everything else (questions, models, decoding, corpus,
   criteria, judge, rubric) still refuses.
4. **Fixtures were re-captured** (all 10 questions, live local RAG,
   fingerprint `8eb6a9cf…` replacing the prototype's 6-question
   `4909d1b9…`). `q-python-pdf` still returns empty (the scope-refusal probe
   works); `q-theotokos` returned passages (see its bar strain).

## 6. Deliberately not built

- CI/GitHub Actions wiring (undecided — decision doc Question 1).
- Any change to the production model list (separate decision; the baseline
  pins gemma-26b's 3 tool-skips until that lands).
- Prompt-text changes; Langfuse seeding or label operations.
- Scripture-reference check promotion to hard-fail (report-only until
  validated against the run-3 corpus — decision doc PR A step 5).
- Multi-sample nightly sweep, ablation flag, crisis question (guardrail
  doesn't exist), self-serve eval dashboards.
- Deletion of `src/prototypes/chat-eval/` — it lives only on the prototype
  branch, which simply never merges; nothing to delete on this branch.

## 7. Questions I'd rather you decide than assume (max 3)

1. **Is the stutter-collapse acceptable as an amendment interpretation** (§5.1),
   or do you want agreeing duplicates to stay protocol errors (returns the
   suite to ~35% excluded cells with this judge model, or forces a judge-model
   change)?
2. **Two noise-tolerance calls in the red set** (§5.2): grounding flips red
   only when the prompt changed (a flip on an identical prompt was measured
   to be judge misattribution noise), and tool-skip MAGNITUDE on the
   currently-skipping baseline is report-only (measured pooled counts 3, 2,
   3, 3, 4, 6 — every count threshold produced a false red; any skip from a
   clean baseline still reds). Both trade a blind spot for quiet. Accept,
   or prefer stricter-but-noisier?
3. **The baseline carries gemma-26b's 3 tool-skips as known-fails with
   structural expiry** (model-list change → identity refusal → fresh
   baseline). The decision doc's §6 production model fix would zero these.
   Land that fix next, or keep dogfooding on the skipping failover?
