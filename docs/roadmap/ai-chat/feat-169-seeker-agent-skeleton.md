---
id: "feat-169"
title: "Seeker Agent Skeleton"
owner: "jianwei"
priority: "P2"
status: "not-started"
start_date: "2026-06-09"
duration: 3
depends_on:
  - "feat-129"
blocks: []
tags:
  - "ai-chat"
  - "agent"
---

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
2. `apps/mastra/src/mastra/agents/smoke-agent.ts` — sibling agent shape.
3. `apps/mastra/src/mastra/index.ts` — agent/tool registration + the
   `MASTRA_STORAGE_BACKEND` storage switch (`InMemoryStore` vs `PostgresStore`).
4. `apps/mastra/src/config/env.ts` — `MASTRA_STORAGE_BACKEND` handling and the
   production `memory`-rejection guard.
5. `apps/mastra/CLAUDE.md` — per-capability section pattern; add a "Seeker
   agent" section in the same style.
6. `apps/admin/src/mastra/tools/lookup-bible-verse.ts` — `createTool` reference
   (mirror, do not import).
7. `apps/admin/src/mastra/memory.ts` — Memory wiring reference (mirror, do not
   import).

## Grep These

- `new Agent(` in `apps/mastra/src` — agent construction + registration.
- `agents: {` in `apps/mastra/src/mastra/index.ts` — where to register the agent.
- `MASTRA_STORAGE_BACKEND|InMemoryStore` in `apps/mastra/src` — memory backend.
- `createTool` in `apps/admin/src/mastra/tools` — tool definition pattern.
- `new Memory(` in `apps/admin/src/mastra` — memory attach pattern.

## What To Build

1. `apps/mastra/src/mastra/agents/seeker-agent.ts` — a `new Agent(...)` with
   minimal placeholder instructions (helps people exploring Christianity / who
   Jesus is; warm and honest; uses `retrieve-answer` to ground factual
   answers). Register it in `apps/mastra/src/mastra/index.ts` `agents: { ... }`.
2. `apps/mastra/src/mastra/tools/` — new folder with one stub tool
   `retrieve-answer` via `createTool`, shaped like the eventual RAG contract:
   - input: `{ query: string, locale?: string }`
   - output: `{ answer: string, sources: [] }` — hard-coded answer, empty
     `sources`.
   Wire it onto the agent via `tools: { retrieveAnswer }`.
3. Attach Mastra Memory to the seeker agent so in-thread context persists for
   the session (in-memory backend; no Postgres).
4. `apps/mastra/CLAUDE.md` — new "Seeker agent" section: the local run command
   (`MASTRA_STORAGE_BACKEND=memory pnpm --filter @forge/mastra dev`), Studio
   steps, a brief "not wired yet" note listing the deferred set, and a one-line
   note that observability traces appear in Studio automatically (inherited
   from the instance-level `Observability` config; no new observability code).
5. Colocated unit tests next to the agent and tool (match `smoke-agent.test.ts`).

## Constraints

- Minimal placeholder instructions ONLY. Full persona + safety guardrails are a
  DEFERRED release gate — do not author them here, and do not expose this agent
  to real seekers. Studio-only.
- Stub tool returns a hard-coded answer; do NOT build real retrieval.
- No public-facing surface; no Postgres-persisted memory.
- Do NOT import from `apps/admin`, `apps/manager`, or `apps/auth` — mirror the
  pattern by copying.
- Do NOT push this branch to `main` until the `ai-chat` lane decision lands.

## Verification

- `pnpm --filter @forge/mastra typecheck` and `pnpm --filter @forge/mastra test`
  pass.
- `MASTRA_STORAGE_BACKEND=memory pnpm --filter @forge/mastra dev` boots Studio.
- In Studio: the seeker agent converses; asking a factual question visibly
  fires `retrieve-answer` (hard-coded answer returned); a follow-up turn shows
  earlier context is remembered within the thread.
