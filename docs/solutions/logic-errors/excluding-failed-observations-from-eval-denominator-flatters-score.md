---
title: "Excluding failed observations from the eval denominator flatters the score"
date: 2026-08-29
category: logic-errors
module: mastra_offline_search_eval
problem_type: logic_error
component: service_object
severity: high
symptoms:
  - "The broken eval run reported a HIGHER pointwise-useful rate than the clean one: 60.3% over 68 judged cases versus 59.8% over 82."
  - "18 of 104 corpus cases failed with network_error under the harness's default request fan-out."
  - "A failed observation carries results: [] and no pointwiseRating, so it leaves both the numerator and the denominator."
  - "Other metrics degraded loudly in the same run (noResultRate 21.7% vs 6.0%, languageCorrectness 68.3% vs 82.9%) because they are computed over all observations rather than judged ones."
  - "The report exposes queries as cases attempted, sitting beside rates computed over cases judged, with no coverage field."
root_cause: logic_error
resolution_type: workflow_improvement
related_components:
  - "offline search evaluation runner"
  - "Watch Search Candidate Qualification"
  - "LLM pointwise judge"
tags:
  - "search-eval"
  - "offline-search-eval"
  - "denominator-bias"
  - "eval-harness"
  - "concurrency"
  - "measurement-integrity"
  - "qualification"
---

# Excluding failed observations from the eval denominator flatters the score

## Problem

The offline search-eval harness produces the evidence that authorizes promoting
a Typesense serving generation to production. Running its 104-case
`public-watch-absolute/v2` corpus at the harness's default fan-out produced 18
`network_error` failures. Re-running it serialized produced zero.

The broken run reported a **better** headline score than the clean one. Not a
rounding artifact and not noise — the arithmetic of a rate whose denominator is
the set of successfully judged cases.

## Symptoms

Both runs, same corpus, same production endpoint:

| metric                                  | broken (`SEARCH_CONCURRENCY = 4`) | clean (serialized)   |
| --------------------------------------- | --------------------------------- | -------------------- |
| development `pointwiseUsefulRate`       | 60.3% (41/68 judged)              | 59.8% (49/82 judged) |
| development `pointwiseUnacceptableRate` | 10.3%                             | 12.2%                |
| held-out `pointwiseUsefulRate`          | 76.5% (13/17 judged)              | 71.4% (15/21 judged) |
| `noResultRate`                          | 21.7%                             | 6.0%                 |
| `languageCorrectness`                   | 68.3%                             | 82.9%                |
| search failures                         | 18 of 104                         | 0                    |
| coverage (judged / attempted)           | 82%                               | 99%                  |

Read the first three rows and the broken run wins on both splits. Read the last
three and it is obviously the broken one. The rows anyone quotes are the rows
that invert.

Coverage does not reach 100% even on the clean run: 104 attempted, 103 judged.
Each run also lost one case to a judge-side failure rather than a search
failure, which is why the clean run's denominator is 103 and not 104. Search
failures and judge failures shrink the same denominator through different
paths.

## What Didn't Work

**Reading the two headline rates as a before/after.** The summary that suggests
itself — "serializing fixed the network errors, though useful rate dipped
slightly, 60.3% to 59.8%" — is false in its most important clause. The rates are
means over different denominators, so the arrow between them describes nothing.

**Assuming more failures must mean a worse score.** That monotonic intuition is
correct for a harness that scores failures and exactly backwards for one that
drops them. Eighteen failures did not add eighteen bad scores; they removed
eighteen chances to score badly.

**Reaching for the retry policy.** The client already retries —
`timeoutMs = 30_000` and `maxAttempts = 3` with backoff
(`apps/mastra/src/services/admin-search-eval-client.ts:511`, `:513`).
Instrumentation on the serialized run reported `recovered-by-retry: 0`: once
concurrency was removed, not one request needed a second attempt. Raising
`maxAttempts` would have addressed nothing.

**Lowering the concurrency directly.** `SEARCH_CONCURRENCY = 4` and
`JUDGE_CONCURRENCY = 2` are module constants
(`apps/mastra/src/services/offline-search-eval/absolute-runner.ts:36-37`), not
members of `AbsoluteRunnerOptions`, so no caller can turn them down.

## Solution

Serialize through the runner's injectable client seam — `searchClient?: typeof
callAdminEvalSearch` (`absolute-runner.ts:130`), resolved as
`options.searchClient ?? callAdminEvalSearch` (`:349`):

```ts
let queue: Promise<unknown> = Promise.resolve()
const serialized: typeof callAdminEvalSearch = (input) => {
  const next = queue.then(async () => {
    const result = await callAdminEvalSearch(input)
    await new Promise((resolve) => setTimeout(resolve, GAP_MS))
    return result
  })
  // Swallow rejections on the chain only, so one failure cannot poison every
  // later link. The failure still reaches the caller through `next`.
  queue = next.then(
    () => undefined,
    () => undefined,
  )
  return next
}

await runAbsoluteSearchEval(input, { searchClient: serialized })
```

`mapConcurrent` still spawns its workers; they queue behind each other inside
the client.

Then derive coverage before comparing anything. The report type carries no
failure count and no coverage field, so it comes from the per-case
`observations` array:

```bash
jq '{
  attempted: (.observations | length),
  judged:    ([.observations[] | select(.pointwiseRating != null)] | length),
  failed:    ([.observations[] | select(.searchFailure != null)] | length),
  usefulRate: .quality.pointwiseUsefulRate,
  gate:       .gate.reasons
}' "$REPORT"
```

If `judged` differs between two reports, the `usefulRate` comparison is void.

## Why This Works

A failed search does not become a bad score. It becomes a non-observation.
`failedObservation` builds the record with `results: []` and a `searchFailure`
code, the judging pass skips it outright —
`if (observation.searchFailure) return observation`
(`absolute-runner.ts:407`) — so it carries no `pointwiseRating`, and the quality
computation filters exactly on that:

```ts
// absolute-quality.ts:137-139
const pointwise = observations.flatMap((entry) =>
  entry.pointwiseRating == null ? [] : [entry.pointwiseRating],
)
```

`pointwiseUsefulRate` and `pointwiseUnacceptableRate` are means over that array.
A failure is absent from numerator and denominator alike.

The reason the broken run scored higher is visible in the recovered cases: the
14 development cases that failed under concurrency and succeeded when serialized
scored 8/14 useful — below the 60.3% the truncated run reported. Completing the
corpus could only pull the average down. There is no reading of this data where
the fix made search worse; there is only a broken measurement scored on an
easier subsample.

What makes it subtle is that the same 18 failures are **penalised** in two
metrics and **excluded** from a third, because those metrics range over all
observations rather than judged ones. `noResultRate` is a mean over every
observation (`absolute-quality.ts:154-156`), so 18 empty-result failures read as
18 no-result queries. `languageCorrectness` requires `results.length > 0`
(`:163-170`), so a failure scores zero. The harness was loudly unhealthy on the
axes nobody quotes and quietly better on the axis everybody does.

One more invitation to misread: `queries: observations.length`
(`absolute-quality.ts:143`) counts cases **attempted** and sits in the same
object as rates computed over cases **judged**.

The automated gate is not fooled. `gateFor` pushes a `search_failures` reason
whenever any observation failed (`absolute-runner.ts:250-252`), so a run with
failures cannot pass on its own. The exposure is one layer up: the gate answers
"may this be promoted", not "is this run's 60.3% comparable to that run's
59.8%", which is the question a narrative summary answers silently and wrong.
An `OPERATOR_ACCEPTED` bundle can also waive its way past the gate.
`WATCH_SEARCH_CANDIDATE_REQUIRED_EVIDENCE_GATES`
(`apps/admin/src/services/typesense-watch-search-candidate-qualification.ts:1-12`)
names ten gates, and `search_failures` is not one of them — so a waiver for it
has no canonical label. Nothing forces a mislabel: `waivedGates[].gate` is
validated only as a non-empty string, so an operator may write
`search_failures` verbatim. The gap is that the schema does not prompt for it,
which is a reason to state coverage in the bundle's `knownLimitations` rather
than to rely on a gate name existing for it.

## Prevention

- **Determine whether a failed item is scored or dropped, before reading any
  rate.** If dropped, every failure inflates the reported rate and a more-broken
  run can outscore a less-broken one.
- **Report coverage — judged over attempted — beside every rate.** Treat a rate
  quoted without its denominator as unreadable. When coverage differs between
  two runs, say the rates are incomparable rather than reporting the delta.
- **Treat an unexplained improvement as a coverage question first.** It is
  cheaper to check the denominator than to explain a phantom win.
- **Re-derive coverage after changing anything about the harness's own
  execution** — concurrency, timeouts, retries, batching, host, credentials. Any
  of these changes which items succeed, and therefore which items are in the
  denominator, without touching the system under test.
- **Count retry recoveries in any wrapper around an external client.** The
  single number `recovered-by-retry: 0` is what distinguished "we need more
  retries" from "retries were irrelevant, concurrency was the cause". Without
  it, the cheaper-looking and wrong fix is indistinguishable from the right one.

### Reconciling this with the pairwise guidance

`../architecture-patterns/mastra-offline-search-eval-orchestration-boundary-pattern.md:190-192`
says to _"exclude judge disagreements and provider failures from net win-rate
style denominators so reports do not manufacture confidence."_ That is correct
and is not in tension with this doc, but the two read as opposites unless the
difference is named.

In a **pairwise win-rate**, a provider failure is not evidence for either side;
counting it as a win or a tie would manufacture confidence, so excluding it is
right. In an **absolute pointwise rate**, the excluded case would have carried a
real score, so excluding it manufactures confidence instead. The operation is
the same; the risk inverts with the shape of the metric. Exclusion is safe only
when coverage is reported alongside, which is the piece neither harness's report
type currently provides.

## Related Issues

- `../architecture-patterns/mastra-offline-search-eval-orchestration-boundary-pattern.md`
  — the domain's architecture guidance, whose denominator rule is scoped to the
  older pairwise comparison report and predates this absolute harness.
- `../best-practices/external-client-retry-parity-in-runner-fanout-20260512.md`
  — sibling failure in the same runner family, about silent data corruption from
  absorbed failures rather than the direction a summary metric moves.
- `../logic-errors/completeness-claim-must-consume-every-drop-counter.md` —
  nearest root-cause sibling: a claim derived from a happy-path count while a
  separate drop counter goes unread. Different domain, same shape.
- `../best-practices/precomputed-hybrid-search-serving-index-20260803.md` —
  defines the qualification gate this evidence feeds, including its pointwise
  thresholds. It does not yet warn that the run producing that evidence can have
  less than full coverage.
- `../integration-issues/typesense-application-revision-invalidates-serving-pin.md`
  — same incident arc (FGE-109), different lesson; its recovery runbook calls
  the same runner through the adjacent `servingUrl` option.
