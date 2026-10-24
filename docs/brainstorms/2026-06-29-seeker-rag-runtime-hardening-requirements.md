# Seeker RAG runtime hardening (feat-202) — requirements

**Date:** 2026-06-29
**Ticket:** `docs/roadmap/ai-chat/feat-202-seeker-rag-runtime-hardening.md`
**Status of this doc:** scoping decided; ready for `ce-plan`.
**Worktree:** `feat/seeker-rag-runtime-hardening`

## Problem

The feat-198/feat-199 seeker skeleton shipped clean for a Studio-only,
release-gated prototype. A code review surfaced three latent defense-in-depth
gaps. An investigation against the live code (2026-06-29) reshaped the ticket:
build the RAG byte-cap (①) and a default agent step budget + routing-convention
note (③); defer the in-memory eviction (②) to feat-208, where moving to Postgres
eliminates its underlying risk. This doc records that scoping so planning builds
the small, correct version rather than the ticket's original three-item,
two-client shape.

Context that bounds urgency: the RAG upstream is a trusted, host-allowlisted,
bearer-authed first-party service; the seeker is Studio-only and reachable only
behind the `apps/mastra-gateway` + Railway network boundary. None of the three
items is a live, externally-triggerable bug today.

## Decisions

### Build now — ① byte-cap the RAG response body (RAG client only)

`apps/mastra/src/services/jesusfilm-rag-client.ts` reads `await response.json()`
on both the success body (`:217`, before the `.slice(0, RAG_TOP_K)` at `:235`)
and the error path (`readUpstreamReason`, `:123`) with no size guard. The whole
upstream body is buffered into the heap **before** any slicing applies; the
file's header comment claims protection against "huge bodies" that only holds
post-parse. A misbehaving (not necessarily hostile) upstream returning a
multi-GB body — or a fast large body inside the 5s timeout — can OOM the single
Node process that runs **every** Mastra agent and workflow.

This is the keeper because, unlike the other two, its value is **independent of
the seeker's exposure level**: even Studio-only, a buggy RAG response can OOM the
shared process. It also doesn't get superseded by any other ticket.

Requirements:

- Bound the buffered read at a max-bytes ceiling, applied to **both** uncapped
  read sites — the success body (`:217`) and the error path (`readUpstreamReason`,
  `:123`) — since a multi-GB _error_ body OOMs the shared process identically to a
  success body. Stream the body with a byte counter rather than trusting
  `Content-Length` alone (the header can be absent or wrong).
- A body over the cap maps to the **existing** graceful failure
  (`parse_error` → agent surfaces `unavailable`), never a throw — the typed
  no-throw result-union contract and the `{ status, sources, message? }` tool
  shape are unchanged.
- Default ceiling: a sane low single-digit MB. Any new env knob is `.optional()`
  with a runtime fallback — **zero** new required-at-boot env vars (the skeleton
  added none; a required var with no default bricks Railway deploys).

### Deferred — ② in-memory `Memory` eviction (superseded by feat-208)

`getSeekerMemory()` (`apps/mastra/src/mastra/memory.ts:84`) is an unbounded
process-lifetime `InMemoryStore` singleton — no `lastMessages` cap, no TTL.
Sustained traffic across many `threadId`s grows heap until a restart.

**Not built here, and not ported into feat-208.** feat-208 moves seeker memory
from RAM to Postgres along the path the same file already proves for
experience-chat (`buildExperienceChatMemory`, `memory.ts:293`); the seeker's own
header calls this module _"the single-responsibility seam where the eventual
in-memory → Postgres/PgVector swap lands later."_ Once memory lives in Postgres,
the specific risk #2 guards against — RAM growing until the shared process OOMs —
**is eliminated, not relocated**: history lives on disk, not the Node heap.

What survives is milder and native to feat-208: unbounded growth downgrades to
_more rows in a table_ (disk + query cost), a routine retention concern handled
with an ordinary TTL/prune policy when designing the persistent store — **not** a
port of in-memory eviction code. Note also that Mastra's `lastMessages` cap
bounds per-thread context, not thread _count_, so it wouldn't even fully address
the stated thread-count risk; Postgres retention is the right home.

Interim risk is low but not zero. ③ notes any _in-network_ caller can reach the
agent — so the store isn't strictly "operator test threads only" — but the seeker
is still network-gated (not public) and the `InMemoryStore` is wiped on every
deploy, so threads accumulate only within a single deploy window and only from
first-party/dogfooding traffic. No stopgap is built.

**Deferral precondition + tripwire.** Deferring ② is safe only if feat-208 both
(a) lands and (b) keeps conversation history off the Node heap (the Postgres
move). The observable trigger to revisit an interim in-memory guard is exposure
change, not a traffic metric (the store is wiped every deploy, so there is no
persistent counter to watch): revisit if feat-208 is not in-progress by the time
feat-202 ships, **or** if the seeker is promoted beyond Studio/dogfooding
exposure — whichever comes first.

> **Hand-off to feat-208:** when designing the Postgres-backed seeker memory,
> decide _whether_ a retention/prune policy is needed at all (thread TTL and/or
> per-thread message cap) — keeping all conversations indefinitely is a valid
> choice. Non-binding; the heap-OOM risk is gone with Postgres, leaving only
> ordinary table growth. This is the only residue of feat-202 #2.

### Build now — ③ default step budget on the agent + a routing convention note

`seeker-agent.ts` has no `maxSteps` on the `Agent` constructor. The
production-shaped path already enforces a ceiling — `/forge-seeker`
(`seeker-route.ts:272,198`) sets `maxSteps: STEP_CAPS.toolCallingTurn` (8) +
`budgetMs = TIME_BUDGET_MS.chatTurn` (90s), and `JESUSFILM_RAG_TIMEOUT_MS`
defaults to 5s (`.max(30_000)`), so 5s ≪ 90s holds — but that budget lives at the
_route call site_, not on the agent.

The gap (corrected framing): Mastra's built-in `/api/agents/seekerAgent` surface
is **code-unauthenticated** (`seeker-route.ts:19` calls `/forge-seeker` _"MORE
locked down than Mastra's built-in unauthenticated `/api/agents/_`"*) and carries
**no budget**. The only thing gating it is network reachability to the Mastra
runtime — and our own apps already have that (the chat app calls `/forge-seeker`
on the same runtime). So **any in-network caller** could call the agent directly
and bypass the route's budget, not just Studio operators. That is worth a default
floor.

Two pieces:

1. **A code floor** — set `defaultOptions: { maxSteps: STEP_CAPS.toolCallingTurn }`
   on the seeker `Agent` constructor, reusing the **same** shared constant the
   route uses (one source of truth; the two paths can't diverge).
2. **A routing convention** — a short note in `apps/mastra/CLAUDE.md` (next to the
   seeker "Containment" / "Service route" sections): apps and services must call
   the bearer-gated `/forge-seeker` route, **never** the built-in
   `/api/agents/seekerAgent` surface, which is unauthenticated and unbudgeted.

Neither piece is an _enforcement_ control: the floor is overridable (below) and
the note is honor-system. They do not close the unauthenticated surface — the
binding containment is and stays the network/gateway boundary; these are
defense-in-depth and drift-prevention on top of it. (A CI grep asserting no
first-party caller references `/api/agents/seekerAgent` could harden the
convention into a real check; deferred, not built here.)

Verified the floor is not cosmetic (against installed `@mastra/core@1.36.0` +
`@mastra/server@1.36.0`): the built-in vNext handlers call `agent.stream()` /
`agent.generate()` (distinct from the `*Legacy` variants), and core's
`stream()`/`generate()` both `deepMerge(getDefaultOptions(), perCallOptions)`
with the per-call value winning — so a call that omits `maxSteps` inherits the
constructor default. Two qualifications:

- It is a **default floor, not an un-overridable ceiling**: deep-merge lets an
  explicit per-call `maxSteps` win, so a caller that _explicitly_ sends a huge
  value still overrides it. This protects the realistic case (Studio, or an app
  that bypasses the route without thinking), the same property the route's budget
  has — not a hard cap against a determined caller on the open path.
- Set it on **`defaultOptions`** (the vNext field the seeker's `.stream()` uses),
  **not** `defaultStreamOptionsLegacy` (which feeds only the unused legacy routes).

This covers the step (runaway-loop) dimension only. The direct `/api/agents/*`
path retains **no wall-clock bound**: the 90s budget is composed per-request at
the route call site and can't ride on a constructor default, and the per-tool
`JESUSFILM_RAG_TIMEOUT_MS` (5s default, `.max(30_000)` — so even the worst case
is well under 90s) bounds only the RAG **tool legs**, _not_ the LLM-generation
turns between them, which stay uncapped on this path. So step-capping does **not**
make the direct path time-bounded — a slow or stalled model turn within 8 steps
can hold the shared process past 90s. The step floor is defense-in-depth against
runaway loops, not a latency guard; the binding containment on the direct path
remains the network/gateway boundary (see the routing convention below).

### firecrawl-client's identical gap — noted, no separate ticket

`apps/mastra/src/services/firecrawl-client.ts` has the same uncapped
`await response.json()` (`:212`, `:329`). It is **deliberately not touched** by
feat-202: firecrawl is out of the AI-chat lane, its work is unrelated, and the
shared helpers (`endpoint` / `safeReason` / `readUpstreamReason`) were
intentionally duplicated, not extracted (rag client header, `:27`). Extracting
them into a shared module would couple an out-of-lane client into chat-lane work
for no chat-lane benefit — the wrong abstraction. Recorded here as a known
residual per the owner's choice; no follow-up ticket created.

To be explicit about the risk (not just the ownership): the firecrawl OOM
exposure is **real and identical to ①'s** — exposure-independent, against the
same shared Node process — so this is _not_ a claim that firecrawl is safe. It is
a scope decision. The build/accept split here is **organizational, not
risk-tiered**: firecrawl carries an identical risk and would equally merit a cap —
it is left to its owners purely because cross-lane scope expansion costs more than
the chat lane should absorb, _not_ because its risk is lower. So the risk is
consciously **accepted and left to the firecrawl owners**, not feat-202's to fix:
feat-202 deliberately neither caps nor extracts firecrawl and opens no ticket on
another lane's behalf; the observation is flagged here so it isn't lost (the
original feat-202 ticket already noted the shared "fix both clients" pattern, so
the owners have prior awareness).

## Scope boundaries

**In scope:** byte-cap on `jesusfilm-rag-client.ts` only; a default
`maxSteps` (`defaultOptions`, shared `STEP_CAPS.toolCallingTurn`) on the seeker
`Agent`; a `/forge-seeker`-not-`/api/agents` routing-convention note in
`apps/mastra/CLAUDE.md`; tests for the oversized-body → `unavailable` path and a
confirm-the-default test for `maxSteps`.

**Out of scope:** any change to `firecrawl-client.ts`; extracting shared HTTP
helpers; in-memory memory eviction; a per-request wall-clock budget on the
direct `/api/agents/*` path; any new required env var; any change to the
no-throw result-union or tool-result shape.

## Verification

- `pnpm --filter @forge/mastra test` — add cases where an oversized body maps to
  the graceful `unavailable` path on **both** the success body and the error path
  (`readUpstreamReason`). Test against the real over-cap behavior, not just a
  mocked branch.
- `pnpm --filter @forge/mastra typecheck && pnpm --filter @forge/mastra lint`.
- Grep `response.json()` in `apps/mastra/src/services/jesusfilm-rag-client.ts`
  and confirm every call site is byte-bounded.
- **`maxSteps` default takes effect:** invoke the seeker agent with no per-call
  `maxSteps` and assert the constructor default applies (confirm-expected-pass —
  the production server is re-bundled at `mastra build`, so verify against the
  built path, not just the installed dist).
- Confirm `apps/mastra/CLAUDE.md` carries the `/forge-seeker`-not-`/api/agents`
  routing-convention note (③'s second deliverable), next to the seeker
  Containment / Service route sections.
- Confirm no new entry in the production `missing` env list in
  `assertMastraRuntimeEnv` (no new boot requirement).

## Outstanding questions

- **Streamed read vs `Content-Length` + bounded read** — left to planning; lean
  streamed-with-byte-counter since the header is absent/spoofable.
- **Exact default cap** (e.g. 2–5 MB) — pick a concrete number in planning, sized
  comfortably above a _measured or contract-derived_ upper bound for a legitimate
  `topK=5` passage payload (≈ max passage text × 5 + citation overhead), not
  chosen by intuition — so the cap can't reject valid retrievals as `unavailable`.
