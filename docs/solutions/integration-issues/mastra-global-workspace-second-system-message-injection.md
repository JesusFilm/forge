---
title: "Mastra's global Workspace silently injects a second system message that breaks strict-template model gateways"
date: "2026-08-12"
category: "integration-issues"
module: "apps/mastra"
problem_type: "integration_issue"
component: "assistant"
symptoms:
  - "Seeker chat sends against the self-hosted AI Gateway's coding model slot failed with HTTP 400 System message must be at the beginning"
  - "The outgoing message array carried two system messages: the agent's own instructions plus an auto-injected Devotional Workspace storage line"
  - "Every registered Mastra agent inherited the global Devotional Workspace even though no agent declared one of its own"
  - "The same duplicate system message occurred in local dev too, but OpenRouter and OpenAI tolerated it silently, so only the stricter self-hosted gateway surfaced the defect"
  - "No test called workspace.getInstructions() on any backend, so the injected-instructions surface had zero coverage"
root_cause: "scope_issue"
resolution_type: "code_fix"
severity: "high"
related_components:
  - "Devotional Workspace"
  - "@mastra/core"
  - "@mastra/s3"
  - "ai-gateway.jesusfilm.org"
tags:
  - "mastra"
  - "workspace"
  - "system-message"
  - "prompt-injection"
  - "ai-gateway"
  - "seeker-agent"
  - "s3-filesystem"
  - "devotional-workspace"
---

# Mastra's global Workspace silently injects a second system message that breaks strict-template model gateways

## Problem

Registering a Mastra `Workspace` **globally** on the `Mastra` instance is not just
a storage change — it is a **prompt change for every registered agent**. On
2026-08-12 that surfaced as a total failure of the Seeker's primary (gateway)
model path in production.

The mechanism has three links, each independently verifiable in
`@mastra/core@1.55.0`:

1.  **The global workspace is inherited by every agent that declares none.**
    `apps/mastra/src/mastra/index.ts:274` passes
    `workspace: devotionalWorkspaceRuntime.workspace` to the `Mastra` constructor.
    `Agent.getWorkspace` (dist `agent-0y2cApTZ.js:33664`) returns the agent's own
    workspace when `this.#workspace` is set, and otherwise falls through to
    `const globalWorkspace = this.#mastra?.getWorkspace()` (`:33688`). **No agent in
    `apps/mastra` declares a workspace**, so every one of them — `seekerAgent`,
    `smokeAgent`, `webResearchAgent`, `seoMarketingAgent`, `supportResearchAgent`,
    the experience draft/chat family, all of them — resolved the devotional
    Workspace.

2.  **A workspace with a filesystem auto-adds a system-message processor.**
    `Agent.getWorkspaceInstructionsProcessors` (`:33209`) resolves the workspace,
    checks `hasFilesystemConfig`/`hasSandboxConfig`, and — unless the caller already
    configured a processor whose `id` is exactly `workspace-instructions-processor`
    — returns `[new WorkspaceInstructionsProcessor({ workspace })]` (`:33216`). It is
    wired into the run at `:33449`. Nothing opts in; having a filesystem _is_ the
    opt-in.

3.  **That processor emits a second `role: "system"` message.**
    `WorkspaceInstructionsProcessor.processInputStep` (`:17682`) reads
    `getInstructionsAsync` (or `getInstructions`) off the workspace and then
    (`:17684`):

        if (instructions) messageList.addSystem({ role: "system", content: instructions })

    The text comes from the filesystem provider. `@mastra/s3@0.6.0`
    (`dist/index.js:192-196`) hardcodes it with no constructor override
    (`providerName` is `this.displayName || "S3"`):

        `${providerName} storage in bucket "${this.bucket}". ${access} storage - files are retained across sessions.`

So from PR #1796 (merged 2026-08-01) onward, **every turn of every
agent carried two system messages**, the second one naming the production
devotional S3 bucket.

Most providers tolerate that — and so did the gateway's `coding` slot at
first. The injection was **latent for the first week**: Langfuse traces from
2026-08-07 show the then-current slot model completing real answers (181 and
550 output tokens, usage-verified) with the duplicate system message present.
Between 2026-08-07 06:07 UTC and 2026-08-09 19:50 UTC (the next traced turn)
the slot's model was swapped (per the teammate's 2026-08-12 gateway diagnosis:
to Qwen3.6-35B-A3B on the team GPU box; the box's model changes over time, so
tracked repo references to the slot's model may lag). The new model enforces a
one-system-message chat template and rejects the request outright — after the
swap, not a single `coding` generation appears in any trace. Because feat-237
puts the gateway model **first** in the Seeker's `ordered-fallback` chain, the
seeker's primary model 400'd on every post-swap send. The fallback chain
absorbed it exactly as designed, with one wrinkle: the primary Gemma fallback
(31b, free tier) was **rate-limited (OpenRouter 429) on every traced
attempt**, so every post-swap answer was written by the second fallback
(`gemma-4-26b`). Users saw fallback replies, not outages; the user-visible
cost was per-send burn on a dead primary leg, Railway error noise, and the
lost gateway routing. (Deployment `9823ec4e` logs and Langfuse traces align
on this event-for-event: gateway 400 → 31b 429 → 26b answer, at
23:13:47/58 and 23:26:16 UTC on 2026-08-11.)

There is a second, quieter problem that outlives the 400: the injected line ships
the production bucket name to **every model provider on every turn of every
agent** — OpenRouter, OpenAI, and the gateway alike — and into **raw** Langfuse
traces for `/forge-seeker` turns specifically, when `LANGFUSE_TRACING_ENABLED`
is `"true"` (only seeker-route runs carry the per-process marker that routes
them to the unredacted `langfuse-seeker` observability config; every other
agent's spans go to the default config, whose `redactPromptBodies` processor
blanks message bodies — `apps/mastra/src/mastra/langfuse-tracing.ts` +
`index.ts`). That is an infrastructure-detail leak on channels nobody designed
as disclosure surfaces.

## Symptoms

_(Incident observations below are attributed to the 2026-08-12 session, the
teammate reproduction, and the 2026-08-13 read-only production-evidence sweep
(Langfuse API + Railway deployment logs); the framework behavior above and the
fix below are verifiable from the tree.)_

- **Every post-swap seeker send's gateway leg returned HTTP 400** with
  `OpenAIException - System message must be at the beginning.` From the
  2026-08-07→09 model swap onward the gateway-leg failure was total, not
  intermittent, and independent of prompt content; before the swap the same
  requests (duplicate included) completed.

- **The captured request shape showed two leading system messages**, which is
  exactly the injection:

      messages[0]  system   <seeker system instructions>
      messages[1]  system   Devotional Workspace storage in bucket "…". Persistent storage - files are retained across sessions.
      messages[2]  user     <the seeker's question>

- **Deterministic reproduction against the gateway** (by Ekkasit): two system
  messages → 400; the _same_ content merged into one system message → 200. The
  content was never the issue; the message _count_ was.

- **Silent everywhere else.** OpenAI and OpenRouter accept multiple system
  messages, so the default free-Gemma chain masked the injection completely. Local
  dev had the same defect (via `LocalFilesystem`, whose instructions are also
  non-empty) and also showed nothing. Only production **plus** a strict
  one-system-message model surfaced it — eleven days after the change merged,
  and only because the mid-window model swap installed a strict model on a
  previously tolerant slot.

- **Leak (no error signal at all):** the production bucket name crossing to every
  model provider on every turn, and into raw Langfuse traces for seeker-route
  turns when tracing is on (other agents' spans are redacted by the default
  observability config — see the scoping in Problem above). Nothing fails;
  nothing logs; it simply leaves.

  **Correction, since the wrong version of this claim is easy to reach:** this does
  **not** leak via Mastra's `/api/agents*` surface. That surface serializes
  `agent.getInstructions(...)` — the agent's own instructions — while the workspace
  line is added to the _per-run_ `messageList` inside `processInputStep`
  (`agent-0y2cApTZ.js:17682-17685`), which never touches `getInstructions()`. An
  earlier framing of this incident asserted the `/api/agents*` leak and was
  falsified during verification. The leak is real; its channel is the model
  providers and the trace store, not the agent-serialization route.

## What Didn't Work

Four in-code alternatives were considered and rejected before the shipped seam,
plus one infrastructure-side fix that is orthogonal rather than wrong.

- **Pass `instructions: ""` to `S3Filesystem`.** This is the idiom the framework
  itself documents, but **the option does not exist on `S3FilesystemOptions`** —
  neither in the types nor at runtime. `@mastra/s3@0.6.0`'s `getInstructions()`
  (`dist/index.js:192-196`) is a hardcoded template literal with no override path.
  Only core's
  `LocalFilesystem` has it (`@mastra/core/dist/workspace/filesystem/local-filesystem.d.ts:60-69`,
  where the doc comment explicitly says _"Pass an empty string to suppress
  instructions entirely"_). Fixing only the local backend would have left
  production — the one environment that was actually broken — untouched.

- **Suppress at the `Workspace` level.** `WorkspaceOptions.instructions` looks like
  the natural lever, but it is not a suppression switch: it is
  `{ dynamicSandbox?: DynamicSandboxInstructions }` and nothing else
  (`@mastra/core/dist/workspace/workspace.d.ts:114-121`). It governs how a
  _resolver-backed sandbox_ contributes text; no option suppresses the
  filesystem's contribution. On the no-sandbox branch (this Workspace today),
  `Workspace.getInstructionsForProviders` consults
  `filesystem?.getInstructions?.(opts)` and pushes any non-empty result
  (`workspace-kJgXwpJp.js:6970-6971`) — and note the branch is itself
  conditional: with a sandbox that has mounts, the composition never calls
  `filesystem.getInstructions()` at all and builds lines from
  `entry.filesystem.displayName` instead (see Prevention 3).

- **Per-agent opt-out via `workspace: () => null`.** This _does_ work mechanically:
  `getWorkspace` resolves the function, sees a falsy result, and returns undefined
  (`agent-0y2cApTZ.js:33670-33678`). Note that a plain `workspace: undefined`
  does **not** work — `if (this.#workspace)` is falsy and control falls straight
  through to the global. Rejected anyway on scaling: it must be repeated on every
  agent that exists today **and every agent added later**, with the failure mode
  being a silent regression on a surface no test watches. It also does not cover
  the durable-agent injection site (below).

- **Register a per-agent input processor with `id: "workspace-instructions-processor"`.**
  The auto-add is skipped when a configured processor already carries that id
  (`:33215`). Same per-agent scaling problem, plus it is **order-dependent on an
  internal contract** — a private id string in a bundled dist file, with no public
  guarantee it stays stable across `@mastra/*` bumps.

- **Merge system messages server-side in the GPU box's chat template.** This fixes
  the 400 for every client of that gateway and is a genuinely good idea. It is not
  the app fix: it still sends the bucket name to the model, leaves any other strict
  backend exposed, and has to be redone on every model swap. Treat it as an
  orthogonal defense, not a substitute.

## Solution

**Suppress the instructions at the repo-owned `AuditedFilesystem` wrapper.**

`apps/mastra/src/services/devotional/workspace/audited-filesystem.ts:124-142`:

```ts
getInstructions() {
  // Deliberately suppressed — the wrapper's one divergence from its
  // delegate's contract. …
  return ""
}
```

Previously this method delegated
(`return this.delegate.getInstructions?.(options) ?? ""`). Now it returns `""`
unconditionally, with a comment that names the incident, the mechanism, and the
coupled half of the decision.

Four properties make this the right seam:

1. **It is the single composition point.** Every storage backend — S3, local, and
   the `UnavailableFilesystem` — is produced by `createStorageRuntime`
   (`config.ts:383-438`) and then wrapped exactly once:
   `new AuditedFilesystem(baseFilesystem, auditSink, …)` at `config.ts:286-291`,
   before the `Workspace` is constructed at `config.ts:315-334`. Nothing reaches
   the `Workspace` unwrapped, so one edit covers every resolution branch of
   `resolveDevotionalWorkspaceConfig` (`config.ts:107-162`) with no per-branch
   duplication and no gap for a future backend.

2. **Empty string is the framework's own suppression idiom.** Both injection sites
   guard with a plain truthiness check — `if (instructions)` in the processor
   (`agent-0y2cApTZ.js:17684`) and `if (wsInstructions)` in the durable-agent path
   (`create-durable-agent-DH_dWTMR.js:458`) — so `""` skips `addSystem` entirely
   rather than adding a blank message. And core's own `LocalFilesystem` docs bless
   it verbatim (`local-filesystem.d.ts:65`).

3. **It covers both injection sites, including the one with no repo usage today.**
   `create-durable-agent-DH_dWTMR.js:452-462` re-implements the same logic in the
   durable-agent path. Nothing in this repo builds a `DurableAgent` right now, but
   the suppression is at the filesystem — so if one is ever added, it inherits the
   fix instead of re-discovering the bug.

4. **Nothing loses a capability.** The description exists to tell an agent how to
   use file tools it has. This Workspace disables inherited tools
   (`config.ts:333`, `tools: { enabled: false }`), so no agent could act on the
   description even if it received it. Devotional business logic reads the
   Workspace through typed repository code, not through agent tools.

**The coupling is written down at the other end.** `config.ts:322-332` now carries
the reciprocal comment at the `tools: { enabled: false }` line — enabling file
tools means revisiting the suppression _in the same change_. The two halves are
only jointly correct: tools-off + instructions-off is coherent; tools-on +
instructions-off would ship tools the prompt never mentions.

**Three discriminating test pins**, deliberately designed to be non-vacuous:

- `audited-filesystem.test.ts:184-198` — _"suppresses delegate prompt
  instructions"_. It wraps a real `LocalFilesystem` and asserts
  `expect(delegate.getInstructions?.()).toBeTruthy()` **before**
  `expect(filesystem.getInstructions()).toBe("")`. The first assertion is the
  anti-vacuous guard: it proves the delegate genuinely describes itself, so the
  empty result can only come from the wrapper's suppression. Without it, the test
  would pass just as happily against a delegate that returns `""` on its own.

- `config.test.ts` — _"yields no Workspace instructions on either
  resolution path"_. It builds the real runtime through
  `createDevotionalWorkspaceRuntime` (the test `environment()` has `s3: {}` and
  `nodeEnv: "test"`, so it takes the **local** branch at `config.ts:131-132` and
  wraps a real `LocalFilesystem` whose instructions are non-empty) and asserts on
  **both** surfaces the processor reads:
  `runtime.workspace.getInstructions()` and
  `await runtime.workspace.getInstructionsAsync()`. Asserting only the sync one
  would leave the async path — the one the processor actually prefers — unpinned.

- `config.test.ts` — _"adds no system message through the real
  workspace-instructions processor"_ (added on review: the two string pins alone
  left the protective OUTCOME unpinned — a `@mastra/*` bump that composed a
  default description on empty text would have re-injected with a green suite).
  It drives the REAL `WorkspaceInstructionsProcessor` (imported from
  `@mastra/core/processors`) on both sides of its truthiness guard: a raw,
  unwrapped `LocalFilesystem` workspace must yield exactly ONE system message
  (the positive control proving the mechanism is live), and the devotional
  runtime's workspace must yield ZERO. This is the CI guard for the pinned dist
  fact the whole fix rests on.

**The two string pins were falsified once.** Reverting the suppression to
delegation turned both red; restoring it turned both green. The processor pin
carries its own built-in falsification via the positive control.

## Why This Works

The injection is `if (instructions) messageList.addSystem(...)`. Returning `""`
makes that condition false at both call sites, so no second system message is ever
constructed — not a blank one, not a whitespace one. The gateway sees exactly one
system message and accepts the request; the bucket name never enters the payload,
so the leak closes on the same edit.

The seam choice is what makes it durable rather than incidental. The fix does not
sit on the S3 backend (which would leave local dev broken and would not have been
expressible anyway — the option does not exist), nor on any individual agent
(which would need repeating forever and would miss the durable-agent path), nor on
the `Workspace` (which has no such lever). It sits at the **one place every
backend passes through on its way to this `Workspace`**, so it is correct by
construction for every storage backend `createStorageRuntime` produces and for
every agent that inherits the global workspace — including agents nobody has
written yet, which is precisely the population the per-agent alternatives would
have failed. The honest scope limit: a future **per-agent** workspace
(`new Agent({ workspace: ... })`) never passes through `AuditedFilesystem` —
`Agent.getWorkspace` returns the agent's own workspace before consulting the
global — so it would reintroduce both the 400 and the leak with green CI.
Prevention 1's review trigger covers that case.

`Workspace.getInstructionsForProviders` joins provider parts with `"\n\n"`
(`workspace-kJgXwpJp.js:6973`); with the filesystem contributing nothing and no
sandbox configured, the join produces `""`, which is why the whole-composition
assertion in `config.test.ts` is meaningful and not merely re-asserting the unit
test one layer up.

## Prevention

**0. Containment for the already-emitted copies (dispositions recorded).**
The code fix closes the leak _forward_; it does nothing about the copies emitted
during the exposure window (2026-08-01 deploy → the day this fix deploys;
authored 2026-08-12). Dispositions: (a) **Langfuse** — tracing WAS enabled
during the window (verified 2026-08-13 by read-only API sweep): the affected
set is **seven seeker-turn traces** in the `forge-mastra` project (2 on
2026-08-07, 2 on 08-09, 1 on 08-10, 2 on 08-11), each carrying the bucket-name
line in its `model_step` and processor span data; the two 2026-07-29 traces
predate the injection and are clean. **Decision (owner, 2026-08-13): leave
them to the feat-336 25-day retention sweep**, which deletes them on its own
schedule (the earliest, from 2026-08-07, age out around 2026-09-01); the
sweep's own `oldest_age_days` / `retention_wall_risk` reporting is the
liveness backstop. (b) **Model providers** (OpenRouter free-tier Gemma,
OpenAI, the self-hosted gateway) — the bucket name is unrecoverable there;
no-action recorded, noting that the free-tier route's retention/training
posture differs from the paid ones.

**1. Registering ANY `Workspace` with a filesystem is a prompt-surface change.**
This is the general law, and it is not obvious from the API — `new Mastra({ workspace })`
reads as configuring storage. Treat any change that adds or repoints a workspace
carrying a filesystem — **global, or per-agent via `new Agent({ workspace })`,
which bypasses `AuditedFilesystem` entirely** (`Agent.getWorkspace` resolves the
agent's own workspace before the global) — as touching the affected agents'
system prompts, and review it on
that axis: what text does the filesystem's `getInstructions()` produce, does it
contain infrastructure identifiers (bucket names, endpoints, paths, credentials-
adjacent detail), and is there any agent whose provider is strict about system-
message count? The same reasoning applies to any framework feature that injects
into `messageList` behind a capability check rather than an explicit opt-in — grep
for auto-added processors when adopting one.

**2. Know why your tests were blind, not just that they were.**
Two independent blindnesses stacked here, and both are reusable warnings:

- _No test exercised the workspace's composed instructions at all._ The existing
  `config.test.ts` suite constructed real runtimes (local and S3 backends) but
  never called `workspace.getInstructions()` on any of them — the surface simply
  had zero coverage, so nothing could have gone red when the injection appeared.
  (An earlier framing of this incident claimed the tests were _vacuously_ green
  via a degenerate `UnavailableFilesystem` fixture; grounding validation
  falsified that — no test file references that class, and the one test hitting
  the `unavailable` branch never constructs a filesystem. The gap was untested,
  not vacuously tested.) The three new pins are the first coverage of this
  surface, and the `config.test.ts` string pin drives the **local** branch,
  where the delegate is non-empty and only the suppression can produce `""`.
- _Tolerant providers masked the defect in dev._ Local dev had the identical
  two-system-message payload via `LocalFilesystem` and never once errored, because
  OpenAI/OpenRouter accept it. **A permissive default provider is not evidence of a
  well-formed request.** When a fallback chain mixes providers with different
  strictness, the strictest one is the contract — exercise it, or accept that
  production is where you will discover the difference.

**3. Two future changes require revisiting the suppression in the same PR: enabling
file tools, and adding a sandbox.**
`tools: { enabled: false }` (`config.ts:333`) and `getInstructions() => ""`
(`audited-filesystem.ts:141`) are two halves of one decision. Each now carries a
comment pointing at the other. If a future change enables tools for an agent, the
suppression must be reconsidered _in that PR_ — and restoring the description
must independently resolve BOTH original harms: the strict-gateway constraint
(the merge fix on the gateway — itself per-model-swap maintenance, per What
Didn't Work — or a one-system-message-safe composition) AND the
infrastructure-detail disclosure (the description must not carry the bucket
name or other identifiers to model providers and seeker-route Langfuse traces).
**Adding a `sandbox` to this Workspace is the second coupled trigger**, and a
sneakier one: a sandbox contributes its own instructions part independent of
the filesystem, and a sandbox WITH mounts takes a composition branch that never
calls `filesystem.getInstructions()` at all — it builds lines from
`entry.filesystem.displayName` (which `AuditedFilesystem` forwards unchanged),
so the suppression is bypassed, not consulted. The whole-composition and
processor-level pins in `config.test.ts` go red if a sandbox makes the
composition non-empty — that red is this doc's signal, not a flaky test.

**4. Re-verify the empty-instructions guard on every `@mastra/*` bump.**
The fix rests on a pinned dist behavior: `if (instructions)` / `if (wsInstructions)`
at `agent-0y2cApTZ.js:17684` and `create-durable-agent-DH_dWTMR.js:458`. If a
future version drops the truthiness guard, or starts composing a default
description when the provider returns empty, the suppression silently stops
suppressing — and the failure reappears in production, on the gateway, with green
CI. Two mitigations shipped: the processor-level pin (third test above) turns
the standard-agent half of that regression into a red test, and the pin sites
carry the repo's "re-verify on `@mastra/*` bumps" marker
(`audited-filesystem.ts` comment + `apps/mastra/CLAUDE.md`) so dependency-bump
sweeps find it alongside the other pinned-dist-fact items (`@mastra/pg`
fail-mode, `recall` ordering, the stored `tool-invocation` part shape). The
durable-agent injection site remains covered by the marker only — no repo code
constructs a `DurableAgent` today.

**5. Upstream: an `instructions` option on `S3Filesystem` is a reasonable PR.**
Core already has the whole machinery — `InstructionsOption` and the resolve path
exist for `LocalFilesystem`, documented down to the empty-string suppression
semantics. `@mastra/s3` simply hardcodes its template instead. Checked
`@mastra/core@1.57.0` and `@mastra/s3@0.6.1-alpha.1` (latest published as of
2026-08-12, session-verified): **no first-class disable exists upstream**, so the
wrapper seam is the correct fix today and would remain a valid belt-and-braces
even if the option lands.

## Related Issues

- [Mastra runtime upgrade — devotional Workspace boundaries](./mastra-runtime-upgrade-devotional-workspace-boundaries.md)
  — same PR #1796 feature area and module; a different set of integration defects
  found in PR review. Its validation checklist did not (and could not) catch this
  incident: none of its checks exercised a non-devotional agent's outbound message
  array against a strict provider.
- [Mocked shape vs real contract discipline (META)](../best-practices/mocked-shape-vs-real-contract-discipline-20260506.md)
  — this incident's test-blindness pair (a composed prompt surface with zero
  test coverage, plus tolerant providers masking the wire shape in every
  environment) is adjacent to that META pattern's family.
- [Mastra model-entry timeout/retry and stream-abort pattern](../best-practices/mastra-model-entry-timeout-retry-and-stream-abort-pattern.md)
  — same seeker/gateway subsystem; same discipline of verifying `@mastra/core`
  dist behavior empirically instead of trusting stated assumptions.
- [Mastra inline gateway construction via createRequire](../conventions/mastra-inline-gateway-construction-createrequire.md)
  — orientation for the file area where the affected agents construct their
  gateway/model providers.
- PR #1796 — `feat(mastra): add devotional Workspace data plane` (introduced the
  global registration; merged 2026-08-01). No GitHub issue tracks this incident
  as of this writing; the diagnosis arrived via Railway error logs and a
  teammate's gateway reproduction.
