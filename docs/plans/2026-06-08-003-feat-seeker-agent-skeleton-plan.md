---
title: "feat: Seeker Agent Skeleton (feat-198)"
type: feat
status: active
date: 2026-06-08
origin: docs/brainstorms/2026-06-08-seeker-agent-skeleton-requirements.md
roadmap: docs/roadmap/ai-chat/feat-198-seeker-agent-skeleton.md
branch: feat/seeker-agent-skeleton
scope: apps/mastra
---

# feat: Seeker Agent Skeleton (feat-198)

## Summary

Stand up the **seeker agent** — the first agent of the planned headless,
multi-agent "Jesus Film AI Chat" system — as a skeleton in `apps/mastra`,
exercised entirely in Mastra Studio. The skeleton proves the
chat → tool-call → remembered-context shape end-to-end: a real `Agent` with
minimal placeholder instructions, one hard-coded stub `retrieve-answer` tool,
and the `@mastra/memory` `Memory` primitive backed by a dedicated in-memory
store. Real RAG, the persona/safety guardrails, any public surface,
Postgres-persisted memory, and evals are all explicitly **deferred** (see
origin: `docs/brainstorms/2026-06-08-seeker-agent-skeleton-requirements.md`).

The genuinely novel work — relative to admin's existing chat-agent pattern — is
standing up the `Memory` primitive against `apps/mastra`'s storage tier and
bootstrapping the first conversational agent in the runtime app. The
chat/tool/memory criteria are the floor that confirms the wiring; the high-risk
problems (RAG contract, guardrail enforcement, audience safety) are deferred and
called out below.

---

## Problem Frame

`apps/mastra` already hosts the Mastra runtime (feat-129) but has only the smoke
agent, the web-research agent, and embedding/eval workflows — no conversational
agent wired with memory. `apps/admin/src/mastra` has a complete chat-agent +
tools + Memory pattern, but `apps/mastra` is forbidden from importing
`apps/admin` (architecture rule + a real tsx/ESM cross-package-boundary
load-time crash — see
`docs/solutions/runtime-errors/tsx-esm-named-export-resolution-across-workspace-package-boundary-20260508.md`).
So admin is a reference to **mirror by copying**, not a dependency. This is the
already-accepted convention in this app (cf.
`docs/solutions/architecture-patterns/mastra-seed-baseline-portability-pattern.md`).

The seeker audience — people exploring Christianity and who Jesus is — is
**sensitive**. The skeleton is _not_ for real seekers; it is exercised by the
team in Studio only, and ships with a hard safety line in its placeholder
instructions to bound the blast radius of any leaked/screenshotted test output
before the guardrail release gate is met.

**Containment is network-boundary, not code-enforced.** Once an agent is
registered, Mastra's built-in `/api/agents/*` surface exposes it for
generate/stream — that endpoint is framework-generated and unauthenticated at
the code layer (per
`docs/solutions/integration-issues/mastra-studio-api-auth-guard.md`, the broad
`/api/*` service-bearer guard was deliberately removed so Studio's own browser
calls work). So "Studio-only" means "reachable only by whoever can reach the
Mastra HTTP surface" — the actual boundary is `apps/mastra-gateway` + Railway
networking, NOT the route-isolation test. The route-isolation test (R5) proves
only that no _custom_ `/forge-*` route exposes the agent; it does not and cannot
make the built-in agent API private. This is acceptable at skeleton scale
(internal service, behind the gateway) but the safety argument must name its
real control. Promotion to a real public surface requires both the deferred
guardrail gate AND an explicit gateway access decision.

---

## Requirements

Traced from the origin requirements doc and `feat-198` ticket:

- **R1** — A `seeker-agent.ts` `Agent` registered in `index.ts` `agents: {}`,
  with minimal placeholder instructions (helps people exploring Christianity /
  who Jesus is; warm and honest; uses the retrieve tool to ground factual
  answers), carrying one safety line: non-production prototype; must not invent
  scripture, citations, or doctrinal claims — even in Studio.
- **R2** — One stub `retrieve-answer` tool via `createTool`, following the
  same-app `firecrawl.ts` shape. Provisional I/O (NOT a finalized RAG contract):
  input `{ query: string, locale?: string }`, output
  `{ answer: string, sources: [] }` — hard-coded answer, empty `sources`.
- **R3** — The `@mastra/memory` `Memory` primitive wired against an
  `InMemoryStore`, attached to the seeker agent only. Add the `@mastra/memory`
  dependency (not yet present in `apps/mastra`). Memory wipes on process restart,
  not per session.
- **R4** — A single commented guardrail attach-point breadcrumb in the
  agent/tool flow (where later honesty / crisis-deferral checks hook). No logic.
- **R5** — A route-isolation test asserting the seeker agent is NOT attached to
  any custom `registerApiRoute` (no hand-written `/forge-*` route exposes it).
  NOTE: this does not make the agent fully private — Mastra's built-in
  `/api/agents/*` surface exposes any registered agent; the true Studio-only
  boundary is the gateway/network layer (see Problem Frame).
- **R6** — A "Seeker agent" section in `apps/mastra/CLAUDE.md`: local run
  command, Studio steps, "not wired yet" deferred set, and the observability /
  copy-not-import notes.
- **R7** — Colocated unit tests next to the agent and the tool (match
  `smoke-agent.test.ts` style).

**Success criteria (origin):** `typecheck` + `test` pass;
`MASTRA_STORAGE_BACKEND=memory pnpm --filter @forge/mastra dev` boots Studio; in
Studio the agent converses, a factual question visibly fires `retrieve-answer`,
and a follow-up turn shows earlier context is remembered within the thread
(correct `threadId` scoping); the route-isolation test passes.

---

## Key Technical Decisions

### KTD1 — Memory backed by a dedicated in-memory store (Option A)

The `Memory` primitive is wired in a new `memory.ts` module that constructs its
**own** `InMemoryStore`, independent of `index.ts`'s `MASTRA_STORAGE_BACKEND`
switch. Rationale:

- Memory is **always** in-memory regardless of backend, so it physically cannot
  persist to Postgres — honoring the brainstorm's "no Postgres-persisted memory"
  deferral unconditionally (the seeker agent is Studio-only and never invoked in
  production, but this removes the question entirely).
- No edit to `index.ts`'s production storage construction (a more sensitive
  surface), and no circular import (`index.ts` imports the agent, so the agent
  cannot import `index.ts`'s `storage` const).
- `memory.ts` becomes the single-responsibility seam where the eventual
  in-memory → Postgres/PgVector swap happens later — mirroring the role
  `apps/admin/src/mastra/memory.ts` plays today. The Memory wiring shape
  (`new Memory({ storage })`) is identical to the persisted path, so this choice
  does not complicate the future build-out.

Verified compatible: `new Memory({ storage })` accepts `InMemoryStore` because
`SharedMemoryConfig.storage?: MastraCompositeStore` and `InMemoryStore extends
MastraCompositeStore` (`@mastra/core@1.36.0` types). The alternative
(share `index.ts`'s app-level store) was rejected — it requires extracting the
production storage switch into a shared module and binds memory to Postgres in
prod mode, pulling a deferred concern into a skeleton.

### KTD2 — `@mastra/memory@1.18.2`

Add `"@mastra/memory": "1.18.2"` to `apps/mastra/package.json` — same version
`apps/admin` pins, and its peer range (`@mastra/core >=1.4.1-0 <2.0.0-0`) is
satisfied by `apps/mastra`'s `@mastra/core@1.36.0`. Note: the only currently
installed copy is keyed to admin's `@mastra/core@1.33.1`; adding the dep to
`apps/mastra` resolves a **new** peer variant `@mastra/memory@1.18.2(@mastra/core@1.36.0)`
and rewrites the lockfile — expect a non-trivial lockfile diff, not a no-op
install.

### KTD3 — Memory attaches per-agent; other agents untouched

Memory is passed via the seeker `Agent`'s constructor `memory` field
(`AgentConfig.memory?: DynamicArgument<MastraMemory>`). `smokeAgent` and
`webResearchAgent` have no `memory` field and their files are not touched — they
remain stateless. There is no global memory switch.

### KTD4 — Route-isolation as a source-text assertion (scoped to custom routes)

**What this test does and does not prove.** It proves no _custom_ `/forge-*`
route in `index.ts` wires up the seeker agent. It does NOT prove the agent is
unreachable — Mastra's framework-generated `/api/agents/*` surface exposes any
registered agent regardless of custom routes (see Problem Frame). The real
Studio-only boundary is the gateway/network layer, not this test. The test is
still worth having: it is a cheap regression guard that catches a future edit
deliberately bolting a bespoke public route onto the agent.

The mechanism is a **source-text assertion** on `index.ts` (read via `node:fs`),
asserting the seeker agent symbol appears in the `agents: {}` registration but
**not** within the `apiRoutes` array region. Source-text over runtime
introspection because route handlers are opaque closures (`.handler` is a
function — a runtime route list can prove no seeker _path_ exists, but cannot
prove a handler doesn't internally call the agent), and because importing
`index.ts` eagerly constructs the entire Mastra instance (DuckDB store,
observability, all workflows) at module load. Same family as admin's migration
byte-parity tests (`hybrid-search-sql.test.ts`).

### KTD5 — No new env var

The skeleton adds zero required env vars. The seeker agent reuses the existing
`model: "openai/gpt-5.4-mini"` (runnable in Studio with the already-configured
`OPENAI_API_KEY`). This aligns with
`docs/solutions/runtime-errors/required-env-var-without-default-broke-railway-deploy-20260511.md`
— any future config must be `.optional()` + runtime fallback. Noted in the
guardrail breadcrumb so a placeholder is never promoted to required-at-load.

---

## Output Structure

```
apps/mastra/
├── package.json                         # + @mastra/memory@1.18.2  (U1)
└── src/mastra/
    ├── memory.ts                        # new — Memory + dedicated InMemoryStore  (U2)
    ├── memory.test.ts                   # new — adversarial cross-thread isolation (U2)
    ├── tools/
    │   ├── retrieve-answer.ts           # new — stub createTool + guardrail breadcrumb (U3)
    │   └── retrieve-answer.test.ts      # new  (U3)
    ├── agents/
    │   ├── seeker-agent.ts              # new — Agent + placeholder instructions (U4)
    │   └── seeker-agent.test.ts         # new  (U4)
    ├── index.ts                         # modified — register seekerAgent in agents{} (U4)
    └── seeker-route-isolation.test.ts   # new — source-text route guard (U5)
```

`apps/mastra/CLAUDE.md` gains a "Seeker agent" section (U6). The tree is a scope
declaration, not a constraint — per-unit `**Files:**` are authoritative.

---

## Implementation Units

### U1. Add the `@mastra/memory` dependency

**Goal:** Make `@mastra/memory` available to `apps/mastra`.
**Requirements:** R3.
**Dependencies:** none.
**Files:** `apps/mastra/package.json`, `pnpm-lock.yaml` (root).
**Approach:** Add `"@mastra/memory": "1.18.2"` to `dependencies` (alphabetical
position alongside the other `@mastra/*` deps), then `pnpm install` to update the
lockfile. Peer-compatible with `@mastra/core@1.36.0` (KTD2). Resolution adds a
new `@mastra/memory@1.18.2(@mastra/core@1.36.0)` peer variant (the existing
installed copy is keyed to admin's `@mastra/core@1.33.1`), so expect a lockfile
addition — this is correct, not a sign of a misconfigured install.
**Patterns to follow:** existing `@mastra/*` entries in `apps/mastra/package.json`.
**Test scenarios:** `Test expectation: none -- dependency/lockfile change; exercised by U2's import compiling and U2 tests passing.`
**Verification:** `pnpm --filter @forge/mastra typecheck` resolves the
`@mastra/memory` import added in U2; the new `(@mastra/core@1.36.0)`-keyed
lockfile entry for `@mastra/memory@1.18.2` is present.

### U2. Memory wiring module (`memory.ts`) + adversarial test

**Goal:** Build the `Memory` primitive against a dedicated `InMemoryStore`,
exposed as a lazy singleton for the seeker agent to consume.
**Requirements:** R3.
**Dependencies:** U1.
**Files:** `apps/mastra/src/mastra/memory.ts`,
`apps/mastra/src/mastra/memory.test.ts`.
**Approach:** Mirror the _shape_ of `apps/admin/src/mastra/memory.ts` (lazy
singleton factory + a test-only reset hook) but stripped to in-memory only — no
Postgres, no PgVector, no embedder, no env reads. Construct one
`InMemoryStore` (from `@mastra/core/storage`, the same class `index.ts` uses) and
`new Memory({ storage })`; export `getSeekerMemory()` returning the singleton,
plus `__resetSeekerMemoryForTesting()`. Do NOT import from `apps/admin` — copy
the pattern (KTD1).
**Patterns to follow:** `apps/admin/src/mastra/memory.ts` lazy-singleton +
`__reset*ForTesting` shape (mirror, do not import).
**Test scenarios:**

- Happy path: `getSeekerMemory()` returns a `Memory` instance; calling it twice
  returns the same singleton (identity check).
- The Memory is backed by an `InMemoryStore` (assert the constructed store is an
  `InMemoryStore` instance — guards against accidentally wiring a persisted store).
- **Adversarial cross-thread isolation (non-vacuous):** using a real
  `InMemoryStore`-backed `Memory`, prove two threads stay separate. This is the
  assertion a no-op/identity memory layer would fail (cf.
  `docs/solutions/best-practices/mocked-shape-vs-real-contract-discipline-20260506.md`
  and `docs/solutions/best-practices/idempotence-property-test-vacuous-on-malformed-fixed-point-20260528.md`).
  **Verified API recipe** (confirmed by running it against the installed
  `@mastra/memory@1.18.2` + `InMemoryStore` — the methods are `saveThread` /
  `saveMessages` / `recall`; there is NO `createThread` and NO `query`):
  1. `saveThread(...)` for **BOTH** thread A and thread B first — each thread
     needs `id`, `resourceId`, `title`, `metadata`, `createdAt`, `updatedAt`.
     This step is mandatory: `recall` on a thread that was never created
     **throws** (`No thread found with id …`), it does not return empty. Skipping
     it makes the test crash, not fail-soft.
  2. `saveMessages({ messages: [...] })` to write a message into thread A — note
     `saveMessages` takes a `{ messages }` object where **each message carries
     its own `threadId`/`resourceId`**; there is no top-level `threadId` arg.
  3. `recall({ threadId: A })` → assert ≥1 message; `recall({ threadId: B })` →
     assert 0 messages. (Confirm exact `recall`/`saveMessages` argument shapes
     against the installed dist types when implementing — the method _names_ are
     verified, the precise option objects should be double-checked.)
     Fallback (last resort, only if the round-trip proves intractable at
     implementation time): the store-type + singleton assertions above plus U4's
     agent-attachment assertion. Taking the fallback downgrades thread-scoping
     evidence to the manual Studio step only (not in CI) — attempt the round-trip
     first; it is the assertion that makes the Studio memory-recall criterion
     non-vacuous.
     **Verification:** `memory.test.ts` passes, including the cross-thread isolation
     case (both threads created, A has the message, B is empty); `typecheck` clean.

### U3. Stub `retrieve-answer` tool + guardrail breadcrumb

**Goal:** A hard-coded stub tool the agent can visibly call, in the same-app
`createTool` shape, with a provisional (non-contract) I/O.
**Requirements:** R2, R4 (breadcrumb may live here or in U4 — see Approach).
**Dependencies:** none (independent of U1/U2).
**Files:** `apps/mastra/src/mastra/tools/retrieve-answer.ts`,
`apps/mastra/src/mastra/tools/retrieve-answer.test.ts`.
**Approach:** Follow `tools/firecrawl.ts`: define zod `inputSchema`
(`{ query: string (trim, min 1), locale?: string }`, `.strict()`) and
`outputSchema` (`{ answer: string, sources: array (empty tuple/`z.array` of a
placeholder) }`), export a pure `executeRetrieveAnswer(input)` that returns a
deterministic hard-coded `{ answer, sources: [] }`, and wrap it in
`createTool({ id: "retrieveAnswer", description, inputSchema, outputSchema,
execute })`. The hard-coded `answer` text must itself stay within the safety
posture (no invented scripture/citations — e.g. a generic placeholder string
making clear it is a stub). Add a comment marking the I/O as a **provisional
placeholder, NOT a finalized RAG contract**, noting real retrieval will likely
return passage-shaped `sources` (`{ text, ref, score? }`).
**Guardrail breadcrumb (R4):** place the single commented attach-point in
`seeker-agent.ts` (U4) where input/output guardrail checks (honesty,
crisis-deferral) will hook — one breadcrumb, no logic. (Recorded here because R4
is conceptually part of the agent/tool flow; the actual comment lands in U4 to
keep it to a single attach-point.)
**Patterns to follow:** `apps/mastra/src/mastra/tools/firecrawl.ts`
(pure-`execute`-fn + `createTool` wrapper; `.strict()` zod schemas).
**Test scenarios:**

- Happy path: `executeRetrieveAnswer({ query: "who is Jesus?" })` returns
  `{ answer: <non-empty string>, sources: [] }` (deterministic — assert exact
  shape and that `sources` is empty).
- Optional `locale`: passing `{ query, locale: "es" }` still returns the same
  stub shape (locale accepted, does not throw).
- Schema validation: `inputSchema.safeParse({ query: "" })` fails (min-length);
  `safeParse({ query: "x", locale: "en" })` succeeds; unknown keys rejected
  (`.strict()`). Mirror `firecrawl.test.ts`'s `safeParse(...).success` style.
- Output conforms: `outputSchema.safeParse(executeRetrieveAnswer({ query: "x" }))`
  succeeds.
- **Safety regression guard:** assert the hard-coded `answer` matches a stable
  safe-placeholder substring (mirroring U4's safety-line assertion) so the stub
  text cannot later be edited into invented-scripture / doctrinal-looking content
  without a test failing. The stub text and the asserted substring are the same
  source of truth (e.g. the answer contains a "stub"/"placeholder" marker); this
  is a sensitive-audience guard, cheap to keep green.
  **Verification:** `retrieve-answer.test.ts` passes; `typecheck` clean.

### U4. Seeker agent + registration + guardrail breadcrumb

**Goal:** The `Agent` itself — placeholder instructions with the safety line,
the stub tool wired, memory attached — registered in the Mastra instance.
**Requirements:** R1, R3 (attachment), R4, R7.
**Dependencies:** U2, U3.
**Files:** `apps/mastra/src/mastra/agents/seeker-agent.ts`,
`apps/mastra/src/mastra/agents/seeker-agent.test.ts`,
`apps/mastra/src/mastra/index.ts` (registration only).
**Approach:** Mirror `web-research-agent.ts`: `new Agent({ id: "seekerAgent",
name: "Seeker Agent", description, instructions, model: "openai/gpt-5.4-mini",
tools: { retrieveAnswer: retrieveAnswerTool }, memory: getSeekerMemory() })`.
Instructions are an array joined by `\n` (web-research-agent style), minimal:
helps people exploring Christianity / who Jesus is; warm and honest; use
`retrieve-answer` to ground factual answers; **plus the mandatory safety line**:
non-production prototype, must not invent scripture, citations, or doctrinal
claims even in Studio. Add the **single guardrail attach-point breadcrumb**
(R4) as a comment marking where later honesty / crisis-deferral checks (incl.
crisis routing to human/helpline resources) will hook, and noting the no-new-
required-env-var posture (KTD5). In `index.ts`, import `seekerAgent` and add it
to the `agents: { smokeAgent, webResearchAgent, seekerAgent }` map — **no route
changes**.
**Patterns to follow:** `apps/mastra/src/mastra/agents/web-research-agent.ts`
(Agent + tools shape, instructions-array join); `smoke-agent.test.ts` for test
style.
**Test scenarios:**

- `seekerAgent.name` is `"Seeker Agent"` (stable id/name — mirror smoke test).
- Instructions include the safety line: assert the rendered instructions string
  contains the non-production-prototype / no-invented-scripture phrasing (assert
  on a stable substring so the safety line cannot be silently dropped).
- The `retrieveAnswer` tool is wired onto the agent (assert the tool is present
  in the agent's tools).
- Memory is attached (assert the agent's `memory` is defined / is the
  `getSeekerMemory()` singleton). This is the unit-level companion to U2's
  cross-thread test.
  **Verification:** `seeker-agent.test.ts` passes; agent appears in Studio under
  the `agents` list when the dev server boots; `typecheck` clean.

### U5. Route-isolation test (no custom public route)

**Goal:** A self-enforcing regression guard that no _custom_ `registerApiRoute`
wires up the seeker agent. NOT a proof of full Studio-only containment — the
built-in `/api/agents/*` surface exposes any registered agent; the real boundary
is gateway/network (KTD4, Problem Frame).
**Requirements:** R5.
**Dependencies:** U4 (the registration the test reads).
**Files:** `apps/mastra/src/mastra/seeker-route-isolation.test.ts`.
**Approach:** Read `index.ts` source via `node:fs`
(`readFileSync(new URL("./index.ts", import.meta.url), "utf8")`). Assert:
(a) the `seekerAgent` symbol appears in the `agents: { ... }` registration
(positive: it IS a registered agent); (b) the `seekerAgent` symbol does NOT
appear anywhere within the `apiRoutes` array region (negative: not wired to a
custom route). Locate the `apiRoutes` region by slicing the source between the
`apiRoutes: [` opener and its matching close, or assert no `registerApiRoute`
block references `seekerAgent`. Rationale and why source-text over runtime
introspection: KTD4. Add a comment at the top of the test stating plainly what
it does and does NOT guarantee (custom-route guard only; built-in agent API
exposure and the gateway boundary are out of its scope), cross-referencing
`docs/solutions/integration-issues/mastra-studio-api-auth-guard.md` — a
`/forge-*` 200 must never be mistaken for proof the agent is or isn't exposed.
**Patterns to follow:** admin's file-reading byte-parity tests
(`hybrid-search-sql.test.ts`) — read a source/migration file and assert on its
text.
**Test scenarios:**

- `seekerAgent` is present in the `agents: {}` registration block (guards against
  the test passing because the agent was never registered — a vacuous-pass
  guard).
- `seekerAgent` does NOT appear within the `apiRoutes` region / no
  `registerApiRoute(...)` references it.
- (Defensive) the `apiRoutes` region was actually located and is non-empty
  before asserting absence — so a parsing miss can't make the negative assertion
  pass vacuously.
  **Verification:** `seeker-route-isolation.test.ts` passes; deliberately wiring
  the agent into a route (local experiment) makes it fail.

### U6. `apps/mastra/CLAUDE.md` "Seeker agent" section

**Goal:** Document how to stand the agent up locally and what is deliberately
deferred.
**Requirements:** R6.
**Dependencies:** U4 (so documented behavior is real).
**Files:** `apps/mastra/CLAUDE.md`.
**Approach:** Add a new "Seeker agent" section in the existing per-capability
section style (cf. the "Firecrawl web data" section). Include: the local run
command (`MASTRA_STORAGE_BACKEND=memory pnpm --filter @forge/mastra dev`); Studio
steps (open the agent, ask a factual question to see `retrieve-answer` fire,
follow up to see thread memory; use a **distinct `threadId` per tester** so
in-memory state — process-lifetime, not per-session — doesn't leak between
testers); a "not wired yet" note listing the deferred set (real RAG,
persona/safety guardrails incl. crisis handling, public surface,
Postgres-persisted memory, evals); a one-line note that observability traces
appear in Studio automatically (inherited from the instance-level
`Observability` config; `redactPromptBodies` blanks `input`/`output` on all
spans incl. tool spans — no new observability code); the copy-not-import
rationale (mirror admin's Memory wiring, never import `apps/admin`; cf.
`mastra-seed-baseline-portability-pattern.md`); and an explicit **containment
note** — the seeker agent is reachable over Mastra's built-in `/api/agents/*`
surface to anyone who can reach the Mastra HTTP endpoint; the Studio-only
boundary is the `apps/mastra-gateway` + Railway network layer, NOT the
route-isolation test. Do not expose this agent to a public surface before the
deferred guardrail gate AND a gateway access decision.
**Patterns to follow:** existing `apps/mastra/CLAUDE.md` capability sections
(headings, run-command blocks, "Common things to remember" style).
**Test scenarios:** `Test expectation: none -- documentation.`
**Verification:** section renders; run command and Studio steps match the
implemented behavior; deferred set matches the origin doc.

---

## Scope Boundaries

### In scope

R1–R7 above: the seeker agent, the stub tool, in-memory Memory, the guardrail
breadcrumb, the route-isolation test, the CLAUDE.md section, and colocated tests.

### Deferred for later (origin: requirements doc "Out of Scope")

- **Real RAG / actual retrieval backend.** The stub's I/O shape is provisional,
  not a contract the real system is bound to.
- **Full persona + safety guardrails** — a release gate, not skeleton work. Must
  explicitly cover fabrication/honesty, AI-disclosure, doctrinal-uncertainty,
  and **crisis handling** (suicidal-ideation / self-harm / acute distress →
  route to human/helpline resources, never improvise).
- **Public-facing web surface** — `apps/mastra` is internal/service-bearer-only
  today.
- **Persisted Postgres memory** — admin already proves the Postgres + PgVector
  path; this skeleton stays in-memory (KTD1).
- **Agent evals** — faithfulness/groundedness once RAG lands; safety scoring tied
  to the guardrail gate.

### Deferred to follow-up work (plan-local)

- Whether the two Mastra setups (admin + this app) should later share Memory
  code — open question, not decided here. Divergence accepted as a one-time
  bootstrap; maintained independently.
- Capture the agent/tool/`@mastra/memory` wiring as net-new institutional
  knowledge via `/ce-compound` after it lands (no existing solutions doc covers
  this specific wiring).

### Hard constraints (do NOT do)

- **Do NOT push this branch to `main`** until the `ai-chat` roadmap-lane team
  decision lands.
- **Do NOT apply** the roadmap-doc / roadmap-app lane edits recipe'd in
  `todos/007-pending-p2-ai-chat-roadmap-lane-pending-team-decision.md` (root
  `CLAUDE.md` tree + `apps/roadmap/lib/features.ts` / `markdown.ts` /
  `components/Sidebar.tsx`).
- **Do NOT import** from `apps/admin`, `apps/manager`, or `apps/auth`.
- **Do NOT** author the full persona/guardrails or build real retrieval.

---

## Risks & Mitigations

- **Memory/thread test passes vacuously.** Mitigation: U2's adversarial
  cross-thread isolation assertion against a real `InMemoryStore` (a no-op memory
  layer fails it). The `@mastra/memory@1.18.2` API is now verified
  (`saveThread`/`saveMessages`/`recall`; both threads must be created first or
  `recall` throws) — see the U2 recipe. Documented fallback only if the
  round-trip proves intractable, which would downgrade thread-scoping evidence to
  the manual Studio step.
- **"Studio-only" containment is weaker than it reads.** The built-in
  `/api/agents/*` surface exposes any registered agent; the route-isolation test
  only guards against _custom_ routes, and the real boundary is the
  gateway/network layer (KTD4, Problem Frame). Mitigation: the plan names the
  actual control rather than over-claiming the test; the agent is an internal
  service behind the gateway at skeleton scale; promotion to a public surface
  requires the deferred guardrail gate AND an explicit gateway access decision.
- **Route-isolation test gives false assurance about custom routes.** Runtime
  route-list introspection cannot prove an opaque handler doesn't call the agent.
  Mitigation: source-text assertion (KTD4) — fails if any future edit references
  `seekerAgent` inside `apiRoutes`. Includes a positive "is registered as an
  agent" check so the test can't pass because nothing was registered.
- **Placeholder instructions leak / get screenshotted.** Mitigation: the
  mandatory safety line bounds the blast radius; the agent is internal-only
  behind the gateway (the network boundary, not the route-isolation test, is
  what keeps it off the public internet).
- **`@mastra/memory@1.18.2` ↔ `@mastra/core@1.36.0` skew.** Low — peer range
  satisfied, already resolved in-workspace; `typecheck` + tests catch any drift.

---

## Sources & Research

- Origin requirements: `docs/brainstorms/2026-06-08-seeker-agent-skeleton-requirements.md`
- Roadmap ticket: `docs/roadmap/ai-chat/feat-198-seeker-agent-skeleton.md`
- In-app templates: `apps/mastra/src/mastra/agents/web-research-agent.ts`,
  `apps/mastra/src/mastra/tools/firecrawl.ts`,
  `apps/mastra/src/mastra/agents/smoke-agent.ts` +
  `smoke-agent.test.ts`, `apps/mastra/src/mastra/tools/firecrawl.test.ts`,
  `apps/mastra/src/mastra/index.ts`, `apps/mastra/src/config/env.ts`
- Memory wiring reference (mirror, do not import):
  `apps/admin/src/mastra/memory.ts`
- Verified versions/types: `@mastra/memory@1.18.2` (admin's pin, workspace-resolved);
  `@mastra/core@1.36.0` — `SharedMemoryConfig.storage?: MastraCompositeStore`,
  `InMemoryStore extends MastraCompositeStore`,
  `AgentConfig.memory?: DynamicArgument<MastraMemory>`,
  `ApiRoute = { path; method; handler }`. No `vitest.config` in `apps/mastra`;
  test script `vitest run`; tests import explicitly from `"vitest"`.
- Learnings applied:
  `docs/solutions/best-practices/mocked-shape-vs-real-contract-discipline-20260506.md`,
  `docs/solutions/best-practices/idempotence-property-test-vacuous-on-malformed-fixed-point-20260528.md`,
  `docs/solutions/integration-issues/mastra-studio-api-auth-guard.md`,
  `docs/solutions/runtime-errors/required-env-var-without-default-broke-railway-deploy-20260511.md`,
  `docs/solutions/architecture-patterns/mastra-seed-baseline-portability-pattern.md`,
  `docs/solutions/runtime-errors/tsx-esm-named-export-resolution-across-workspace-package-boundary-20260508.md`
