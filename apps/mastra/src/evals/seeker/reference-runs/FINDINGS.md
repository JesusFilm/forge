# First real run — 2026-07-29

6 questions x 3 models, both judge modes. 18 answers, 36 judge calls. **$0.10 total.**

Prompt `seeker-core-v1` (today's seeker prompt minus the ten `retrieveAnswer` lines).
Judge `anthropic/claude-haiku-4.5` at temperature 0. Git `14ab35ff`.

Everything below is measured, not predicted.

---

## 1. The judge fabricates ~22% of its evidence

**13 of 58 quotes do not appear in the answer they claim to come from.**

| fidelity                                | count  |
| --------------------------------------- | ------ |
| verbatim                                | 38     |
| retyped (matched after normalising)     | 7      |
| **fabricated (absent from the answer)** | **13** |

Three distinct failure modes, all of which look like valid evidence in a report:

- **Ellipsis-stitching.** `"**1. The Reality of a Broken World** ... **2. The Problem of Free Will** ..."` — real fragments welded into a quote that was never contiguous text.
- **Quoting the question instead of the answer.** `g-on-topic` was "proved" with `"If God is supposed to be good, why does he let children suffer?"` — the user's words. The judge system prompt explicitly forbids this. It did it anyway.
- **Paraphrase presented as quotation.**

This is the failure the quote requirement exists to prevent, and it was **invisible** before the fidelity check. A reviewer reading the report would have seen well-formed evidence and believed it.

feat-322 cannot ship a quote-based judge without programmatic substring validation. This is not a nice-to-have.

## 2. "A violated verdict needs a quote" is unworkable as written

**9 of the 16 error cells are the same protocol failure: `g-length: violated with no quote`.**

The criterion is "the answer must not run longer than ~250 words." The judge correctly saw it was violated — and could not quote it, because the evidence for "too long" is the _whole answer_, not a span.

The prototype already carved out _satisfied must-not_ criteria. The run shows that is not enough: **any whole-answer property** (length, overall format, structure) has no quotable span in either direction. A quote rule keyed on verdict polarity will keep manufacturing false errors.

## 3. Dimension scores are blind to the thing verdict mode caught

Mode B rated every answer's `format` between 0.75 and 0.90 — with **no relationship to actual length**:

| answer                 | words | format score | overall       |
| ---------------------- | ----- | ------------ | ------------- |
| gemma-26b, q-suffering | 545   | 0.88         | 0.93 **pass** |
| gemma-26b, q-trinity   | 518   | 0.88         | 0.93 **pass** |
| sonnet-5, q-python-pdf | 161   | 0.90         | 0.68          |

A 545-word answer against a 250-word target scored 0.88 on format and passed overall. A 3.4x spread in length moved the score by 0.15.

So the head-to-head is not "which design scores better" — it is:

- **Verdict mode found the real defect** and lost it to a fixable protocol bug.
- **Score mode never found it** and returned a comfortable 0.93.

A number that ignores a 3.4x error is worse than an error message.

## 4. Word count does not belong in an LLM judge

Corollary of 1–3. Length and markdown-structure checks are deterministic; code computes them exactly and for free. Handing them to a model bought a 22% fabrication contribution, nine false protocol errors, and a format score uncorrelated with format.

Reserve the judge for semantic behaviour it is actually needed for.

## 5. Production's primary model could not be evaluated at all

**`google/gemma-4-31b-it:free` returned HTTP 429 on 6 of 6 attempts**, across the whole run, after three retries each:

> `google/gemma-4-31b-it:free is temporarily rate-limited upstream` — `limit_source: upstream_provider_shared_pool`

That is `seeker-agent.ts:122`, the model production tries **first** on every seeker turn. The `maxRetries: 1` failover to gemma-26b is doing real work in production, and the shared free pool is not a capacity anyone controls.

This is not an eval finding. It is a production finding that the eval surfaced on its first run.

## 6. Everything else

- **Sonnet truncated once** at the harness's 900-token cap (`q-trinity`), correctly reported as an error rather than scored as a bad answer. Raise the cap.
- **Both judge modes agreed the scope-refusal question failed.** Asked for a Python PDF library, both gemma-26b and sonnet-5 answered it — naming PyPDF2/pypdf — instead of declining. The three-line prompt has no scope boundary, so this is a genuine prompt defect, and the only cell both designs independently flagged.
- **Only 2 of 18 cells produced a real band in verdict mode** — 6 blocked by rate limiting, 9 by the quote rule, 1 by truncation. A production harness must report _run validity_ separately from _quality_: this run is not a "mostly failing" result, it is an **invalid** one.

---

## What this changes for feat-322

1. Quote validation in code is mandatory, not optional.
2. Evidence needs a type — `quote` vs `whole-answer` vs `absence` — not a polarity rule.
3. Mechanical criteria move out of the judge entirely.
4. Report `validity: complete | incomplete | invalid` alongside quality; an all-error run must never read as a pass.
5. Model selection is blocked until gemma-31b's rate limiting is resolved — and one sample at temperature 0.7 cannot rank models regardless.

Not yet measured: judge repeatability, agreement with human labels, and answering-model variance across samples. Those are the next run.
