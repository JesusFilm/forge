---
title: "agent.generate() forwards only modelSettings to the model call — a top-level maxOutputTokens is a silent no-op a convenience type can endorse"
date: 2026-08-28
category: integration-issues
module: apps/mastra
problem_type: integration_issue
component: assistant
severity: medium
symptoms:
  - "agent.generate(prompt, { maxOutputTokens }) compiles and runs with no error, but the installed @mastra/core runtime never applies the cap — the model call is rebuilt from an explicit field list that carries only options.modelSettings, so an unrecognized top-level key is silently dropped"
  - "Output-length governance regresses to whatever the model's own default ceiling is, inflating paid per-call token spend, while any downstream consumer of the text still renders within its own bound so nothing user-facing looks broken"
  - "TypeScript raises no error at the call site because a local structural convenience type (e.g. a *AgentLike shape) redeclares maxOutputTokens as a top-level optional field, describing an option the runtime does not read — the type checks the wrong contract"
root_cause: wrong_api
resolution_type: code_fix
framework_version: "@mastra/core 1.55.0"
related_components:
  # Sibling sites carrying the same top-level idiom — presumed same bug class,
  # UNVERIFIED per site, deliberately NOT fixed by this doc's PR (see the
  # scope decision under Prevention). Listed for discoverability, not as
  # components this fix touched.
  - "apps/mastra/src/mastra/workflows/multi-step-draft.ts"
  - "apps/mastra/src/mastra/workflows/seo-daily-audit.ts"
  - "apps/mastra/src/mastra/workflows/experience-section-route.ts"
  - "apps/mastra/src/services/datadog-triage/analyze.ts"
  - "apps/mastra/src/services/support-research/analyze-support-conversation.ts"
tags:
  - mastra
  - agent-generate
  - max-output-tokens
  - model-settings
  - decoy-type
  - silent-no-op
  - token-budget
  - structural-typing
---

# agent.generate() forwards only modelSettings to the model call — a top-level maxOutputTokens is a silent no-op a convenience type can endorse

## Problem

The seeker follow-ups generator (feat-366 U1) passed its output cap as a top-level `maxOutputTokens` option to `agent.generate()`. The installed `@mastra/core` 1.55.0 runtime never reads that slot — its model call is rebuilt from an explicit field list that carries only `options.modelSettings` — so `FOLLOW_UPS_MAX_OUTPUT_TOKENS` (300) bounded nothing. The local structural type used at the call site declared the same unread slot, so TypeScript actively endorsed the mistake.

## Symptoms

**There were none.** That is the whole teaching point, and it is what makes this class of bug expensive to find:

- `tsc --noEmit` green — the option was declared on the call-site type, so it typechecked perfectly.
- Lint green. The full `apps/mastra` suite green.
- The generated output looked correctly bounded at every observation point, because it _was_ bounded — by the 2.5s abort budget (`FOLLOW_UPS_GENERATION_BUDGET_MS`, `apps/mastra/src/mastra/seeker-follow-ups-generate.ts:230-237`) and by the downstream parse/projection caps (`parsePostHocFollowUps` → `projectFollowUps`, applied at `seeker-follow-ups-generate.ts:287-289`). Rendered chips never differed by a single character.
- Production logs actively masked it (session history): observed `gen_tokens_out` values ran 52–99 tokens — far under the intended 300 cap — because the generator's own prompt ("under 15 words each") suppressed exactly the long replies that would have exposed the inert cap. Every green production run was silent on whether the cap worked, not evidence that it did.
- The only real cost was **paid provider tokens**: a runaway emission would run until the model stopped or the 2.5s budget cut it, and every token in that window is billed.

Detection came from **reading the installed dist**, not from any signal the repo produced. Nothing in the codebase could have gone red.

## What Didn't Work / Why nothing caught it

**TypeScript endorsed the bug.** The call goes through a narrow structural convenience type, `FollowUpsAgentLike`, declared locally so tests can drive the seam with a fake agent. Before the fix, that type declared `maxOutputTokens?: number` at the top level of the options object. A structural type is a _claim about the runtime_, and this one was a decoy: it described an option slot the runtime does not honor. Because the type asserted the slot existed, passing it compiled cleanly — the compiler's answer was "yes, that is a valid option", when the truthful answer was "that option is discarded".

**No test could have gone red.** No test in the suite referenced `maxOutputTokens` in any form. More important: a _behavioral_ test could not have caught it even if one had been written, because the observable output was bounded elsewhere. Assert on the questions, the token counts, the timing, the rendered chips — every one of them is identical whether the cap is delivered or dropped. The only assertable fact is **what was handed to the seam**, which is a wiring assertion, not a behavioral one.

**The repo's own idiom made the wrong spelling look canonical.** `apps/mastra/src/mastra/budgets.ts` documents the house pattern in prose, five times over: "per-step `maxOutputTokens` passed to `agent.generate({ maxOutputTokens })` inside each workflow step's `execute` body" (`budgets.ts:28-30`, repeated at `:52`, `:67`, `:82`, `:89`). A developer wiring a new cap reads that, copies the spelling, and has every reason to believe it is the reviewed house convention. The idiom propagated the bug faster than review could catch it.

## Solution

The fix shipped in the same PR as this doc (the PR is linked from the "Post-U1 fix" note in the feat-366 ticket, `docs/roadmap/ai-chat/feat-366-seeker-follow-up-questions.md`).

**The seam call — move the cap to the honored slot.**

Before:

```ts
const output = await agent.generate(seamInput.prompt, {
  abortSignal: seamInput.abortSignal,
  maxOutputTokens: FOLLOW_UPS_MAX_OUTPUT_TOKENS, // never read
  requestContext: seamInput.requestContext,
  tracingOptions: seamInput.tracingOptions,
})
```

After (`apps/mastra/src/mastra/seeker-follow-ups-generate.ts:242-253`), with the dist fact recorded at the call site:

```ts
// The cap MUST ride modelSettings: the runtime never reads a top-level
// maxOutputTokens — generate() spreads the caller's options wholesale,
// but the model call is rebuilt from an explicit field list that
// carries only modelSettings, so a top-level key is a silent no-op
// (verified 2026-08-28 vs @mastra/core 1.55.0 dist; re-verify on
// bumps). Pinned by the modelSettings tests in the sibling suite.
const output = await agent.generate(seamInput.prompt, {
  abortSignal: seamInput.abortSignal,
  modelSettings: { maxOutputTokens: FOLLOW_UPS_MAX_OUTPUT_TOKENS },
  requestContext: seamInput.requestContext,
  tracingOptions: seamInput.tracingOptions,
})
```

**The type — delete the decoy, so the bug class becomes a compile error.** `FollowUpsAgentLike` (`seeker-follow-ups-generate.ts:102-117`) now declares `modelSettings?: { maxOutputTokens?: number }` and no top-level slot, carrying its own rationale:

```ts
/** Narrow generate surface of the generator agent (structural for tests).
 * Deliberately declares NO top-level `maxOutputTokens`: the runtime never
 * reads that slot (see the dist-fact comment at the default seam), so
 * declaring it would let the cap silently revert to a no-op. The honored
 * home is `modelSettings`. */
```

Reintroducing the old spelling at this seam now fails `tsc` with TS2353 ("Object literal may only specify known properties, and 'maxOutputTokens' does not exist in type …") rather than compiling into an inert cap — verified by deliberate falsification on 2026-08-28 (top-level key re-added, typecheck went red at the seam, restore confirmed byte-identical).

**Two test pins** (`apps/mastra/src/mastra/seeker-follow-ups-generate.test.ts:362-402`), in a describe block whose header carries the same dated dist fact.

A captured-options test at the seam, driven through the `agent` override with a structural fake — it asserts both the presence of the honored slot and the _absence_ of the decoy (`seeker-follow-ups-generate.test.ts:378-383`):

```ts
expect(captured?.modelSettings).toEqual({
  maxOutputTokens: FOLLOW_UPS_MAX_OUTPUT_TOKENS,
})
// A top-level key here is silently dropped: the model call is rebuilt
// from an explicit field list that carries only modelSettings.
expect(captured && "maxOutputTokens" in captured).toBe(false)
```

And a source-text pin (comments stripped first, so a comment mentioning either spelling cannot satisfy or break it) with an anti-revert companion (`seeker-follow-ups-generate.test.ts:386-401`):

```ts
expect(withoutComments).toMatch(
  /modelSettings:\s*\{\s*maxOutputTokens:\s*FOLLOW_UPS_MAX_OUTPUT_TOKENS,?\s*\}/,
)
// Anti-revert companion: no top-level spelling anywhere outside comments.
expect(withoutComments).not.toMatch(
  /^\s*maxOutputTokens:\s*FOLLOW_UPS_MAX_OUTPUT_TOKENS/m,
)
```

**Red-then-green.** Both tests were written first against the unfixed code and failed exactly as predicted — the captured options carried the top-level key and no `modelSettings` at all — then went green after the fix. All four verifications ran clean — `pnpm --filter @forge/mastra test`, `typecheck`, `lint`, and `build` — and a second session independently re-verified the tree.

## Why This Works

The mechanism is in the installed dist, not in documentation, and it has two layers. `Agent.generate()` itself spreads the caller's options wholesale (`const loopOptions = { ...mergedOptions }`, `agent-0y2cApTZ.js:37095`), so the top-level key survives into the loop options — but nothing ever reads it there. The model call downstream is rebuilt from an explicit field list, and the only cap-carrying field it includes is `modelSettings: { ...options.modelSettings || {} }` (`agent-0y2cApTZ.js:32168`). A key sitting at the top level of the options bag is dropped on the floor with no warning, no error, and no log line.

The empirical corroboration is blunt and cheap to re-run — and it has two halves, because a zero count alone is equally consistent with the fix working (the top-level slot unread) and with the fix having gone inert (`modelSettings` no longer forwarded). On any `@mastra/*` bump, run both:

```
# Half 1 — the top-level slot is still unread (expect :0 on every chunk):
grep -c maxOutputTokens \
  node_modules/.pnpm/@mastra+core@*/node_modules/@mastra/core/dist/agent-*.js

# Half 2 — the honored forward still exists (expect at least one hit):
grep -n "options.modelSettings" \
  node_modules/.pnpm/@mastra+core@*/node_modules/@mastra/core/dist/agent-*.js
```

(The dated observation behind these: on 1.55.0 the counts are 0 across all three agent chunks — `agent-0y2cApTZ.js` and its siblings — and the forward line sits at `agent-0y2cApTZ.js:32168`. Keep the version and chunk-hash coordinates in prose like this, not in the command: both change on exactly the bump that triggers re-verification.)

**Verified 2026-08-28 against `@mastra/core` 1.55.0, by two sessions independently reading the dist before the finding was treated as settled fact (session history). Re-verify on any `@mastra/*` bump** — a future version could start honoring the top-level slot, at which point the anti-revert pin becomes over-strict rather than wrong, and the dist-fact comment is what tells the next reader to go look.

This is the repo's standing law on empirical mechanism claims, applied here: a claim about what a _dependency_ does must be verified at its own layer and stamped with date and version, because no test at the caller's layer can contradict it. Every existing test in this suite asserted on the generator's _output_; the fault lived one layer down, where none of them could see. The captured-options test is the fix for that specifically — it asserts at the layer where the claim lives (what crosses the seam), which is why it could go red.

## Prevention

**A narrow structural convenience type must not declare option slots it has not verified against the runtime.** A decoy slot is strictly worse than no type at all: with no type you get a compile error and go read the real signature; with a decoy you get a green build and an inert setting. Declare only the slot the runtime actually honors, and say why in a doc comment on the type — the comment is what stops the next person "helpfully" widening it back.

**When wiring a numeric cap, limit, or budget, prove DELIVERY — not presence.** "The constant is referenced at the call site" is not evidence the cap took effect. The discriminating test is a captured-options assertion at the seam that pins the honored slot **and** asserts the decoy slot is absent. Both halves are load-bearing: the positive half alone stays green if someone later adds the top-level key back _alongside_ the correct one, which is precisely the confused state a partial revert produces.

**Record the dist fact at the call site**, dated and version-stamped, pointing at the test that pins it — as done at `seeker-follow-ups-generate.ts:242-247` and mirrored in the test describe header. This repo already uses the convention for other pinned `@mastra/*` behaviors (`__registerMastra`, the `p-retry` signal threading, the empty-instructions truthiness guard); an output-cap slot is the same class of fact.

**Quiet logs are not evidence a cap works.** The production observations (52–99 output tokens) sat comfortably under the 300 cap because the prompt asked for short output — so the metric could never discriminate a working cap from an inert one (session history). A cap whose normal traffic never approaches it is unverifiable from telemetry alone; the seam-level test is the only guard that can go red.

### Scope decision (recorded verbatim)

The same top-level `maxOutputTokens` idiom exists at **five other `apps/mastra` sites**:

- `apps/mastra/src/mastra/workflows/multi-step-draft.ts` (option type at `:183`, threaded param at `:273`, passed at `:285`)
- `apps/mastra/src/mastra/workflows/seo-daily-audit.ts` (option type at `:82`, passed at `:225`)
- `apps/mastra/src/mastra/workflows/experience-section-route.ts` (option type at `:118`, passed at `:291`)
- `apps/mastra/src/services/datadog-triage/analyze.ts` (option type at `:40`, passed at `:135`)
- `apps/mastra/src/services/support-research/analyze-support-conversation.ts` (option type at `:18`, passed at `:81`)

These are **presumed to be the same inert-cap class but are UNVERIFIED per site**, and they were **deliberately not fixed in this PR**: they belong to other owners' surfaces, and each fix needs its own per-site dist verification (the call path may differ) plus its own test derivation. **No follow-up ticket and no `todos/` entry was filed** — operator decision, 2026-08-28. Anyone touching one of those files should verify their own call path against the installed dist and apply the recipe above.

Two adjacent facts worth knowing (session history): `apps/mastra/src/mastra/workflows/title-repair.ts` (feat-405 U4) is NOT on the open list — it briefly carried the same top-level spelling during implementation and was self-corrected to `modelSettings` at verification time, the first catch of this pattern in the arc. And `apps/mastra/src/mastra/budgets.ts` doc comments still describe the top-level `agent.generate({ maxOutputTokens })` idiom as the house pattern (`budgets.ts:28-30`, `:52`, `:67`, `:82`, `:89`) — that prose is a candidate for a future refresh (it is how this bug propagated), but this doc does not edit it, since correcting it implies a claim about the five call sites those comments describe, which is exactly the per-site verification deliberately left undone.

## Related Issues

- `docs/solutions/best-practices/mastra-model-entry-timeout-retry-and-stream-abort-pattern.md` — sibling: same module, same method (reading the installed `@mastra/core` dist to pin the generate-options envelope); it pins the retry/timeout half of that envelope, this doc pins the output-cap half.
- `docs/solutions/best-practices/mocked-shape-vs-real-contract-discipline-20260506.md` — the META family this is a worked instance of: a local type/test describing a shape the runtime does not honor, caught only by verifying at the dependency's own layer.
- `docs/solutions/best-practices/settle-caller-promise-on-every-budget-race-helper-exit-path.md` — same source file and feature (feat-366 U1 follow-ups generator), different bug from the same review arc.
