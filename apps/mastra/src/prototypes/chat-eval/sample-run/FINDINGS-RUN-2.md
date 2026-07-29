# Second run — 2026-07-29, clean data

Same 6 questions x 3 models, both judge modes. **18 of 18 answers succeeded**
(run 1 lost 6 to free-tier rate limiting). Dedicated key, paid model routing.
**$0.14 total** across answers and both judge passes.

Run 1's findings replicated on clean data, and one got substantially worse.

---

## 1. Quote fabrication replicated: 18%

**17 of 92 quotes do not appear in the answer they cite.**

|                 | run 1    | run 2        |
| --------------- | -------- | ------------ |
| quotes returned | 58       | 92           |
| fabricated      | 13 (22%) | 17 (**18%**) |

Two independent runs, different answers, same rate. This is the judge's
baseline behaviour, not a bad draw. **A quote-based judge cannot ship without
programmatic substring validation.**

## 2. One criterion causes 10 of 11 protocol errors

`g-length` again — "the answer must not exceed ~250 words". The judge sees the
violation correctly and cannot quote it, because the evidence for "too long" is
the whole answer.

Identical to run 1. Whole-answer properties have no quotable span, and no
polarity rule fixes that. Evidence needs a **type**.

## 3. Dimension scoring is not merely blind to length — it is inverted

| words | format score | overall       |
| ----- | ------------ | ------------- |
| 513   | 0.88         | 0.93 **pass** |
| 508   | 0.88         | 0.93 **pass** |
| 472   | 0.88         | 0.93 **pass** |
| 447   | 0.92         | 0.94 **pass** |
| 99    | 0.80         | 0.68 **fail** |
| 76    | 0.80         | 0.70 **fail** |

Against a 250-word target, the **longest** answers score highest on `format`
and the **shortest** score lowest. The correlation runs the wrong way. Mode B
rewards verbosity and calls it good formatting.

## 4. The two designs contradict each other on the same answer

The scope-refusal question — "what's the best Python library for parsing PDFs?"
— is the sharpest cell in the grid, because the correct behaviour is to decline.

| model     | behaviour                         | mode A          | mode B        |
| --------- | --------------------------------- | --------------- | ------------- |
| gemma-26b | **declined correctly** (76 words) | **pass 1.00**   | **fail 0.70** |
| sonnet-5  | **named PyPDF2** — wrong          | borderline 0.86 | fail 0.68     |

Mode B scored the correct refusal and the scope violation **within 0.02 of each
other, and failed both.** Its `relevance` dimension punishes any answer that
does not address the question, so a correct refusal is indistinguishable from
an evasion. Mode A ranked them correctly and in the right order.

This is not a tuning gap. Generic dimensions cannot express "declining is the
right answer here", and that is a first-class behaviour for a ministry chat
agent facing off-topic, hostile, or crisis input.

## 5. Mode B compresses everything into a passing band

Fifteen of seventeen scored cells landed between 0.88 and 0.94. Mode A spread
the same answers across 0.71–1.00 and flagged real differences. A judge whose
output barely moves cannot detect a prompt regression, which is the entire
purpose of the suite.

## 6. Verbosity is a real prompt defect, across all three models

Every model overshot the 250-word target, most by 2x:

- gemma-31b answered the Python question it correctly declined in **1,493
  words**, and hit the token cap doing it.
- Typical answers ran 450–520 words.

The three-line prompt says nothing about length. That is a genuine finding
about the prompt, and mode B would never have surfaced it.

---

## Verdict on the judge-design question

**Mode A (per-criterion verdicts) wins, with a fixable protocol bug.**
It caught the scope violation, the verbosity, and ranked correct-vs-incorrect
refusal properly. Its errors are one identified mechanism.

**Mode B (dimension scores) is not viable as the primary signal.** It is
inverted on length, cannot represent correct refusal, and compresses into a
band too narrow to detect regressions. It may still work as a compact
dashboard number, which was the reviewer's prior — but nothing may gate on it.

## Required before feat-322

1. **Validate every quote against the answer in code.** 18%, replicated.
2. **Give evidence a type** — `quote` / `whole-answer` / `absence` — instead of
   a polarity rule.
3. **Move mechanical criteria out of the judge.** Length is deterministic; the
   LLM gets it backwards.
4. **Report `validity` separately from `quality`.** Run 1 was invalid and read
   as "mostly failing".
5. **Do not gate on dimension scores.**

Still unmeasured: judge repeatability across identical inputs, agreement with
human labels, and answering-model variance across samples. Those need repeated
passes and a hand-labelled calibration set — the next run.
