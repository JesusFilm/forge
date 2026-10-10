---
title: "Stochastic eval gates need confirmation and a refused state"
date: "2026-08-07"
category: "architecture-patterns"
module: "apps/mastra"
problem_type: "architecture_pattern"
component: "testing_framework"
severity: "high"
applies_when:
  - "A release gate combines deterministic checks with LLM judge verdicts"
  - "Repeated runs of an unchanged system can produce different verdicts"
  - "A baseline or candidate run may be incomplete or incomparable"
tags:
  - "llm-eval"
  - "release-gate"
  - "sampling-noise"
  - "confirmation-run"
  - "baseline"
  - "fail-closed"
related_components:
  - "apps/mastra/src/evals/seeker"
---

# Stochastic Eval Gates Need Confirmation And A Refused State

## Context

An LLM eval can produce a precise score and still be an unsafe release gate.
During the Seeker eval implementation in [PR #1856](https://github.com/JesusFilm/forge/pull/1856), the first gate passed its red-path ablation and judge-repeatability checks, but repeated full runs of the unchanged system exposed new tool-skip counts and isolated judge flips. The frozen-answer judge check had measured judge stability; it had not measured whether fresh answer generation kept the gate quiet at the layer where the merge decision was made. (session history)

Several tempting policies failed under those runs. A magnitude tolerance for tool skips had no stable boundary because unchanged runs crossed successive thresholds. Failing on one grounding-verdict flip made ordinary sampling noise look like a regression and encouraged rerunning until a green sample appeared. Accepting a baseline that already contained the prohibited behavior permanently weakened the gate because future occurrences looked like carried known failures. (session history)

The general lesson is to classify evidence by what decision it can support, then give the gate a third outcome for insufficient evidence. Do not force every run into green or red.

## Guidance

Separate gate inputs into three lanes.

### Deterministic evidence may fail immediately

Use an immediate red verdict for failures whose meaning does not depend on model sampling: malformed or invented identifiers, violated structural contracts, or a required tool call that is observably absent on a successful cell. In the Seeker gate, any current retrieval-tool skip is red, while a baseline containing a skip is refused because it is not a valid known-good reference (`apps/mastra/src/evals/seeker/gate.ts:17-22`, `apps/mastra/src/evals/seeker/gate.ts:470-492`).

A tolerance does not repair a baseline that violates the intended invariant. Fix the underlying behavior and mint a clean baseline.

### Stochastic evidence needs an arming rule

Do not let one sampled judge regression fail a release unless unchanged-system measurements show that one observation is outside the noise floor. Suitable arming rules include repeated independent confirmation, a pre-measured multi-sample threshold, or another policy derived from repeated unchanged runs.

The Seeker gate requires the same question, answering model, and criterion to be violated in a second independent judged run before a grounding flip turns red. A flip without a confirmation run refuses; a flip that does not reproduce remains visible as unconfirmed noise (`apps/mastra/src/evals/seeker/gate.ts:522-568`). Aggregate score movement is triage-only because a single-sample score delta was not proven reliable enough to make the merge decision (`apps/mastra/src/evals/seeker/gate.ts:572-585`).

This distinction avoids two opposite errors:

- Red-on-first-sample creates false alarms and rerun-until-green behavior.
- Green-on-unconfirmed-signal silently discards evidence that still needs resolution.

### Incomplete or incomparable evidence must refuse

Use a nonzero `refused` outcome when the system cannot make an honest comparison: missing fixtures, partial judge coverage, mismatched questions or models, different decoding behavior, a different retrieval corpus, or a stochastic regression that still needs confirmation. The prompt itself is excluded from the Seeker gate's identity-refusal dimensions because it is the subject under test; the remaining identity fields must agree (`apps/mastra/src/evals/seeker/types.ts:93-111`).

Verdict precedence should preserve certain evidence. A deterministic red remains red even if a stochastic signal also needs confirmation; otherwise unresolved confirmation refuses, confirmed regression reds, and only then may the run be green (`apps/mastra/src/evals/seeker/gate.ts:587-598`).

### Validate every claimed property at its own layer

Before trusting an eval, state each product claim and identify the experiment that measures that claim at the same layer:

| Claim                        | Required evidence                                                          |
| ---------------------------- | -------------------------------------------------------------------------- |
| The judge is repeatable      | Rejudge identical saved answers several times                              |
| The full gate stays quiet    | Regenerate and judge the unchanged system several times, then run the gate |
| A real regression is caught  | Introduce a controlled regression and show the gate turns red              |
| Comparisons are meaningful   | Change an identity field and show the gate refuses                         |
| Missing evidence cannot pass | Remove or corrupt required evidence and show a nonzero refusal             |

Passing the first row does not prove the second. This is the same claim-layer discipline used for production behavior tests, applied to evaluation systems.

## Why This Matters

A flaky release gate trains engineers to distrust it or retry until it agrees with them. A fail-open gate gives false confidence. Both outcomes defeat the purpose of evaluation even when the scoring implementation is mathematically correct.

The three-state model keeps uncertainty explicit:

- `green`: comparable evidence supports proceeding;
- `red`: a configured failure rule has been satisfied;
- `refused`: the available evidence cannot support either conclusion yet.

The refused state is not an operational error to hide. It is the gate preserving the difference between “no regression found” and “the experiment was not capable of deciding.”

## When To Apply

- LLM answer or judge sampling can change across identical runs.
- A release decision combines code checks, model judgments, and aggregate scores.
- Baseline artifacts can become stale after model, rubric, corpus, or decoding changes.
- CI must distinguish a confirmed regression from missing or inconclusive evidence.
- A team is calibrating a new eval before making it a required check.

## Examples

Avoid a binary gate that treats every observed flip as deterministic:

```ts
const verdict = groundingFlips.length > 0 ? "red" : "green"
```

Prefer explicit evidence lanes and a refusal path:

```ts
const verdict =
  deterministicFailures.length > 0
    ? "red"
    : confirmationRequired && confirmationRun == null
      ? "refused"
      : confirmedRegressions.length > 0
        ? "red"
        : "green"
```

Calibrate before enabling the gate in CI:

1. Run the full pipeline repeatedly with no product change and record false reds.
2. Introduce one controlled failure for each deterministic lane and verify red.
3. Confirm that partial, mismatched, or missing evidence refuses with a nonzero exit.
4. Set stochastic arming rules from the observed unchanged-run distribution, not intuition.
5. Recalibrate when the answering model, judge, decoding policy, corpus, rubric, or weights change.

## Related

- [Mocked shape vs real contract discipline](../best-practices/mocked-shape-vs-real-contract-discipline-20260506.md) — the broader rule that evidence must exercise the layer where the claim is made.
- [Mastra offline search eval orchestration boundary pattern](./mastra-offline-search-eval-orchestration-boundary-pattern.md) — fail-closed artifact and comparison guidance for Mastra-owned search evals.
- [Internal diagnostic search modes need mode-aware eval identity](./internal-diagnostic-search-modes-need-mode-aware-eval-identity.md) — identity rules for comparisons across different eval modes.
- [PR #1856](https://github.com/JesusFilm/forge/pull/1856) — the Seeker implementation and measured decision record from which this pattern was extracted.
