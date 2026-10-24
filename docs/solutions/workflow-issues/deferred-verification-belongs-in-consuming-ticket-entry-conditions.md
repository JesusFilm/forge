---
title: "Deferred verification belongs in the consuming ticket's entry conditions, not the producing plan's prose"
date: "2026-07-22"
category: "workflow-issues"
module: "compound-engineering plan -> roadmap ticket handoff"
problem_type: "workflow_issue"
component: "development_workflow"
severity: "medium"
root_cause: "missing_workflow_step"
resolution_type: "workflow_improvement"
applies_when:
  - "A PR deliberately ships a helper, client, or module that no caller consumes yet"
  - "Review defers a finding as a forward-looking re-check because the PR structurally cannot verify it"
  - "A real-contract smoke test is skip-gated by default because credentials or a provisioned account do not exist yet"
  - 'A house convention defers work behind a count threshold ("extract when a third consumer needs it") and the current PR may be that Nth consumer'
  - "Writing the consuming or follow-up ticket for scaffolding that shipped standalone"
symptoms:
  - "Review records a caller-relative law as unverifiable because no caller exists in the PR"
  - "Definition-of-done accepts a never-run smoke test as satisfied"
  - "The only record of a deferred check lives in the producing plan's Open Questions prose"
  - "A precedent is recited verbatim after the count it was predicated on has already been crossed"
  - "The integrator inherits a client verified only against hand-transcribed fixtures"
related_components:
  - "roadmap"
  - "testing_framework"
  - "documentation"
tags:
  - "verification-debt"
  - "entry-preconditions"
  - "unwired-helper"
  - "deferred-verification"
  - "roadmap-ticket"
  - "smoke-test"
  - "plan-handoff"
  - "compound-engineering"
---

# Deferred verification belongs in the consuming ticket's entry conditions, not the producing plan's prose

## Context

Some PRs deliberately ship a module that nothing calls. PR #1621
(`feat/langfuse-prompt-helper`, open at time of writing) is the clean example:
it adds a two-layer Langfuse managed-prompt helper to `apps/mastra` —
`fetchLangfusePrompt` (no-throw result union over `GET /api/public/v2/prompts/{name}`)
plus `getManagedPrompt` (TTL cache, failure cooldown, serve-stale, single-flight,
caller-supplied fallback with provenance) — and wires it into nothing. The plan
makes that a stop condition, not an oversight:

> Stop conditions: do not wire the helper into `seekerAgent`, any agent,
> workflow, or `/forge-*` route
> — `docs/plans/2026-07-20-001-feat-langfuse-prompt-helper-plan.md:19` (PR #1621)

and the Verification Contract enforces it with a grep gate
(`grep -r "langfuse" apps/mastra/src/mastra/` → no hits, plan line 255).

Shipping unwired buys real things: the diff is reviewable in isolation, the
risky mechanism lands before anything depends on it, and a downstream
workstream is unblocked without inheriting a half-built dependency. What it
costs is **verification reach**. A PR with no consumer cannot exercise any
property that is defined relative to a consumer, and it often cannot exercise
properties that need an external account nobody has provisioned yet. Those
checks do not disappear — they move. The question this doc answers is _where
they should move to_, because the default (the producing plan's prose) is a
place the person who must execute them will never read.

All file paths below are in this repo. Files marked **(PR #1621)** exist only
on the unmerged branch `origin/feat/langfuse-prompt-helper`; everything else is
in the working tree / on `main`.

## Guidance

**Core rule: a deferred check is only real if it is recorded where the deferral
will be executed.** The producing PR's plan, PR body, and review artifacts are
all _archaeology_ from the consuming workstream's point of view. The consuming
workstream reads its own ticket.

Three practical steps.

### (i) Classify each applicable law as self-contained or caller-relative

Before review, split the repo laws the diff must satisfy into two piles. The
split tells a reviewer which laws to even attempt, and prevents the failure
where an unverifiable law is silently graded "follows".

**Self-contained** — fully verifiable inside an unwired PR, because the property
lives entirely within the module:

- byte-cap / OOM guard (`docs/solutions/best-practices/buffered-http-response-byte-cap-oom-guard-20260629.md`)
- opt-in env vars must be `.optional()` (`docs/solutions/runtime-errors/required-env-var-without-default-broke-railway-deploy-20260511.md`)
- no-throw typed result union + leak control (`docs/solutions/conventions/single-service-http-client-result-union-convention.md`)
- slot-leak guard on reserve-then-dispatch (`docs/solutions/best-practices/in-memory-slot-reservation-fire-and-forget-20260506.md`)
- plain-string `event=` logging (`docs/solutions/runtime-errors/railway-logsv2-silences-nextjs-stdout-runtime-20260518.md`)

PR #1621 satisfies all five. (A review pass reported checking each; that
artifact was a scratch file and no longer exists, so treat the completeness of
that check as reported, not confirmed.)

**Caller-relative** — has a _single-call half_ that a documented budget can
stand in for, and an _aggregate/composition half_ that only a real caller
exercises. The outbound-timeout law
(`docs/solutions/best-practices/outbound-timeout-shorter-than-caller-budget-20260506.md:134-138`)
is the archetype:

- The single-call half _is_ checkable without a caller, provided the repo has a
  written budget to point at. It does here, and the diff points at it —
  see Examples.
- The aggregate half is not. "N serial `await getManagedPrompt(...)` calls in
  one turn sum to N × timeout against one budget" and "where in the turn does
  this 3s sit relative to the other in-turn deadlines" are properties of the
  call site, and the call site does not exist.

Byte caps and timeouts are the space and time axes of input bounding; note that
the _space_ axis is self-contained (the guarded resource is this process's heap)
while the _time_ axis is caller-relative (the guarded resource is someone else's
budget). That asymmetry is why the same PR can fully close one and only half-close
the other.

### (ii) Write every deferred item as an entry precondition on the consuming ticket

Not a plan Open Question, not a PR-body residual, not a review artifact under
`/tmp`. The ticket. And write it as a **check with a pass condition**, not as an
awareness note:

- Bad: "the smoke has not been run yet."
- Good: "`LANGFUSE_PROMPT_SMOKE_TEST=1` + dev keys → smoke green against the
  provisioned dev project. This proves the operational precondition landed
  before wiring starts."

If the check needs something nobody owns (an account, a region decision, a key
pair), name the _decision_ in the ticket too, not just the check — an unowned
precondition with no named decision is how a ticket stalls silently.

### (iii) Before citing a precedent, restate its predicate and test it

A precedent almost always has a condition attached. Citing the precedent
without re-evaluating the condition is how a documented rule silently inverts:
the rule was written to fire at a threshold, and each new PR recites the
pre-threshold half of it, so the threshold is never observed to have been
crossed.

The mechanical version: when quoting a house doc's "we deliberately did not do
X (yet)" stance, quote its _trigger sentence_ in the same breath and answer it
in one line — "trigger is a third consumer; _count the consumers now_; therefore \_\_\_". Re-derive the count from the code; do not trust the number written in the doc, which is a snapshot of when someone last looked. If the answer is "therefore we should extract but are choosing
not to", that is a finding and needs a ticket, not a comment.

### Unwired-helper PR checklist

1. State the no-wiring boundary as a mechanical gate (grep), not prose. #1621
   does this (plan line 255).
2. Classify applicable laws self-contained vs caller-relative; verify the first
   pile, and for the second, verify the single-call half against a written
   budget and name the aggregate half as deferred.
3. For every real-contract test that is skip-gated by default, name the
   provisioning owner and put "runs green" in the consuming ticket's entry
   conditions.
4. Do not let the producing plan's Definition of Done claim a gate that has
   never executed. Either mark the gate explicitly unmet-and-transferred, or
   don't list it as satisfied.
5. Route every advisory finding into the consuming ticket **individually** and
   cite the finding number in the ticket text, so a later reader can diff the
   review's list against the ticket's list. A finding that lands only in the PR
   body has not been transferred.
6. Re-test the predicate of every precedent the plan cites.

## Why This Matters

The failure is silent, and it lands on someone else.

Green CI on the producing PR reads as verification. It is not — it is
verification of exactly the properties an unwired module can have. The
integrator who picks up the consuming ticket six weeks later sees a merged PR,
a passing suite, a module header full of confident invariant comments, and a
review that returned "Ready with fixes". Nothing in that surface distinguishes
"checked and correct" from "structurally uncheckable here, deferred to you".
So the integrator does not re-check it, and an assumption that was never tested
against reality gets its first real exercise in production traffic.

The concrete shape here: the Langfuse client's branch classifications
(`auth_failed`, `rate_limited`, `rejected`, `parse_error`, `chat_type_unsupported`,
`empty_prompt`) are pinned only against fixtures a human transcribed from
documentation. That is precisely the gap
`docs/solutions/best-practices/mocked-shape-vs-real-contract-discipline-20260506.md`
exists to close — mocked tests prove branch _shape_, real fixtures prove
production _contract_ — and it stays open as long as the closing test is
optional. The review said so plainly:

> The opt-in smoke test ... is the designed real-contract gate, but it requires
> manual Langfuse provisioning that has not happened yet ... so none of the
> branch classifications in this diff have been verified against a live Langfuse
> response as of this review.
> — review artifact `testing.json`, PR #1621 review run

Making the closing test opt-in is the right call (CI must not depend on an
external account). Accepting it as a satisfied gate is not.

## When to Apply

- Shipping scaffolding, a client, or a helper ahead of its consumers.
- Any plan with a Deferred / Scope Boundaries / Open Questions section — every
  item there needs a named home in a ticket, or it is folklore.
- Any real-contract test that is `describe.skipIf`-gated on an env flag or on
  credentials that do not exist yet.
- Any house convention that defers work behind a count or a trigger ("extract
  when a third consumer needs it", "revisit when X happens") — check whether the
  current PR is the event.
- Any code comment or plan section that cites prior art as justification.
- Sibling situation, opposite direction:
  `docs/solutions/workflow-issues/removal-recipe-ticket-for-phase-scoped-scaffolding-20260708.md`
  — write the _teardown_ ticket in the PR that ships temporary scaffolding.
  Same law: the downstream workstream reads its own ticket.

## Examples

### The plan's deferred list, and what it does and doesn't carry

`docs/plans/2026-07-20-001-feat-langfuse-prompt-helper-plan.md` **(PR #1621)**
is explicit and honest about deferral. Scope Boundaries (lines 67-82, whose Deferred list is lines 71-75) names five
deferred items — seeker wiring and the composition decision, stale-while-revalidate,
a `version` pinning parameter, sustained-fallback alerting, and the Langfuse
access-control review — and Open Questions (lines 138-140) carries the
provisioning decision:

> **Deferred (operational, non-blocking for this unit):** Langfuse hosting
> posture and ownership ... must be answered before the U4 smoke can ever run
> and before the follow-up integration starts.
> — plan line 140 (PR #1621)

Crucially the plan **does** route these onward: line 69 says "captured in the U5
roadmap ticket", and U5 (lines 235-243) makes ticket creation an implementation
unit. That is the corrected practice already applied. What the plan still does
wrong is its own bookkeeping: the Verification Contract lists the smoke as a
gate (line 256, "Real-contract smoke (manual, opt-in)") while line 258 states it
"never runs in CI", and the Definition of Done (line 264) then claims "all
Verification Contract gates pass". A gate that has never executed is listed
among the passed. The PR body is more honest than the plan here — it records
"No Langfuse project exists yet ... so the smoke has not run against a live API".

### The follow-up ticket: the positive exemplar (contradicts one framing)

`docs/roadmap/ai-chat/feat-272-seeker-langfuse-managed-prompt-integration.md`
**(PR #1621)** _does_ carry the smoke obligation as an entry precondition. This
contradicts the assumption that the deferral was left in plan prose:

- Lines 43-49, a bolded **Operational precondition (from the plan's Open
  Questions — decide before starting)**: names the undecided Cloud-vs-self-hosted
  and region choice, the unowned provisioning of per-environment projects, key
  pairs, and the seeded smoke prompt, and states it "gates BOTH the first real
  run of the opt-in smoke and this integration."
- Line 68, in Entry Points: "Must run green before integration starts."
- Lines 159-161, in Verification: "The opt-in smoke runs green against the
  provisioned dev project (`LANGFUSE_PROMPT_SMOKE_TEST=1` + dev keys) — proves
  the operational precondition landed before wiring starts."

So the transfer happened. The learning is not "they failed to do this"; it is
"this is what doing it looks like, and here is what still leaked through".

### What still leaked: advisory findings recorded in the wrong artifact

The review triaged four advisories into one group titled _"feat-272 wiring
constraints (advisory)"_ — findings 8, 9, 10, 11 — with the disposition
"Fold into the feat-272 ticket's constraints section." Three landed, and the
ticket cites them by number:

- finding 8 → ticket lines 143-145 (`fallback` must be non-empty; layer 2
  serves it verbatim with no emptiness guard, asymmetric with layer 1's
  `empty_prompt` rejection) — "(Review finding #8.)"
- finding 9 → lines 146-151 (serve-stale means deleting a prompt in Langfuse
  does not retract cached text until restart) — "(Review finding #9.)"
- finding 11 → lines 152-155 (prompt names must be compile-time constants; the
  default cache never evicts) — "(Review finding #11.)"

One did not. (Its number is shown as **10** below; that numeral is _inferred_ from the gap in the 8/9/11 sequence — the numbered review artifacts were scratch files and are gone. The PR body independently confirms the substance: it says the runtime halves of **three** advisories were routed to the ticket, and names a fourth separately.) Its subject is an empty-string `label` argument
surviving both resolution rungs and reaching the wire as `?label=`, producing
either a persistent rejected-fallback or a silent duplicate cache entry
shadowing `production`. It is recorded only in the PR description:

> **P3 (advisory) — an explicit `label: ""` call argument bypasses both
> label-resolution rungs** and reaches the wire as `?label=`. Normalization left
> unapplied; noted for the feat-272 wiring tests.
> — PR #1621 description, Known Residuals

`grep -niE 'empty[- ]string|label: ""|normali|trim'` over the ticket returns
nothing. The feat-272 implementer reads the ticket, not the description of a PR
merged weeks earlier. Same fate for the reliability reviewer's aggregate-latency
note — "Worth a note in feat-272's implementation checklist to fetch
concurrently (`Promise.all`) if more than one prompt is ever resolved per turn"
— which appears in `reliability.json` and as a one-line residual risk in
`review.json`, both of which live under `/tmp` and will be garbage-collected. Note the repo
_does_ have a persistent home for exactly this — `docs/residual-review-findings/`
— which currently holds three files, none for #1621. The routing failure is
therefore a failure to use an existing mechanism, not a missing one.
The ticket has no mention of concurrency, aggregate latency, or the 90s budget.

**Before / after, concretely.** Written as producing-PR prose (what happened for
finding 10):

> Normalization left unapplied; noted for the feat-272 wiring tests.

Written as a consuming-ticket entry precondition (what happened for findings
8/9/11, and what #10 should have gotten):

> - An explicit `label: ""` bypasses both label-resolution rungs and reaches
>   the wire as `?label=`, creating a cache entry that shadows `production`.
>   Normalize at the wiring seam — `(label?.trim() || undefined) ?? default ??
"production"` — and pin an empty-string-label case in the wiring tests.
>   (Review finding #10.)

The difference is not wording. It is which document the person who must act on
it will open.

### The caller-relative law: single-call half checked, aggregate half not

The framing "the outbound-timeout law could not be checked because no caller
exists" is too strong — the source shows the single-call half _was_ checked,
against a budget the repo had already written down. `apps/mastra/src/config/env.ts`
**(PR #1621)**, lines 356-359, immediately above `LANGFUSE_TIMEOUT_MS`:

> `// Caller-budget rule (docs/solutions/best-practices/outbound-timeout-shorter-than-caller-budget-20260506.md):`
> `// this single-attempt prompt-fetch timeout must stay strictly inside any`
> `// future chat-turn budget. The 10_000 cap keeps even the widest override`
> `// well below the 90 s chatTurn ceiling.`

That ceiling is real and pre-existing: `apps/mastra/src/mastra/budgets.ts:136`
(working tree) defines `chatTurn: 90_000`, consumed by
`apps/mastra/src/mastra/agents/seeker-route.ts:217` and
`apps/mastra/src/mastra/agents/experience-chat-route.ts:93`. The reviewer
verified against it: "default 3000ms, schema-capped 10000ms, verified strictly
inside the 90s chatTurn budget" (`reliability.json`).

**The lesson is the refinement, not the absence.** A caller-relative law is
checkable in an unwired PR _to the extent the repo has already written down the
caller's budget_ — a schema `.max()` anchored _by comment_ to a named,
grep-able constant is a genuine — if soft — proof of the single-call half. Soft
because the anchor is prose: `env.ts` imports no budget symbol, the cap is the
literal `.max(10_000)`, and nothing mechanically fails if `chatTurn` drops below
it. A test asserting `LANGFUSE_TIMEOUT_MS_CAP < TIME_BUDGET_MS.chatTurn` would
make it real. What remains structurally deferred is
composition, and the same reviewer named it precisely:

> each `getManagedPrompt` call is correctly bounded by `config.timeoutMs` ...
> but this module has no batching/concurrency primitive. When feat-272 wires
> this into the seeker's per-turn instruction resolution, if a future turn
> resolves N distinct (name,label) prompts serially ... the additive worst case
> is N x timeoutMs against the single 90s budget. Bounded per-call, not bounded
> in aggregate.
> — `reliability.json`, PR #1621 review run

So the classification to carry forward is finer than self-contained vs
caller-relative: **anchor the single-call half to a written constant; transfer
the aggregate half to the consuming ticket.** Here the first happened and the
second did not.

### The smoke's skip gate

`apps/mastra/src/services/langfuse-prompt-client.smoke.test.ts` **(PR #1621)**:

- line 54: `const RUN_LANGFUSE_SMOKE = env.LANGFUSE_PROMPT_SMOKE_TEST === "1"`
- line 79: `describe.skipIf(!RUN_LANGFUSE_SMOKE)(`

The file is exemplary in every respect _except_ having run. Its header (lines
10-52) documents the one-time manual seeding convention — prompt
`forge-mastra-smoke/text-prompt`, one prompt with two versions under labels
`production` and `smoke` carrying _different exact sentinel bodies_, never
self-seeding — and explains why two labels are necessary:

> `production` is ALSO Langfuse's documented default when the `label` param is
> omitted, so a production-labeled prompt alone cannot prove the client
> actually sends (and Langfuse honors) `?label=`.
> — smoke test lines 35-41 (PR #1621)

It also carries a fail-loud contract (lines 43-46): with credentials present
but the seeded prompt missing it _fails_, never skips, via `expect.unreachable`
with seeding guidance (lines 98-107, 134-143). That two-label design was itself
a review fix — the cross-model adversarial pass caught that the original smoke
asserted only non-empty text under the default label, so it would have gone
green while explicit label selection was broken.

None of this has executed. The plan states the reason bluntly:

> No Langfuse account, project, or keys exist anywhere in this repo or its
> deploy config today.
> — plan line 132 (PR #1621)

A well-designed test that has never run proves the design of the test.

### The precedent whose predicate was crossed

`docs/solutions/conventions/single-service-http-client-result-union-convention.md`
(working tree, unmodified by PR #1621) has a section titled _"Note: the shared
helpers are currently duplicated, not extracted"_ (line 134).

Read that section carefully before leaning on it, because it opens by disclaiming
rule-hood: _"This is a **descriptive observation, not a rule to enforce.**"_
(lines 135-136). Its closing paragraph nonetheless states a condition, and the
condition is what matters here:

> **When extraction is worth it:** the next time a change must touch all copies
> (change-amplification is the real cost of duplication), or when a third
> consumer needs the helper. Until then, two frozen copies of a six-line pure
> helper is an accepted, low-cost state — just don't mistake it for a convention
> others must replicate.
> — convention doc lines 162-165

So this is not a rule that was violated. It is a **descriptive claim whose factual
premise expired** — which is the more common and more insidious case, because
nothing announces it. A rule has enforcement; a description just quietly stops
being true.

The doc's factual premise is line 142: "duplication across _two_ consumers"
(`firecrawl-client.ts` and `jesusfilm-rag-client.ts`), and its named extraction
target is line 152-153: `endpoint`, `safeReason`, `readUpstreamReason` into
`apps/mastra/src/services/http-client-util.ts` — a path that **does not exist**,
because the extraction has not happened. That is the open item, not a broken
citation.

**Both triggers fired in PR #1621.**

_Third consumer._ The copies are real, and labelled as such — verified
line-by-line against the template:

- `langfuse-prompt-client.ts:133-136` `endpoint` — body identical to
  `jesusfilm-rag-client.ts:106-109` (parameter name matches too)
- `:140-146` `safeReason` — byte-identical to `jesusfilm-rag-client.ts:111-117`
- `:169-215` `readJsonBodyCapped` — byte-identical to
  `jesusfilm-rag-client.ts:139-183`
- `:220-228` `readUpstreamReason` — byte-identical to
  `jesusfilm-rag-client.ts:187-195`
- `:234-…` `failureForStatus` — matches modulo the failure type name

with the module header stating the stance at line 13-15: "`endpoint`,
`safeReason`, `readJsonBodyCapped`, `readUpstreamReason`, and `failureForStatus`
are copied from it (provenance comments at each site); no shared helpers module
exists yet, per plan."

Now actually count, per helper — and the count is worse than "this PR is the
third consumer":

| Helper               | On `main`                                                                                                                         | With #1621 | Third consumer reached    |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ---------- | ------------------------- |
| `endpoint`           | **4** — `jesusfilm-rag-client.ts:107`, `firecrawl-client.ts:162`, `admin-agent-tools-client.ts:48`, `youtube-search-client.ts:74` | 5          | **already, before #1621** |
| `safeReason`         | 2 — firecrawl, jesusfilm-rag                                                                                                      | 3          | at #1621                  |
| `readUpstreamReason` | 2 — firecrawl, jesusfilm-rag                                                                                                      | 3          | at #1621                  |

The convention doc's premise — _"duplication across **two** consumers"_ (line 142) — is false for `endpoint` and has been for at least two PRs. #1621 is the
third consumer only for `safeReason` and `readUpstreamReason`.

That correction makes the point sharper rather than weaker. A stale factual
premise does not fail loudly at the moment it expires; it is re-cited by each
subsequent PR, and each citation makes it look freshly checked. By the time
anyone counts, the threshold is not just crossed but lapped. **The remedy is to
re-derive the count, never to re-read the sentence** — the sentence will keep
saying "two" indefinitely.

_A change that must touch all copies._ A correctness reviewer independently found
a real defect in the copied `readJsonBodyCapped`: its bare `catch { return undefined }`
swallows a `TimeoutError` thrown by `reader.read()` when the abort fires
_mid-body_ on a 200, so a genuine upstream-latency incident is reported as
`reason=parse_error` rather than `reason=timeout`, steering an operator toward
suspected contract drift. The finding's own suggested fix names the trigger
verbatim:

> Since the helper is copied from jesusfilm-rag-client, the cleanest home is the
> planned shared-helpers extraction (fix both clients at once); doing it only
> here would fork the copied helper.
> — `correctness.json`, PR #1621 review run

It was suppressed as a confidence-50 advisory ("Suppressed anchor-50 advisories:
timeout-during-200-body-read classified parse_error not timeout",
`review.json` residual risks) and appears in the PR body's suppressed list.

_What the review actually said about the copy._ The framing that "review declined
to auto-apply the extraction because it is a decision, not mechanical work" is
not what the source says — that phrase belongs to a different pair of findings.
The triage group _"File-size decomposition (decision gate)"_ covers findings 1
and 2 (`env.ts` crossing 1,000 lines; the 1,294-line test file) with the
rationale "Splitting env.ts diverges from the 10-sibling inline convention - a
repo-shape decision, not a mechanical fix." Those were correctly escalated to a
human and correctly recorded as accepted residuals in the PR body.

The helper extraction was never raised as a finding at all. The review's
institutional-learnings pass restated the trigger and then graded the diff
compliant in the same breath:

> the doc ... states the copy-not-extract stance (helpers are duplicated across
> clients, not shared, until a third consumer needs them).
> **Compliance:** FOLLOWS, verified line-by-line against the diff — `endpoint()`,
> `safeReason()`, `readJsonBodyCapped()`, `readUpstreamReason()`,
> `failureForStatus()` are labeled "Copied from jesusfilm-rag-client.ts" at each
> site
> — `learnings.md`, PR #1621 review run

That is the inversion in miniature: the trigger was quoted accurately and then
not evaluated, so being the event the rule was written for read as conforming to
the rule. Net state today — the convention doc still says "duplication across
_two_ consumers" (line 142), a third copy exists on the branch, a defect that
must be fixed in all copies is documented as suppressed, and feat-272 carries no
extraction item (`grep -niE "extract|http-client-util|shared helper|third"` over
the ticket returns nothing). The disposition may still be the right one — three
frozen copies of pure six-line helpers is genuinely cheap — but it is now an
undocumented default rather than a decision, and the next author will read line
142 and count to three again.

## Related

- `docs/solutions/workflow-issues/removal-recipe-ticket-for-phase-scoped-scaffolding-20260708.md` —
  the **co-equal sibling**, not a parent. Both say "write the downstream artifact in the producing
  PR while the map is fresh", but that doc's own "When to Apply" scopes it to _temporary_
  scaffolding with a known teardown trigger, explicitly telling you to skip it when the code is
  permanent. An unwired-but-permanent helper is the gap it leaves; this doc covers that case.
  Trigger, failure mode, artifact, and verification shape are otherwise disjoint.
- `docs/solutions/best-practices/mocked-shape-vs-real-contract-discipline-20260506.md` — a new
  dimension for its table: here the real-contract test **exists and is correctly shaped**, but is
  skip-gated by default and has never run, so the discipline's "not optional" rule is satisfied
  textually while the protection is absent.
- `docs/solutions/best-practices/outbound-timeout-shorter-than-caller-budget-20260506.md` — the
  caller-relative law at issue. Note it does not currently acknowledge the no-caller case, where the
  single-call bound is checkable against a documented ceiling but the aggregate (N calls per turn)
  bound is not.
- `docs/solutions/conventions/single-service-http-client-result-union-convention.md` — its
  extraction trigger ("when a third consumer needs the helper", line 162) has now factually fired,
  while its prose still describes duplication across _two_ consumers (line 142).
- PR #1621 (`feat/langfuse-prompt-helper`) — open and unmerged as of 2026-07-22. The plan and the
  consuming ticket `docs/roadmap/ai-chat/feat-272-seeker-langfuse-managed-prompt-integration.md`
  cited throughout live only on that branch, not on `main`.
