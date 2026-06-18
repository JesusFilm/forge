# Seeker Agent Skeleton — Requirements

- **Date:** 2026-06-08
- **Status:** Ready for planning
- **Lane (proposed):** `ai-chat` — _Jesus Film AI Chat_, the headless multi-agent system (pending team decision — see Dependencies)
- **Roadmap ticket:** `docs/roadmap/ai-chat/feat-198-seeker-agent-skeleton.md`
- **Branch:** `feat/seeker-agent-skeleton` (do not push to `main` until the lane decision lands)

## Problem

Jesus Film AI Chat is a planned **headless, multi-agent AI chat system** — a backend agent service with no UI of its own, intended to be surfaced through its own web UI and embedded into existing products like Watch and Core. Each agent has tools and (eventually) RAG-grounded retrieval. The **seeker agent** — for people exploring Christianity and who Jesus is — is the **first agent** in that system. Further agents — such as one for Christians and one that describes the organization — will follow, but have no concrete plans yet.

This work skeletons that first agent: a real Mastra agent wired with a tool and memory, exercisable locally in Studio.

## Goal

Stand up a **seeker agent** in `apps/mastra` with one stub retrieval tool and Mastra Memory, exercised entirely through Mastra Studio against the in-memory storage backend. Done means: it converses, the tool visibly fires on a factual question, and earlier turns in a thread are remembered.

**What this retires beyond admin's existing pattern** (so the skeleton isn't just re-proving a known shape): it stands up the `Memory` primitive against `apps/mastra`'s `InMemoryStore` specifically, establishes the seeker tool's (provisional) contract, and bootstraps the agent in the runtime app. The chat→tool→memory criteria are the floor that confirms the wiring, not the point — the genuinely novel risks (RAG contract, guardrail enforcement, audience safety) are deferred and called out below.

## Audience

People seeking to understand Christianity and who Jesus is. This is a **sensitive audience** — see the guardrail gate under Constraints. The skeleton is _not_ for real seekers yet; it is exercised by the team in Studio only.

## Approach — follow the in-app pattern; admin for Memory wiring only

`apps/mastra` now has its **own** agent-with-tools prior art (added by feat-169, the Firecrawl web-data work): `apps/mastra/src/mastra/agents/web-research-agent.ts` is an `Agent` with instructions + tools, and `apps/mastra/src/mastra/tools/firecrawl.ts` is a same-app `createTool` with Zod schemas and an `ok: false` failure shape, registered in `index.ts` as `agents: { smokeAgent, webResearchAgent }`. **This is the primary template** — same app, no import restriction, exactly the shape the seeker agent and its stub tool need. The `tools/` folder already exists; we add a file to it, not create it.

The one piece the in-app pattern does **not** cover is **Mastra Memory** — `web-research-agent` has no memory. For that, `apps/admin/src/mastra/memory.ts` is the reference (Postgres/PgVector there, but the `Memory` wiring shape transfers). `apps/mastra` architecture rules **forbid importing from `apps/admin`**, so admin is a **reference to mirror, not a dependency**. **Sync stance:** divergence is accepted as a one-time bootstrap; this skeleton is maintained independently. (Whether the two Mastra setups should later share code is an open question for another day — not decided here.)

The local **storage backend** already exists, but the **Memory primitive does not**: `apps/mastra` wires `MASTRA_STORAGE_BACKEND=memory` → `InMemoryStore` today (`apps/mastra/src/mastra/index.ts` + `apps/mastra/src/config/env.ts`), and production rejects `memory`. That `InMemoryStore` is _app-level Mastra storage_ — it is **not** the `@mastra/memory` `Memory` primitive an agent needs for thread recall, and `@mastra/memory` is **not yet a dependency of `apps/mastra`** (only `apps/admin` has it). So the skeleton must add the `@mastra/memory` dependency and wire a `Memory` instance against the existing `InMemoryStore`: the storage tier is free, the Memory primitive is new work.

## In Scope

1. **`seeker-agent.ts`** in `apps/mastra/src/mastra/agents/`, registered in `apps/mastra/src/mastra/index.ts`. **Minimal placeholder instructions** only: it helps people exploring Christianity / who Jesus is, is warm and honest, and uses the retrieve tool to ground factual answers. (Full persona + guardrails deferred — see Constraints.) Even at placeholder level, the instructions carry one safety line: the agent is a **non-production prototype and must not invent scripture, citations, or doctrinal claims** — even in Studio testing. This bounds the blast radius of any leaked/screenshotted test output before the guardrail gate is met.
2. **One stub tool in the existing `apps/mastra/src/mastra/tools/` folder** (working name `retrieve-answer`) built with `createTool`, following the same-app `tools/firecrawl.ts` shape. Its I/O is a **provisional placeholder, NOT a finalized RAG contract** (RAG is undesigned — do not treat this as a drop-in):
   - input: `{ query: string, locale?: string }`
   - output: `{ answer: string, sources: [] }` — hard-coded answer + empty `sources`.
     Real retrieval will likely return passage-shaped `sources` (`{ text, ref, score? }`, cf. admin's `search-videos` / `lookup-bible-verse`, which return structured results rather than a finished answer). The final shape is deferred to RAG design; this stub exists only to prove the agent calls _a_ tool.
3. **Mastra Memory** attached to the seeker agent — add the `@mastra/memory` dependency to `apps/mastra` and wire a `Memory` instance against the existing `InMemoryStore`. Verified via the in-memory backend, which **wipes on process restart (not per user-session)** — see Constraints for the threadId implication.
4. **Guardrail attach-point breadcrumb**: a single commented marker in the agent/tool flow showing _where_ later guardrail checks (honesty / crisis-deferral) will hook. No logic — just a breadcrumb so the deferred gate has a visible home in the code.
5. **Route-isolation test**: a unit test asserting the seeker agent is **not** attached to any `registerApiRoute` (it stays Studio-only). Cheap, self-enforcing guard for the release gate; the heavier enforcement mechanism (boot assertion / verified flag) is deferred until a public surface is actually built.
6. **`apps/mastra/CLAUDE.md`: a new "Seeker agent" section** documenting how to stand it up locally — the `MASTRA_STORAGE_BACKEND=memory pnpm --filter @forge/mastra dev` command + Studio steps — plus a brief "not wired yet" note pointing at the deferred set below. Also note that observability traces appear in Studio automatically (inherited from the instance-level `Observability` config; the `redactPromptBodies` span processor blanks `input`/`output` on **all** spans, tool spans included — well-aligned with the sensitive audience). No observability code is added for the skeleton.
7. **Verification = Studio**: it converses; the `retrieve-answer` tool visibly fires on a factual question; earlier turns are remembered within a thread (assert correct `threadId` scoping so the memory check can't pass by accident on a shared thread).

## Out of Scope (Deferred)

These are recorded here so planning does not pull them in, and so the deferral is durable:

- **Real RAG / actual retrieval backend.** The stub returns a hard-coded answer. The real tool's I/O contract is **not yet designed** — the stub's shape is provisional (see In Scope #2), not a contract the real system is bound to.
- **Public-facing web surface.** Today `apps/mastra` is an internal Railway service — every route is service-bearer-protected. A public seeker surface is a separate, later piece.
- **Persisted Postgres memory.** Local skeleton uses the in-memory backend. Admin already proves the Postgres + PgVector path when we want persistence.
- **Full persona + safety guardrails.** See Constraints — this is a release gate, not skeleton work.
- **Agent evals.** Faithfulness/groundedness once RAG lands; safety scoring tied to the guardrail gate. Investigate Mastra's eval/scorer options when this arises — the existing `search-eval` suite and `chat-thumb-rating` scorer are useful reference for _how Mastra evals are wired in this repo_, but a seeker agent's eval criteria are their own problem and shouldn't be assumed to copy that shape.

## Constraints

- **Guardrails are a release gate.** This agent must NOT be exposed to real seekers until it has fabrication/honesty/crisis-deferral guardrails (never invent scripture or citations; be honest it is an AI; avoid doctrinal hard-lines, surface uncertainty). **Crisis handling is named explicitly**: the gate must cover suicidal-ideation / self-harm and acute-distress inputs — route to appropriate human/helpline resources, never improvise pastoral or medical advice. The skeleton ships with minimal placeholder instructions and stays Studio-only.
- **In-memory storage is process-lifetime, not per-session.** `InMemoryStore` clears on process restart, so within one running Studio process testers share state. Use distinct `threadId`s per tester (and restart between sessions) so one tester's thread — potentially sensitive spiritual-crisis test inputs — isn't visible to the next.
- **Do not import from `apps/admin`** (or `apps/manager`, `apps/auth`). Mirror the pattern by copying.
- **Do not push this branch to `main`** until the `ai-chat` lane decision lands (see Dependencies).

## Dependencies / Outstanding Questions

1. **`ai-chat` lane is pending a team decision.** The team needs to agree on how the roadmap documents new lanes before `ai-chat` is added to the repo's canonical surfaces. Until then, on this branch:
   - **Apply:** the `feat-198` ticket file + this requirements doc.
   - **Recipe only (do NOT apply):** root `CLAUDE.md` Roadmap Structure tree + tag-vocabulary edits, and the hardcoded lane spots in `apps/roadmap/` (enumerated below). These are captured in `todos/007-pending-p2-ai-chat-roadmap-lane-pending-team-decision.md`.
2. **Roadmap app impact (verified).** The roadmap viewer hardcodes its lanes in **two files** — a `feat-198` file in `docs/roadmap/ai-chat/` is **silently ignored** (not rendered, no crash), and the `/lane/ai-chat` page would **404**, until all of these learn about `ai-chat`:
   - `apps/roadmap/lib/features.ts` — the `Lane` type union (~line 11)
   - `apps/roadmap/lib/features.ts` — `LANE_DIRS` (~line 52)
   - `apps/roadmap/lib/features.ts` — `ALL_LANES` (~line 187) — drives `/lane/[lane]` static params + route guard, contributions, llms.txt
   - `apps/roadmap/lib/features.ts` — `getLaneLabel()` mapping (~line 228)
   - `apps/roadmap/lib/markdown.ts` — `README_LANE_ORDER` (~line 5)
   - `apps/roadmap/components/Sidebar.tsx` — a **second** hardcoded `ALL_LANES` copy (~line 15) **and** its own label map (~line 9) for nav
3. **Tag vocabulary.** No existing roadmap tag fits an AI chatbot cleanly (closest is `ai-pipeline`, which is embeddings). A new tag (`agent` or `ai-chat`) is likely wanted — part of the same pending lane decision.

## References

- `apps/mastra/src/mastra/agents/web-research-agent.ts` — **primary** in-app agent-with-tools template.
- `apps/mastra/src/mastra/tools/firecrawl.ts` — **primary** in-app `createTool` template (Zod schemas, `ok:false` shape).
- `apps/mastra/src/mastra/agents/smoke-agent.ts` — minimal sibling agent.
- `apps/mastra/src/mastra/index.ts` — agent/tool registration (`agents: { smokeAgent, webResearchAgent }`), storage backend switch.
- `apps/mastra/src/config/env.ts` — `MASTRA_STORAGE_BACKEND` handling.
- `apps/mastra/CLAUDE.md` — per-capability section pattern to follow.
- `apps/admin/src/mastra/memory.ts` — Memory wiring reference (mirror, do not import; admin uses Postgres/PgVector but the `Memory` shape transfers).
