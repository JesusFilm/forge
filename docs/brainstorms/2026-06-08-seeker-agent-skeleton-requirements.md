# Seeker Agent Skeleton — Requirements

- **Date:** 2026-06-08
- **Status:** Ready for planning
- **Lane (proposed):** `ai-chat` — *Jesus Film AI Chat*, the headless multi-agent system (pending team decision — see Dependencies)
- **Roadmap ticket:** `docs/roadmap/ai-chat/feat-169-seeker-agent-skeleton.md`
- **Branch:** `feat/seeker-agent-skeleton` (do not push to `main` until the lane decision lands)

## Problem

Jesus Film AI Chat is a planned **headless, multi-agent AI chat system** — a backend agent service with no UI of its own, intended to be surfaced through its own web UI and embedded into existing products like Watch and Core. Each agent has tools and (eventually) RAG-grounded retrieval. The **seeker agent** — for people exploring Christianity and who Jesus is — is the **first agent** in that system. Further agents — such as one for Christians and one that describes the organization — will follow, but have no concrete plans yet.

This work skeletons that first agent: a real Mastra agent wired with a tool and memory, exercisable locally in Studio, proving the end-to-end shape (chat → tool-call → remembered context) the broader system will build on.

## Goal

Stand up a **seeker agent** in `apps/mastra` with one stub retrieval tool and Mastra Memory, exercised entirely through Mastra Studio against the in-memory storage backend. Done means: it converses, the tool visibly fires on a factual question, and earlier turns in a thread are remembered.

## Audience

People seeking to understand Christianity and who Jesus is. This is a **sensitive audience** — see the guardrail gate under Constraints. The skeleton is *not* for real seekers yet; it is exercised by the team in Studio only.

## Approach — mirror admin's proven pattern, copy don't import

`apps/admin/src/mastra` already contains a complete conversational-agent setup: chat agents, a `tools/` folder using `createTool` (`search-videos`, `lookup-bible-verse`, `fetch-video-image`), a `memory.ts` with Postgres + PgVector semantic recall, scorers, and prompts. That is admin's internal Experience-AI authoring assistant — a different audience, but the *mechanics* are exactly what the seeker agent needs.

`apps/mastra` architecture rules **forbid importing from `apps/admin`**. So admin is a **reference to mirror, not a dependency to import**. The seeker agent copies the shape (agent registration, `createTool`, Memory wiring) into `apps/mastra`.

The local memory story already exists: `apps/mastra` wires `MASTRA_STORAGE_BACKEND=memory` → `InMemoryStore` today (`apps/mastra/src/mastra/index.ts` + `apps/mastra/src/config/env.ts`), and production rejects `memory`. No new storage work is needed for the skeleton.

## In Scope

1. **`seeker-agent.ts`** in `apps/mastra/src/mastra/agents/`, registered in `apps/mastra/src/mastra/index.ts`. **Minimal placeholder instructions** only: it helps people exploring Christianity / who Jesus is, is warm and honest, and uses the retrieve tool to ground factual answers. (Full persona + guardrails deferred — see Constraints.)
2. **New `apps/mastra/src/mastra/tools/` folder + one stub tool** (working name `retrieve-answer`) built with `createTool`. Shaped like the eventual RAG contract so the real swap is a drop-in:
   - input: `{ query: string, locale?: string }`
   - output: `{ answer: string, sources: [] }` — returns a hard-coded answer + empty `sources`.
3. **Mastra Memory** attached to the seeker agent, verified via the already-wired in-memory backend (wipes each session).
4. **`apps/mastra/CLAUDE.md`: a new "Seeker agent" section** documenting how to stand it up locally — the `MASTRA_STORAGE_BACKEND=memory pnpm --filter @forge/mastra dev` command + Studio steps — plus a brief "not wired yet" note pointing at the deferred set below. Also note that observability traces appear in Studio automatically (inherited from the instance-level `Observability` config; `redactPromptBodies` blanks prompt bodies — well-aligned with the sensitive audience). No observability code is added for the skeleton.
5. **Verification = Studio**: it converses; the `retrieve-answer` tool visibly fires on a factual question; earlier turns are remembered within a thread.

## Out of Scope (Deferred)

These are recorded here so planning does not pull them in, and so the deferral is durable:

- **Real RAG / actual retrieval backend.** The stub returns a hard-coded answer. The eventual tool keeps the same I/O contract.
- **Public-facing web surface.** Today `apps/mastra` is an internal Railway service — every route is service-bearer-protected. A public seeker surface is a separate, later piece.
- **Persisted Postgres memory.** Local skeleton uses the in-memory backend. Admin already proves the Postgres + PgVector path when we want persistence.
- **Full persona + safety guardrails.** See Constraints — this is a release gate, not skeleton work.
- **Agent evals.** Faithfulness/groundedness once RAG lands; safety scoring tied to the guardrail gate. Investigate Mastra's eval/scorer options when this arises — the existing `search-eval` suite and `chat-thumb-rating` scorer are useful reference for *how Mastra evals are wired in this repo*, but a seeker agent's eval criteria are their own problem and shouldn't be assumed to copy that shape.

## Constraints

- **Guardrails are a release gate.** This agent must NOT be exposed to real seekers until it has fabrication/honesty/crisis-deferral guardrails (never invent scripture or citations; be honest it is an AI; defer gracefully on crisis/medical topics; avoid doctrinal hard-lines, surface uncertainty). The skeleton ships with minimal placeholder instructions and stays Studio-only.
- **Do not import from `apps/admin`** (or `apps/manager`, `apps/auth`). Mirror the pattern by copying.
- **Do not push this branch to `main`** until the `ai-chat` lane decision lands (see Dependencies).

## Dependencies / Outstanding Questions

1. **`ai-chat` lane is pending a team decision.** The team needs to agree on how the roadmap documents new lanes before `ai-chat` is added to the repo's canonical surfaces. Until then, on this branch:
   - **Apply:** the `feat-169` ticket file + this requirements doc.
   - **Recipe only (do NOT apply):** root `CLAUDE.md` Roadmap Structure tree + tag-vocabulary edits, and the four hardcoded lane spots in `apps/roadmap/lib/`. These are captured in `todos/007-pending-p2-ai-chat-roadmap-lane-pending-team-decision.md`.
2. **Roadmap app impact (flagged, not investigated).** The roadmap viewer hardcodes its lanes — a `feat-169` file in `docs/roadmap/ai-chat/` will be **silently ignored** (not rendered, no crash) until these four spots learn about `ai-chat`:
   - `apps/roadmap/lib/features.ts` — the `Lane` type union (~line 11)
   - `apps/roadmap/lib/features.ts` — `LANE_DIRS` (~line 52)
   - `apps/roadmap/lib/markdown.ts` — `README_LANE_ORDER` (~line 5)
   - `apps/roadmap/lib/features.ts` — `getLaneLabel()` mapping (~line 228)
3. **Tag vocabulary.** No existing roadmap tag fits an AI chatbot cleanly (closest is `ai-pipeline`, which is embeddings). A new tag (`agent` or `ai-chat`) is likely wanted — part of the same pending lane decision.

## References

- `apps/mastra/src/mastra/agents/smoke-agent.ts` — sibling agent + registration pattern.
- `apps/mastra/src/mastra/index.ts` — agent/tool registration, storage backend switch.
- `apps/mastra/src/config/env.ts` — `MASTRA_STORAGE_BACKEND` handling.
- `apps/mastra/CLAUDE.md` — per-capability section pattern to follow.
- `apps/admin/src/mastra/tools/` — `createTool` reference (mirror, do not import).
- `apps/admin/src/mastra/memory.ts` — Memory wiring reference.
