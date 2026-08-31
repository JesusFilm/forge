# Eval approach — how we evaluate retrieval

_Design context for the golden-case eval (`eval/qa-golden.yaml`, `scripts/eval.ts`,
the `/golden` skill). **Stable intent lives here**; per-slice results live in the
slice files + `sources.md`; live status in `STATUS.md`. Written 2026-05-25 after
reviewing slice #2's per-source eval — see "Status & open questions" for what is
decided vs. still open._

## Forge migration identity

Forge retains the standalone metric formulas under the explicit implementation
identity `jesusfilm-rag/eval-metrics@2026-08-06+forge-identity-v1`. A comparison
is refused unless the canonical selected golden cases, selected case IDs,
registry, corpus revision, embedding model, query instruction, top-k, score
floor, and metric implementation all match. The two-percent gate is relative:
an exact two-percent regression passes; anything beyond it fails.

The retained 2026-08-06 control ran 416 cases. The source golden file now has 425:
the nine final `gq-*` cases were appended after that run. Therefore the historical
control is comparable only with `--case-set control-2026-08-06`, which selects the
first 416 cases while hashing their canonical content and selected ordered ID
set. Later append-only additions therefore do not invalidate the retained
control, while edits to any selected case do. A 425-case-or-later `current` run
needs its own identity-matched control and must never be compared to the 416-case
receipt.

Receipts contain identities, aggregate diagnostics, case IDs, ranks, and counts;
they exclude questions, URLs, hit text, scores, embeddings, and credentials. Case
losses use only `ranking-only`, `relevance-set-correction`,
`approved-corpus-change`, `retrieval-regression`, or `unresolved`; free-form
"explained" text cannot satisfy the gate. Production runs require the exact
`--target production-read` command and namespaced production variables.

## What the eval tests (and what it doesn't)

Retrieval is a **mechanism, not policy** (architecture §1): given a query it returns
every chunk above the `minScore` cutoff, cited; the **consumer** decides how to rank,
trim, or weight them. The eval therefore tests the mechanism's one job — **did the
relevant content come back?** — and deliberately under-weights pure ranking (which the
consumer overrides).

- **Recall / coverage are primary, and we report BOTH** (decided 2026-05-25):
  - **recall@10** — did _at least one_ relevant doc come back in top-10 (did we answer it at all);
  - **coverage** — what _fraction_ of the relevant set came back (did we surface _every_ good
    answer, e.g. 2 of 3). Coverage is the metric that notices a good answer being buried.
- **P@1 / MRR are secondary.** They measure internal ranking, which is consumer-relative;
  a correct answer at rank 4 is still a correct answer the consumer can choose. (This is
  why slice #2's cru P@1 0.20 is largely a _scoring artifact_, not a quality verdict — see
  "Correction" below.)

## The golden-case model (intended)

A golden case is a **source-agnostic question** plus the set of **all documents, across
every source, that legitimately answer it** — the _relevant set_:

```yaml
- id: holy-spirit-filling
  question: "How can I be filled with the Holy Spirit and walk in his power?"
  relevant: # any source — the question is not "owned" by one
    - "/us/en/train-and-grow/10-basic-steps/3-the-holy-spirit.html" # Cru
    - "/new-life/spirit-filled.html" # SwG
    - "/knowing-god/holy-spirit.html" # SwG
```

A hit is correct if it matches **any** path in `relevant`. (The existing matcher in
`scripts/eval.ts` already accepts a list of paths from any source — the v1 cases just
listed one, which is the whole problem.)

### Relevant sets are LIVING

Adding a source can make **new documents relevant to questions that already exist.** So
each slice's Stage 4 does two things, not one:

1. Author new questions exercising the new source.
2. **Re-review existing questions** and extend their relevant sets with any newly-ingested
   docs that now legitimately answer them.

A question's relevant set is never "finished" — it grows with the corpus. The `/golden`
survey step must re-scan prior questions against the new source, not only draft fresh ones.

## Parameters

- **top-k = 10 per question** (decided 2026-05-25). Generous enough to reflect "return the
  above-cutoff set; the consumer trims," without unbounded output.
- **minScore = 0.37** (architecture FOLLOW-UP A; re-confirm per slice via the whole-corpus run).
- **Engine default `topK` stays 5** (decided 2026-05-25) — a stable architecture default, overridable
  per call via `RetrievalPolicy.topK`. Only the _eval_ runs at 10; the engine is not changed.
- Retrieval is **whole-corpus** in eval (never source-scoped) — cross-source competition is
  the realistic condition we want to measure. Both sources returning for one question is the
  expected, healthy case (verified 2026-05-25: e.g. a Holy-Spirit query returns SwG
  `spirit-filled` #1 and Cru Step 3 #4, both above cutoff).

## Per-source view

**Kept (decided 2026-05-25)** — it's the clearest signal of "did a newly-added source's content
actually become findable, or did it get buried?", i.e. whether the RAG needs adjustment. Under
the multi-relevant model it is **derived from the relevant docs' sources**, not from a case being
"owned" by a source: for questions whose relevant set includes a doc from source X, how often does
an X doc appear in the returned set (X's coverage). That keeps the burial signal without pretending
one source owns a shared question.

### ⚠️ Per-source numbers carry top-k BOUNDARY JITTER — do not read them as exact (slice #9)

A per-source coverage/recall figure at small `n` can move between runs **with no
change to the corpus, the model, or the engine**. The mechanism is mundane and
worth knowing before you chase a phantom regression:

Slice #9 saw `everystudent` read **0.818** in one run and **0.773** in another
(n=22 — one case's worth). It was traced to a single credited doc,
`everystudent/forum/contradictions.html`, sitting at **rank 10, score 0.648, with
rank 11 at 0.647**. A **0.001** gap at the exact top-10 cutoff, flipped by
last-bit differences in the query embedding between sessions. Both eval modes were
individually reproducible (whole-corpus 4/5 twice; `--source` 5/5 twice), so this
is _not_ HNSW nondeterminism and _not_ a retrieval fault — it is a doc balanced on
the `topK` knife-edge.

Practical rules:

- **Before attributing a per-source move to a new source, check whether any Arabic
  /new-source doc actually appears in the results at all.** If none do, the move
  cannot be displacement.
- At n≈20, one boundary doc is worth **~0.045** of per-source recall. Treat moves
  of that order as noise unless a per-case diff names the case.
- Diff **per-case** (`rank` + `cov=x/y`), not aggregates — that is what localises
  it in one step.

**Shipped (slice #2, v1 — `scripts/eval.ts`, `scripts/eval-metrics.ts`):** a `source` tag per
case + `pnpm eval --source <key>` + a per-source breakdown. It groups _metrics by
authored-source_ and lists _single-source_ expected docs — which distorts shared-topic
questions (the cru P@1 artifact). Useful as a first cut; superseded by the model above.

**The reframe — IMPLEMENTED 2026-05-25 (commit `8fbee09`):**

1. Cases re-authored as source-agnostic questions with multi-source `relevant` maps (operator-curated);
   per-case `source` tag dropped; `cru-seeker-finances` reframed → `cru-stewardship`.
2. Reports **recall@3 / recall@10 / coverage** (fraction of the relevant set returned); P@1/MRR secondary.
3. Eval runs **top-10**; engine default `topK=5` unchanged.
4. **Per-source coverage** view, derived from the relevant docs' sources.

**Decided 2026-05-25** (the three formerly-open questions, now built):

- **(a)** Report **both** recall@10 and coverage.
- **(c)** **Keep** the per-source coverage view (per source) — it shows whether the RAG needs
  adjustment as the corpus grows.
- **(d)** **Leave** the engine default `topK=5`; change eval methodology only.

**v2 baseline (whole-corpus, 20 cases / 2 sources, 2026-05-25):** recall@3 **0.95** · recall@10
**1.00** · coverage **0.896** · MRR 0.881 · P@1 0.80. Per-source coverage: cru-10-basic-steps
recall 0.929 / coverage 0.929 (n=14); starting-with-god recall 1.000 / coverage 0.906 (n=18).

## Two traps when authoring a relevant set (slice #7)

**1. Never build a relevant set from what the engine returned — coverage becomes a
tautology.** It is tempting to author a new case by running the question, then crediting
the good hits. But `coverage` exists to detect **a good answer being buried**; if the
relevant set contains only what came back, coverage is 1.0 _by construction_ and can
never detect anything. The set must be built from the **corpus** (what legitimately
answers), then the engine's output is checked _against_ it. In slice #7 the first pass
did this backwards; backfilling the buried answers moved honest coverage from a fake
1.0 to a real **0.45–1.00** per case. Deep-k probing (`--top-k 40+`) and a keyword sweep
of the corpus are how you find the buried ones.

**2. Judge the DOCUMENT, not the chunk.** The relevant set credits **document identities**
(`returnedRelevant` matches the citation's source key and pathname), so relevance must be
judged on the whole document. Slice #7's first judging pass showed reviewers only
**chunk 0** — and cru
articles routinely open with a long lead-in anecdote, so 75% of the docs it rejected as
"off-question" had >2 chunks with their actual answer further in. Judging the wrong unit
manufactured a rejection list that had to be thrown away and re-run.

**3. `coverage` is structurally capped at `min(1, k/|relevant|)` — a case with more than
`k` relevant docs is scored against an unreachable 1.0 (slice #10).** Retrieval returns at
most `k` documents (the eval runs `k=10`), so a case crediting 20 documents can never score
above **0.50** no matter how perfectly the engine ranks. Slice #10's re-review took
`tlfr-skeptic-dieu-existe` to 20 credited docs — `everystudent-fr` genuinely publishes ~15
separate arguments for God's existence — and it scores ~0.45, meaning **9 of its 10 top-10
slots are credited docs**. That is near-ceiling performance which raw coverage reports as
"bad", and it drags the per-language mean down with it.

Two consequences. **(a) A falling coverage number after a re-review is expected, not a
regression** — crediting genuinely-relevant buried documents is what makes it fall, and
detecting buried answers is the whole point of the metric (trap 1 above is the alternative,
and it is worse). Read `rank`, recall@3 and P@1 alongside it: slice #10's re-review dropped
`fr` coverage while moving four of ten cases to rank 1 and lifting `fr` P@1 from ~0.60 to
~0.90. **(b) When a case's relevant set exceeds `k`, report the ceiling-normalised figure
(`coverage ÷ min(1, k/|relevant|)`) beside the raw one** — slice #10's ten French cases read
~0.68 raw and ~0.72 ceiling-normalised. Do not "fix" this by trimming honest relevant sets
back under `k`; that reintroduces trap 1.

## LLM-as-judge curation: score relevance and soundness as SEPARATE axes (slice #7)

Slice #7 replaced the hand pass with a **3-lens judge panel** (theologian / pastor /
mature Christian) gating every proposed credit. **The load-bearing design choice is that
relevance and biblical soundness are ORTHOGONAL and must never be blended into one score.**

**73 of 151 proposed credits were biblically SOUND but OFF-QUESTION** — orthodox,
well-written documents answering a question nobody asked. A soundness-only rubric would
have auto-accepted every one of them (mean soundness 0.89) straight into the answer keys
and quietly corrupted the eval. That pairing — _high soundness, low relevance_ — is the
tripwire the panel exists to catch; report it as its own count, never folded into a
generic fail.

Two honest caveats, both worth knowing before relying on a panel:

- **The gate must live in code, not in a model's head.** Means, thresholds, and the
  disagreement rule are arithmetic. A model deciding "that's about a 0.8" is a vibe with
  a number attached.
- **Three personas on one base model converge far more than three humans.** In slice #7
  the maximum disagreement across the whole panel was **0.25** against a 0.5 escalation
  threshold, so **zero escalations fired**. Do not read panel agreement as corroboration.
  The axis that genuinely earned its keep was **soundness**, which surfaced prosperity
  drift, a passage attributing a child's sexual abuse to Satan, and a discredited
  aetiology of same-sex attraction — none of which a relevance check could ever find
  (→ [#78](https://github.com/JesusFilm/jesusfilm-rag/issues/78)).

## Correction to the slice #2 record — RESOLVED

cru-10's v1 **P@1 0.20** (and the "SwG out-ranks cru" framing first recorded in `sources.md` /
`STATUS.md`) was **largely a scoring artifact** of v1's single-source expected sets: shared-topic
cru questions listed only the cru doc, so an equally-correct SwG answer at rank 1 scored the case
as a non-P@1 "miss." The multi-relevant reframe removed the artifact — under v2, **cru's per-source
recall is 0.929** (its content surfaces reliably when relevant). Retrieval was behaving correctly
all along; the v1 metric was measuring the wrong thing.

## Known engine ranking quirks (interpret MRR / P@1 with care)

Dense embeddings (`openai/text-embedding-3-small`) sometimes rank **abstract /
spiritual-foundation pieces above direct topic answers** for evaluatively-framed
questions. Slice #6 example: case `fl-skeptic-sex-marriage` ("Why does
Christianity insist on waiting until marriage for sex? It seems outdated.")
ranks thelife `/wise-intimacy` (0.649 — a foolishness-of-the-cross meditation,
not a why-wait answer) and sightline `/is-it-good-for-you-2` (0.588 —
carrying-past-relationships angle) above the directly-on-topic thelife
`/why-should-i-wait-for-sex` and sightline `/good-reasons-to-wait`. The case
sits at rank=4 with full coverage in top-10. **This is a model property, not
a curation error:** abstract framing scores high on cosine even when the
specific question would be better answered downstream. Implications:

- **Recall@10 is the integrity metric**; recall@3 / MRR / P@1 will dip on
  skeptic / evaluative questions where the engine prefers foundation pieces.
  A rank=4 case with full coverage is fine — recall@10 = 1.000 still proves
  the system found everything that legitimately answers.
- **Don't conclude "curate harder" from a rank=4 case** unless you'd genuinely
  credit the higher-ranked abstract pieces. The skill #5 guardrail (credit on
  content, not titles) cuts both ways: if the higher-ranked doc doesn't really
  answer the question, _leave it uncredited_ and accept the rank dip.
- **The right fix is downstream**, not in the eval: a re-ranking or prompt
  layer that biases toward direct-topic answers for evaluative questions.
  Mechanism-not-policy, again.

## Consumer-layer policies and the eval (FOLLOW-UPs E / I / L)

Three consumer-layer follow-ups are in flight: `excludedSourceKeys` (#6), the
diversity knobs `maxPerSource` / `perSourceCaps` / MMR (#15), and the source
discovery endpoint `GET /v1/sources` (L). **None of them change the golden-case
eval.** This is a deliberate consequence of the engine-stays-ranking-pure
decision (architecture §1) and worth making explicit so it doesn't get
re-argued every slice.

**Why the whole-corpus eval is unaffected:** `pnpm eval` runs every case
against the _unfiltered_ engine — no `allowedSourceKeys`, no `excludedSourceKeys`,
no `maxPerSource`, no `perSourceCaps`. It asks the integrity question: _given
the whole corpus and no consumer filter, does the most-similar search find the
docs that should answer this question?_ The consumer-layer knobs are policies
applied **after** the engine has done its job; they don't change what the
engine could return, only what a specific consumer chose to receive. Adding
the knobs doesn't invalidate any existing golden case.

**What we add instead: mechanism tests.** Each consumer-layer knob gets a small
set of integration tests in `src/retrieval/` and (where the knob is HTTP-exposed)
`src/serving/http/`, asserting the _mechanism_ works as advertised:

- _Exclusion_ — "consumer A asks to exclude source X; verify zero source-X
  results; verify other authorized sources still surface; verify excluding a
  source the consumer wasn't authorized for is a no-op (not an error)."
- _Per-source caps_ — "with `maxPerSource: 2` and a query that returns 10
  same-source hits unfiltered, verify the top-10 has at most 2 from that
  source. With `perSourceCaps: { cru: 1 }` and `maxPerSource: 3` both set,
  verify cru is capped at 1 and others at 3. With caps higher than the
  unfiltered hit count, verify caps cap, they don't pad."
- _Discovery_ — "consumer with `allowedSourceKeys = [a, b]` calls
  `GET /v1/sources`; verify only a and b are listed; verify the response
  shape; verify the doc-count and last-indexed-at fields."

These are _unit/integration tests_ in the codebase, not golden cases. A few
dozen lines per follow-up. They prove the knob does what the API claims.

**What we do NOT do: re-author golden cases to favour diversity.** It's
tempting to say "now that we have `perSourceCaps`, our golden cases should
prefer balanced top-10s." That would silently pick a side — making the engine
eval favour one consumer's policy over another's. A devotional chatbot might
want diversity; a deep-research tool might want depth from one source. Neither
preference belongs in the integrity eval. If a _specific consumer_ wants to
measure their policy's behaviour, they author their own cases against
`POST /v1/search` with their policy bound — that's the consumer's eval, not
ours.

**Practical implication for picking up E / I / L:** they're shippable
independently of any eval re-authoring. The 62-case suite stays the integrity
baseline; the new follow-ups add focused mechanism tests sitting next to the
code they exercise. Slice work and engine/consumer follow-up work don't
interleave or compete.

---

## Multilingual eval (embedder swap → qwen3-8b, #39 P4)

Adopting `qwen/qwen3-embedding-8b` ([ADR-0005](./decisions/0005-embedding-model-qwen3-8b-multilingual.md))
re-embeds the whole corpus, so eval covers two distinct concerns with two
different bars. The prod half is the repo runbook
[docs/ops/prod-reembed.md](./ops/prod-reembed.md); the local (dev-laptop) phase is driven
from the operator's out-of-repo execution tracker (kept on the laptop, not in this repo).

### English — a **drift gate** (existing 6 sources only), not an improvement target

**Scope: this no-human shortcut applies ONLY to re-embedding the existing 6 English
sources**, which already carry curated golden cases — the model swap re-scores an
_already-authored_ suite, it does not create cases.
English is the well-characterised baseline. After the re-embed, run `pnpm eval`
(whole corpus, 62 cases) and compare the primary metrics — **recall@10** and
**coverage** (per this doc's mechanism-not-ranking stance) — against the last
recorded baseline in `docs/sources.md` / the newest `eval/results-*.md`. English
is expected to **hold**, not necessarily improve. **Only a major regression
blocks**: proposed gate = recall@10 or coverage down **> 2% relative** vs
baseline. An agent may judge this autonomously by reading `sources.md` + the
prior results file for the historical numbers and the living-relevant-set /
minScore history (a small dip from a living-set artifact is not a regression —
see the `/slice` Stage-4 note). **No human-in-the-loop is needed for this gate** — it
re-scores already-curated cases, it does not author new ones.

> **A NEW English source (future work) is NOT covered by this shortcut.** It has no golden
> cases yet, so it needs the same human-in-the-loop `/golden` authoring as the non-English
> flow below — just without the translation step. The no-human path is exclusively the
> model-swap drift re-score of the _existing_ curated suite; authoring cases for any new
> source, in any language, is always human-gated.

> ### ⚠️ CORRECTED 2026-07-14 (slice #7, cru) — "one language per source key" is DEAD
>
> The section below was written when every non-English source was its own key
> (`thelife-fr`, `thelife-zh`). **ADR-0006 ("one domain = one source") ended that.**
> `cru` is a single key carrying **en + es + fr**, and it broke two things:
>
> 1. **`pnpm eval --source <key>` is NO LONGER a per-language view.** It blends a
>    multi-language source's languages into one number, so an unhealthy language can
>    hide behind a healthy one. Use the **per-language coverage breakdown**
>    (`coverageByLanguage()`, added in `08acd48`) — it groups by each case's _resolved_
>    retrieval language, mirroring `coverageBySource`.
> 2. **A case whose only relevant source is multilingual cannot derive its language.**
>    `caseLanguage()` intersects the registry `languages` of every source in `relevant`;
>    `cru` declares `["en","es","fr"]`, so a cru-only case is 3-way ambiguous → returns
>    `null` → **the case searches the whole multilingual corpus unscoped**, which is
>    exactly what this section forbids. It was live on `cru-believer-old-testament`.
>    **Every case whose `relevant` map contains only a multilingual source MUST pin
>    `language:` explicitly.** Such cases now surface under `(unscoped)` in the
>    per-language report rather than being silently dropped — that state is a
>    case-configuration bug, not a result.
> 3. **There is deliberately no "unscoped" pin — so null-language docs are
>    EXCLUDED from the eval. Settled policy, not a per-source decision.**
>    `caseLanguage()` offers scoped-or-derived only; any case whose relevant
>    sources intersect to one language runs language-filtered, and a doc whose
>    detected `language` is `null` (an honest ADR-0007 blank) can never be
>    returned by that filter (SQL three-valued logic). Crediting one bakes a
>    **permanently unreturnable expectation** into the answer keys — coverage
>    would measure the confidence gate, not retrieval.
>
>    **The rule: a null-language doc never enters a `relevant` map.** Not after a
>    sweep, not conditionally, not "unless it's important". We do not know what
>    language it is — that is the whole point of the blank — so there is no
>    language to scope a case to. Every source produces some nulls; this is
>    normal and permanent, not a backlog item.
>
>    **Nothing is lost:** the dashboard carries a per-source null count, so the
>    exclusion is visible rather than silent. **`pnpm lang:sweep` is a production
>    corrective tool** — it is not part of authoring or repairing an eval, and it
>    is never a step in a slice.
>
>    The accepted cost is real and worth naming: slice #8's `/wires/loneliness.html`
>    is null, so that case closed with zero everystudent credits. That is the
>    price of honest answer keys, not a reason to revisit. (Made a standing rule
>    2026-07-25, after it had been re-asked at every new source.)
>
> 4. **Correction 4 — the two-axis judge gate assumes a MULTI-SOURCE corpus. When
>    a language has exactly ONE source, gate answer-key entry on RELEVANCE only
>    and route soundness to a filed issue.** (slice #9, `everystudent-ar`.)
>
>    Guardrail #6 gates both relevance and biblical soundness at 0.75. That works
>    when several sources compete on a question: striking a low-soundness doc
>    leaves _other_ credited docs standing, so the gate **filters** an answer key.
>    With one source per language — and cases necessarily `language:`-scoped —
>    there is nothing left to fall back on, so the same gate **deletes** the key.
>    Measured on slice #9: both axes at 0.75 approved **6 of 52** credits and left
>    **9 of 14 cases with zero**; relevance alone approved **27 of 52** and left 2.
>
>    There is a measurement argument underneath, and it is the real reason:
>    **the eval measures retrieval.** `/a/childraped.html` scored relevance 0.91 —
>    the highest pair in that panel — on soundness 0.52. Excluding it marks the
>    engine WRONG for returning the single best-matching document in the corpus,
>    inverting what coverage means. And striking a doc from an answer key **does
>    not stop the RAG serving it**: if the concern is users receiving unsound
>    content, the remedy is corpus-level (remove or flag the document), not
>    answer-key-level. Using the key as a content filter buys no real protection
>    while blinding the metric.
>
>    So: score soundness on every pair (it earns its keep — slice #9's panel found
>    false factual claims, modalism, and suicide content with no help signposted →
>    [#123](https://github.com/JesusFilm/jesusfilm-rag/issues/123)), report the
>    mean, and **file** it. Do not let it silently empty an answer key.

### Non-English — **human-in-the-loop**, one suite per language

For each non-English source, author a suite with `/golden`
(`skills/golden/SKILL.md`) against the **qwen-embedded** corpus:

1. Survey what landed for the source; draft persona-diverse questions grounded
   in real docs. For a single-language source key, scope `relevant` to that key. For a
   **multi-language source** (`cru`), pin `language:` on the case and read the
   per-language breakdown (see the correction above).
2. **Human-in-the-loop is mandatory for taste + accuracy**, and the reviewer may
   not read the language. So the agent presents every candidate case **with an
   English translation** of the question _and_ the expected-doc chunk snippet
   (extending golden guardrail #5 across languages) — the human approves/edits/
   rejects on the translated content, never on a title.
3. Write approved cases to `eval/qa-golden.yaml`; run `pnpm eval --source <key>`.
   Primary read is **recall@10 + coverage**, with recall@3 + MRR reported as
   ranking-quality secondaries (recall@10 can saturate on a small per-language set).
   **Every non-English case written to `eval/qa-golden.yaml` MUST carry an English
   translation of its question as a YAML comment on the case (e.g. `# EN: …`), AND
   its eval evidence MUST include the retrieved results translated to English** —
   a `# RETRIEVED` comment block listing each returned doc (path + English-translated
   title), as in `eval/candidates-thelife-*.yaml`. The translations are not
   decoration — a reviewer who does not read the language can only verify that the
   _results_ answer the _question_ if both sides are in English, and future agents
   re-review the living relevant sets from them. A non-English case without its
   `# EN:` question translation and translated retrieved results is incomplete and
   must not be merged.
4. **minScore** (0.37, English-derived) may shift under qwen and across languages —
   re-derive from the new score distribution using a few non-English off-topic
   negatives per language before changing the default; report before changing.

#### Evidence tiers — added 2026-08-03 for the 45-language campaign (#111)

Step 2 above ("the reviewer may not read the language, so present an English
translation") was written when the corpus held four non-English languages. The
#111 campaign takes it to **45**, including Tigrinya, Oromo, Georgian and
Amharic, and it exposes a difference the flow had not needed to name:

**For French, the operator can tell a bad translation from a good one. For
Tigrinya, they cannot.** The approval is equally explicit in both cases — golden
guardrail #4 holds unchanged — but the _evidence behind it_ is not equally
reviewable. Averaging the two into one coverage number asserts a confidence
nobody has.

So every case may carry `evidence_tier`, and `pnpm eval` reports the buckets
separately (`coverageByTier`, `scripts/eval-metrics.ts`):

| tier             | meaning                                                                                |
| ---------------- | -------------------------------------------------------------------------------------- |
| `human-verified` | approved on content a reviewer could read, or on a translation they could sanity-check |
| `llm-translated` | approved on a machine translation nobody available can verify                          |
| _(absent)_       | authored before the tier existed — reported as `(untagged)`                            |

Three things this is **not**:

1. **Not a quality gate.** No metric is discounted, no case is excluded, no
   threshold applies. It is a reporting split, nothing more.
2. **Not a default.** The 130 pre-campaign cases are left untagged rather than
   backfilled to `human-verified` — nobody now can say which of them the
   reviewer could read unaided, and asserting it would be the same overreach the
   tier exists to prevent.
3. **Not a replacement for the `# EN:` translation.** Step 2's requirements stand
   in full; the tier records how checkable that translation was.

**Promotion is cheap and expected.** If a Cru native speaker later reviews a
language's suite, flip its cases to `human-verified` — the questions and answer
keys do not change, only the claim about who checked them.

**Operator decision, 2026-08-03** (campaign file §7): scope is decided by
_capability_, not convenience. A language is `evaluate: deferred` only for a
stated, specific reason — never as the residue of a blanket "everything else".
Since the §0.4 language sweep cleared guardrail 3a (0 nulls corpus-wide), every
campaign language is mechanically eligible, so all 45 are in scope.
