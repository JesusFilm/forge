---
id: "feat-170"
title: "Seeker Agent Skeleton"
owner: "jianwei"
priority: "P2"
status: "complete"
start_date: "2026-06-09"
duration: 3
depends_on:
  - "feat-129"
blocks: []
tags:
  - "ai-chat"
  - "agent"
---

> **Plan / implementation record:**
> `docs/plans/2026-06-08-003-feat-seeker-agent-skeleton-plan.md` is the
> authoritative record of technical decisions and what actually shipped. Where
> it and this ticket differ, the plan wins (e.g. the dedicated-store note on
> "What To Build" item 3 below).

## Problem

Jesus Film AI Chat is a planned headless, multi-agent AI chat system (a backend
agent service with no UI of its own, later surfaced via a web UI and embedded
in products like Watch and Core). The **seeker agent** — for people exploring
Christianity and who Jesus is — is the first agent in that system. Further
agents — such as one for Christians and one that describes the organization —
will follow, but have no concrete plans yet. This work skeletons that first
agent in `apps/mastra`, proving the agent + tool + memory shape end-to-end in
Studio (chat -> tool-call -> remembered context).

`apps/mastra` already hosts the Mastra runtime (feat-129) but has only the
smoke agent and embedding/eval workflows — no conversational agent, no tools
folder. `apps/admin/src/mastra` has a complete chat-agent + tools + memory
pattern, but `apps/mastra` is forbidden from importing `apps/admin`, so admin
is a reference to mirror, not a dependency.

> Lane/tags note: `ai-chat` lane and `ai-chat`/`agent` tags are PROPOSED and
> pending a team decision on roadmap-lane documentation. This file lives on the
> `feat/seeker-agent-skeleton` branch only and is not on `main`. The roadmap
> viewer will not render it until the lane is registered. See
> `todos/007-pending-p2-ai-chat-roadmap-lane-pending-team-decision.md`.

## Entry Points - Read These First

1. `docs/brainstorms/2026-06-08-seeker-agent-skeleton-requirements.md` — chosen
   scope, deferred set, and the guardrail release gate.
2. `apps/mastra/src/mastra/agents/web-research-agent.ts` — PRIMARY template:
   in-app `Agent` with instructions + tools (same app, no import restriction).
3. `apps/mastra/src/mastra/tools/firecrawl.ts` — PRIMARY template: in-app
   `createTool` with Zod schemas and an `ok:false` failure shape.
4. `apps/mastra/src/mastra/agents/smoke-agent.ts` — minimal sibling agent.
5. `apps/mastra/src/mastra/index.ts` — agent/tool registration
   (`agents: { smokeAgent, webResearchAgent }`) + the `MASTRA_STORAGE_BACKEND`
   storage switch (`InMemoryStore` vs `PostgresStore`).
6. `apps/mastra/src/config/env.ts` — `MASTRA_STORAGE_BACKEND` handling and the
   production `memory`-rejection guard.
7. `apps/mastra/CLAUDE.md` — per-capability section pattern; add a "Seeker
   agent" section in the same style.
8. `apps/admin/src/mastra/memory.ts` — Memory wiring reference (mirror, do not
   import; the in-app pattern has no memory, so this is the one piece admin
   covers).

## Grep These

- `new Agent(` in `apps/mastra/src` — agent construction + registration.
- `agents: {` in `apps/mastra/src/mastra/index.ts` — where to register the agent.
- `createTool` in `apps/mastra/src/mastra/tools` — in-app tool definition pattern.
- `MASTRA_STORAGE_BACKEND|InMemoryStore` in `apps/mastra/src` — memory backend.
- `new Memory(` in `apps/admin/src/mastra` — memory attach pattern (admin only).

## What To Build

1. `apps/mastra/src/mastra/agents/seeker-agent.ts` — a `new Agent(...)` with
   minimal placeholder instructions (helps people exploring Christianity / who
   Jesus is; warm and honest; uses `retrieve-answer` to ground factual
   answers). Include one safety line even at placeholder level: the agent is a
   non-production prototype and must not invent scripture, citations, or
   doctrinal claims, even in Studio. Register it in
   `apps/mastra/src/mastra/index.ts` `agents: { ... }`.
2. `apps/mastra/src/mastra/tools/` (folder already exists) — add one stub tool
   `retrieve-answer` via `createTool`, following the same-app `firecrawl.ts`
   shape. The I/O is a PROVISIONAL placeholder, NOT a finalized RAG contract
   (RAG is undesigned — not a drop-in):
   - input: `{ query: string, locale?: string }`
   - output: `{ answer: string, sources: [] }` — hard-coded answer, empty
     `sources`.
     Real retrieval will likely return passage-shaped `sources`
     (`{ text, ref, score? }`, cf. admin's `search-videos` / `lookup-bible-verse`,
     which return structured results, not a finished answer). Final shape deferred
     to RAG design. Wire it onto the agent via `tools: { retrieveAnswer }`.
3. Add the `@mastra/memory` dependency to `apps/mastra` (NOT yet present — only
   `apps/admin` has it) and wire a `Memory` instance against the existing
   `InMemoryStore`. The `InMemoryStore` is app-level storage, not the Memory
   primitive — the storage tier is free, the primitive is new work. Memory
   wipes on process restart, not per session.
   **Superseded by plan KTD1:** the shipped implementation wires a **dedicated**
   `InMemoryStore` in `memory.ts` (not the app-level store) — so the seeker's
   memory physically cannot persist to Postgres and there is no circular import.
   See the plan's KTD1 for the rationale.
4. Add a single commented guardrail attach-point in the agent/tool flow marking
   where later honesty / crisis-deferral checks will hook (breadcrumb, no logic).
5. Route-isolation test: assert the seeker agent is NOT attached to any
   `registerApiRoute` (stays Studio-only) — a cheap self-enforcing guard for the
   release gate. Heavier enforcement deferred until a public surface exists.
6. `apps/mastra/CLAUDE.md` — new "Seeker agent" section: the local run command
   (`MASTRA_STORAGE_BACKEND=memory pnpm --filter @forge/mastra dev`), Studio
   steps, a brief "not wired yet" note listing the deferred set, and a one-line
   note that observability traces appear in Studio automatically (inherited
   from the instance-level `Observability` config; the `redactPromptBodies`
   span processor blanks `input`/`output` on all spans, tool spans included; no
   new observability code).
7. Colocated unit tests next to the agent and tool (match `smoke-agent.test.ts`).

## Constraints

- Minimal placeholder instructions ONLY. Full persona + safety guardrails are a
  DEFERRED release gate — do not author them here, and do not expose this agent
  to real seekers. Studio-only. The eventual gate must explicitly cover crisis
  handling (suicidal-ideation / self-harm / acute distress → route to human /
  helpline resources, never improvise).
- Stub tool returns a hard-coded answer; do NOT build real retrieval. Treat its
  shape as provisional, not a contract.
- No public-facing surface; no Postgres-persisted memory.
- In-memory storage is process-lifetime, not per-session: use distinct
  `threadId`s per tester so sensitive test inputs don't leak across testers in
  one Studio process.
- Do NOT import from `apps/admin`, `apps/manager`, or `apps/auth` — mirror the
  pattern by copying. Divergence accepted as a one-time bootstrap; maintained
  independently.
- Do NOT push this branch to `main` until the `ai-chat` lane decision lands.

## Verification

- `pnpm --filter @forge/mastra typecheck` and `pnpm --filter @forge/mastra test`
  pass.
- `MASTRA_STORAGE_BACKEND=memory pnpm --filter @forge/mastra dev` boots Studio.
- In Studio: the seeker agent converses; asking a factual question visibly
  fires `retrieve-answer` (hard-coded answer returned); a follow-up turn shows
  earlier context is remembered within the thread (assert correct `threadId`
  scoping so this can't pass by accident on a shared thread).
- Route-isolation test passes: the seeker agent is not wired to any
  `registerApiRoute`.
