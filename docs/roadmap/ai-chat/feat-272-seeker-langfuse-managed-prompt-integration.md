---
id: "feat-272"
title: "Seeker Langfuse-managed prompt integration (consume getManagedPrompt)"
owner: "jaco"
priority: "P2"
status: "in-progress"
start_date: "2026-08-17"
duration: 3
depends_on:
  - "feat-296"
blocks: []
tags:
  - "ai-pipeline"
  - "infrastructure"
---

## Problem

The Langfuse prompt-retrieval helper shipped standalone (plan
`docs/plans/2026-07-20-001-feat-langfuse-prompt-helper-plan.md`, U1–U4):
`apps/mastra/src/services/langfuse-prompt-client.ts` — `fetchLangfusePrompt`
(no-throw result-union fetch of a named, label-resolved text prompt) +
`getManagedPrompt` (TTL cache, failure cooldown, serve-stale, single-flight,
caller-supplied fallback with provenance). At creation time nothing consumed
it: the seeker agent's system prompt was still an inline string in
`seeker-agent.ts`, in this public repo — and the whole reason the helper
exists is that tuned prompt text must not live here. **[UPDATED 2026-07-29]**
Item 1 (the seeker wiring) has since landed: `seeker-agent.ts` backs its
`instructions` with `getManagedPrompt` (prompt name `seeker-system`) through
`createSeekerInstructionsResolver`, with the full inline text preserved as
the compiled-in fallback constant `SEEKER_SYSTEM_PROMPT_FALLBACK`. Items 3–5
remain open.

The helper shipped OUTSIDE this roadmap (a plan-driven arc with no lane
ticket at the time; feat-303 was later created as its retroactive record, and
this ticket's one `depends_on` is feat-296, the provisioning ticket). It is
the tracked carrier for the plan's deferred Scope Boundaries plus the
two risks the plan explicitly routed here:

- **Silent divergence.** Once wired, production can serve the compiled-in
  fallback while operators assume the tuned prompt is live. Provenance in the
  return type and the `event=prompt_fetch_failed` transition log are the
  designed hooks; sustained-fallback alerting does not exist yet.
- **Governance shift.** Once anything consumes the helper, moving a Langfuse
  label (e.g. re-pointing `production` to a different version) becomes an
  unreviewed production behavior change that bypasses PR review and CI
  entirely. There is no technical control over who may do that — see item 6.
  **[UPDATED 2026-07-29]** Under the owner's whole-prompt decision (item 2)
  there is deliberately NO code-owned remainder bounding a label move — the
  ENTIRE prompt, SAFETY line included, is Langfuse-managed. The accepted
  bounds are the small all-developer Langfuse roster (a snapshot — revisit if
  it changes) and the full working fallback in PR-reviewed code as the
  known-good rollback text. Be clear about what is NOT a bound: no control
  detects a label move to valid-but-wrong text — a moved label resolves as a
  healthy fresh `source: "langfuse"` serve, so item 5's fallback/stale
  alerting is structurally blind to it; item 5's version/source span
  stamping (open) gives post-hoc attribution ("which version served this
  turn"), not detection.

**Operational precondition — SATISFIED 2026-07-29 (feat-296 complete;
`forge-mastra` provisioned, smoke green, production env vars set).** As
originally written: no Langfuse project or keys existed anywhere in
this repo or its deploy config yet. Someone must provision **one project,
`forge-mastra`**, in the same Langfuse organisation as `JesusFilm/core`'s
Journeys project, with two key pairs (Railway + local dev) and the seeded smoke
prompt. Environments are distinguished by **labels** (`production` /
`development`), not by separate projects — the plan's KTD8 mandated
per-environment projects and was reversed on 2026-07-28; see the topology
decision in feat-296 and the supersession note beside KTD8 in the plan. This
gates BOTH the first real run of the opt-in smoke and this integration. That
provisioning + safe-env-rollout checklist is tracked in **feat-296** (this
ticket `depends_on` it).

## Entry Points — Read These First

1. `apps/mastra/src/services/langfuse-prompt-client.ts` — the two-layer
   helper; the module header documents the cache state machine and the
   no-throw/leak-control contract this ticket must not weaken.
2. `apps/mastra/src/mastra/agents/seeker-agent.ts` —
   `SEEKER_SYSTEM_PROMPT_NAME` / `SEEKER_SYSTEM_PROMPT_FALLBACK` (the full
   working prompt: SAFETY line, citation discipline; the guardrail
   attach-point breadcrumb sits below them, immediately above the
   `seekerAgent` constructor) and
   `createSeekerInstructionsResolver`, the item-1 wiring. There is no
   code-owned prompt portion — see item 2.
3. `apps/mastra/src/services/langfuse-prompt-client.test.ts` — the
   `getManagedPrompt seeker scenario (agent-instructions shape)` block: pins
   that the fallback is the FULL working prompt and that the helper does no
   composition. Under item 2's whole-prompt decision that full-prompt shape
   is permanent — there is no composed shape to re-pin to. Wiring-level
   companions live in `seeker-agent.test.ts` (feat-272 block).
4. `apps/mastra/src/services/langfuse-prompt-client.smoke.test.ts` — the
   header documents the one-time smoke seeding convention
   (`forge-mastra-smoke/text-prompt`, label `production`, text type, seeded in
   the `forge-mastra` project; never self-seeds). Must run green before
   integration starts.
5. `apps/mastra/src/config/env.ts` — the `LANGFUSE_*` group,
   `getLangfuseConfig()` (cooldown-≤-TTL clamp), and
   `assertLangfuseBaseUrlAllowedForProduction`.
6. `docs/plans/2026-07-20-001-feat-langfuse-prompt-helper-plan.md` — Scope
   Boundaries, Risks and Dependencies, and KTD8 **with its 2026-07-28
   supersession note and its 2026-07-29 amendment** (per-environment projects
   reversed to one project with labels; the protected-`production`-label
   remedy dropped as unavailable and inert — see item 6).

## Grep These

- `getManagedPrompt` / `fetchLangfusePrompt` — the helper surface.
- `event=prompt_fetch_failed` — the failure log line alerting hooks onto.
- `SEEKER_SYSTEM_PROMPT_FALLBACK` / `SEEKER_SYSTEM_PROMPT_NAME` — the wiring's
  fallback constant and compile-time prompt name in `seeker-agent.ts`.
- `SEEKER_INLINE_INSTRUCTIONS` — the scenario test's fallback fixture (a
  deliberate duplicated copy of the agent's fallback text, never an import).
- `redactPromptBodies` — the existing span processor that prompt-version
  stamping must coexist with.
- `LANGFUSE_PROMPT_DEFAULT_LABEL` — the env rung of label resolution.

## What To Build

The deferred items from the plan's Scope Boundaries, in rough order:

1. **Seeker wiring — DONE 2026-07-29.** Back the seeker agent's
   `instructions` with `getManagedPrompt` through a thin dynamic-instructions
   wrapper: `instructions: async () => (await getManagedPrompt({ ... })).text`.
   (Verified against `@mastra/core` `dist/types/dynamic-argument.d.ts`:
   `DynamicArgument<string>` accepts an async **function** returning
   `Promise<string>`, never a bare `Promise` — and `getManagedPrompt` cannot
   be assigned directly, since it takes its own options object and returns a
   `ManagedPromptResult`, not a `string`. The helper never throws, so the
   wrapper needs no error handling.) The fallback is the full current working
   prompt — never a stub. Shipped as `createSeekerInstructionsResolver` in
   `seeker-agent.ts`, prompt name `seeker-system`, no label pinned in code
   (env resolution keeps `production` on Railway / `development` locally).
2. **The composition decision — DECIDED 2026-07-29: the WHOLE prompt is
   Langfuse-managed.** The owner overruled the composition split this item
   originally prescribed (SAFETY line + `retrieveAnswer`-coupled citation
   wording code-owned, Langfuse owning only the persona portion). The ENTIRE
   `instructions` text — SAFETY line and tool-coupled wording included — is
   one Langfuse prompt, `seeker-system`; the byte-identical full text stays
   in code only as the fallback constant. Do not reintroduce a split.
   Consequences this ticket now carries: a label move can change ANY line
   including SAFETY (see item 6 and the updated Governance bullet above), and
   the `retrieveAnswer` status-literal coupling gains a copy CI cannot see —
   guarded by declaration-site comments in `retrieve-answer.ts` plus the
   pinning test in `seeker-agent.test.ts` that makes a rename/rewording loud
   and directs the editor to update the Langfuse prompt in the same change.
   Since the UI edit and the deploy can never land atomically (Langfuse
   propagates within one 60s TTL; code rides a PR + deploy), literal changes
   follow expand-then-contract: (1) publish a `seeker-system` version whose
   wording covers BOTH old and new literals and move the labels onto it;
   (2) merge and deploy the code change; (3) publish a contracted version
   dropping the old literal. Never step 2 alone.
   **Operator step (Langfuse UI — the helper is retrieval-only and must never
   gain write APIs):** create prompt **`seeker-system`** in the `forge-mastra`
   project, text type, version 1 body **byte-identical to
   `SEEKER_SYSTEM_PROMPT_FALLBACK`** in `seeker-agent.ts`, labelled BOTH
   `production` and `development`. Until it exists, every environment serves
   the byte-identical fallback (`source: "fallback"`, reason `rejected`/404 —
   one enum-only log line per cooldown window), so the wiring is safe to
   merge first; the Studio check in Verification needs the seeded prompt.
3. **Stale-while-revalidate.** Replace the blocking single-attempt refetch on
   TTL expiry with a background refresh — serve current text immediately,
   refresh out of band. Mind the helper's deliberate "no background work"
   invariant (nothing may keep the process or test runner alive today);
   whatever mechanism lands must not leak timers or wedge vitest.
   **Coupled to the retraction semantics decided at wiring:** the "label
   re-point effective within one cache TTL" figure in Constraints is a
   property of today's BLOCKING refetch. SWR serves stale on the expiry turn
   and refreshes out of band, so the bound weakens to TTL + refresh latency
   and disappears under zero traffic. Re-derive the bound and update all
   four copies (Constraints here, `apps/mastra/CLAUDE.md`'s retraction
   paragraph, `createSeekerInstructionsResolver`'s JSDoc, and the serve-stale
   solutions doc's Law 1 resolution) in the same PR.
4. **Explicit `version` pinning parameter.** Additive input alongside
   `label`; provenance already records the served version, so this is a
   fetch-input change, not a result-shape change.
5. **Sustained-fallback alerting + span stamping.** Metrics/alerting when
   production serves `source: "fallback"` beyond a threshold (the
   silent-divergence risk), and stamp the served prompt version/source into
   Mastra observability spans — compatible with `redactPromptBodies` (never
   prompt bodies). Two facts the implementation must account for
   (2026-07-29): alerting keyed on `source: "fallback"` alone is blind to
   STALE serves (`source: "langfuse"` + `stale: true`, no `reason`) — the
   state most worth paging on — so the trigger must cover both; and the
   item-1 resolver deliberately returns only `.text`, discarding provenance,
   so this item reworks that seam rather than extending it.
6. **Know the label-move property — no ceremony required.** Moving the
   `production` label changes agent behaviour with **no PR, CI or deploy**, and
   there is **no technical control** over who may do it: protected labels are a
   Team/Enterprise feature this organisation is not on, and they work by
   blocking `viewer`/`member` while permitting `admin`/`owner`, so they would
   be inert here anyway (feat-296 records the check). This is a real property
   of choosing labels over per-environment projects, and it is the thing to
   revisit if the Langfuse organisation ever admits non-developers — but with
   the current small, all-developer roster it needs no gate or sign-off
   process. **[UPDATED 2026-07-29]** Under item 2's whole-prompt decision a
   label move can change EVERY line — the SAFETY guardrail and citation
   discipline included; the composition-split mitigation this item used to
   cite no longer exists, deliberately. What remains: the roster snapshot
   above, and the code fallback as PR-reviewed known-good text (rollback =
   the per-trigger retraction recipe in Constraints: label re-point within
   one cache TTL for a trusted setup; unset `LANGFUSE_*` + redeploy when the
   prompt is deleted, the key is revoked, or the key is hostile). NO control
   DETECTS a label move to valid-but-wrong text — it resolves as a healthy
   fresh serve, invisible to item 5's fallback/stale alerting; item 5's
   version/source span stamping (open) is post-hoc attribution only. Know
   also that the resolved
   prompt text is returned VERBATIM by Mastra's built-in, code-unauthenticated
   `/api/agents*` surfaces — the tuned text is confidential only up to the
   network/gateway boundary and must never carry secrets. The deferred
   guardrail gate (runtime input/output checks at the agent seam) is the
   eventual code-side control that does not depend on prompt text at all.

## Constraints

- The helper stays retrieval-only (plan R4): no prompt create/update/label
  mutation from code, ever. Authoring stays in the Langfuse UI.
- Zero new required env vars; an unconfigured environment must keep serving
  the fallback with no boot impact.
- No `langfuse` / `@langfuse/*` npm packages (plan KTD1) — the hand-rolled
  client carries house invariants the SDK cannot.
- ONE Langfuse project (`forge-mastra`) with **labels** distinguishing
  environments, and two key pairs inside it (Railway + local dev). The plan's
  KTD8 said the opposite; it was reversed on 2026-07-28 — see feat-296's
  topology decision. Do not reintroduce per-environment projects: prompt
  versions and labels are project-scoped with no cross-project copy, so it
  would turn promotion into manual re-authoring.
- Do not add Langfuse tracing here. The helper only reads prompts; tracing is a
  separate mechanism with its own content decision, tracked in
  `docs/roadmap/ai-chat/feat-321-langfuse-tracing.md`.
- Do not weaken the helper's no-throw, leak-control, or cooldown-≤-TTL
  invariants while adding SWR or version pinning.
- NO composition split — the whole-prompt decision (item 2, owner,
  2026-07-29) is final: the entire `instructions` text is one Langfuse
  prompt, and the byte-identical full text lives in code only as the
  fallback constant. Do not reintroduce a split "just for the SAFETY line";
  any change to the fallback must be mirrored into the `seeker-system`
  prompt in the Langfuse UI (every label) in the same change — via the
  expand-then-contract ordering in item 2 when the change touches a
  tool-coupled literal, since the UI edit and the deploy cannot land
  atomically.
- The caller-supplied `fallback` must always be the full working prompt and
  never empty — layer 2 deliberately serves it verbatim with no emptiness
  guard (asymmetric with layer 1's `empty_prompt` rejection). Pin a
  non-empty fallback in the wiring tests. (Review finding #8.)
- Serve-stale means DELETING a managed prompt in Langfuse does not retract
  already-cached text until process restart — layer 2 ignores `retryable`
  and keeps serving stale through non-retryable 404/401 failure windows.
  Decide retraction semantics during wiring: degrade stale-serving after N
  non-retryable cooldown windows, or document label re-pointing as the only
  retraction path. (Review finding #9.)
  **[RESOLVED 2026-07-29 — documentation branch chosen; serve-stale
  unweakened.]** Deleting the prompt, removing its label, or revoking the key
  does NOT retract text already cached in a running process — deliberately,
  as the outage protection. The retraction path depends on the trigger:
  - **Bad version behind an intact, trusted setup** (mistaken label move,
    bad edit): re-point the label to a known-good version — effective within
    one cache TTL (60s default; a move landing inside an active failure
    cooldown can add up to one more window).
  - **Prompt deleted or key revoked:** the label path is INERT — there is no
    version to point at, or every refetch 401s and re-arms the cooldown, so
    the stale text serves indefinitely. Unset `LANGFUSE_*` and redeploy is
    the only retraction (the restart clears the in-process cache and forces
    the compiled-in fallback).
  - **Compromised key** (hostile writer): label re-pointing is a race the
    defender cannot win — the attacker still holds write access. Sequence:
    rotate/revoke the key pair FIRST, then unset `LANGFUSE_*` and redeploy
    (revocation alone leaves the attacker's text serving stale until
    restart); do not restore `LANGFUSE_*` until the credential is replaced.
  - **Teardown order:** unset `LANGFUSE_BASE_URL` first, or clear the whole
    group in one Railway edit. Clearing `LANGFUSE_ALLOWED_HOSTS` while the
    base URL is still set arms the boot guard: the deploy fails its
    healthcheck, the previous process keeps running, and the cached text is
    NOT cleared (feat-296's one boot-throwing state, in reverse).

  Recorded at the resolver's JSDoc in `seeker-agent.ts` and in
  `apps/mastra/CLAUDE.md`'s Langfuse section.

- Prompt names/labels passed to `getManagedPrompt` must be compile-time
  constants — the default cache has no eviction and logs the raw name per
  failure transition, so request-derived names would grow the Map
  unboundedly and defeat the cooldown discipline. (Review finding #11.)

## Verification

- The opt-in smoke runs green against the provisioned `forge-mastra` project
  using the local-dev key pair (`LANGFUSE_PROMPT_SMOKE_TEST=1`) — proves the
  operational precondition landed before wiring starts.
- The plan's no-wiring grep gate inverts:
  `grep -ri "langfuse" apps/mastra/src/mastra/` now hits exactly the intended
  seeker wiring (`seeker-agent.ts` + its test, plus the comment-only coupling
  breadcrumbs in `tools/retrieve-answer.ts`) and nothing else — no workflows,
  no other agents, no routes.
- Seeker wiring tests cover: managed prompt served verbatim when configured
  (pinning the `seeker-system` name on the wire), byte-identical full
  fallback when unconfigured or unreachable, the no-injection default path,
  and the `retrieveAnswer` status-literal drift pin. The scenario block in
  `langfuse-prompt-client.test.ts` keeps its full-prompt-as-fallback pin —
  under item 2 there is no composed shape. Full suite green:
  `pnpm --filter @forge/mastra test`, `typecheck`, `lint`.
- Studio check, phrased in observable signals (nothing surfaces the
  `source` provenance field until item 5 reworks the resolver seam): with
  `LANGFUSE_*` unset, the seeker's resolved instructions equal
  `SEEKER_SYSTEM_PROMPT_FALLBACK` byte-for-byte AND the process logs
  `[langfuse] event=prompt_fetch_failed name=seeker-system label=production
reason=config_missing detail=base_url_missing` once; with Langfuse
  configured and `seeker-system` seeded (item 2), a seeker turn serves the
  managed text — provable by editing a distinguishable draft version in
  Langfuse, or via `getManagedPrompt` provenance in a one-off script.
- Sustained-fallback alerting fires in a rehearsed outage drill; spans carry
  prompt version/source without prompt bodies.
