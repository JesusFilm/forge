---
id: "feat-321"
title: "Langfuse tracing for the Seeker agent"
owner: "jian wei"
priority: "P2"
status: "in-progress"
start_date: "2026-09-01"
duration: 3
depends_on: []
blocks: []
tags:
  - "ai-pipeline"
  - "infrastructure"
---

> **Stub — decision capture, not an implementation brief.** This ticket
> deliberately carries no `## What To Build`, `## Constraints`, or
> `## Verification` sections (the feat-303 precedent for a ticket with no
> implementation to direct). It exists so that whoever plans this work starts
> from the facts below instead of rediscovering them, and so the content
> decision is made deliberately rather than defaulted into. Do the planning
> fresh.

## Problem

Nothing sends traces to Langfuse today, and wiring the managed prompt into the
seeker agent (feat-272) will not change that. The prompt helper is a
hand-rolled `GET` against the Prompts API — it reads, and that is all it can
do. Tracing is a separate mechanism that has to be built.

Until it exists, Langfuse holds no record of which prompt version produced
which answer, which is the main payoff of managed prompts once prompt tuning
starts.

## Options

Decide what conversation content, if any, is sent:

1. **Raw** — full message text reaches Langfuse.
2. **Redacted at the boundary** — text stripped or masked before it leaves
   Mastra.
3. **Metadata only** — no message text; timings, token counts, prompt version.

## Entry Points — Read These First

1. `docs/plans/2026-07-20-001-feat-langfuse-prompt-helper-plan.md` — KTD1.
   This repo deliberately does **not** use the Langfuse SDK (`langfuse` /
   `@langfuse/*` are barred from every manifest), so tracing is not "turn on
   the SDK". Every vendor tutorial will tell you otherwise. Reopening that
   decision is a decision, not a default.
2. `apps/mastra/src/mastra/index.ts` — the existing `Observability` config
   (~line 301). Spans currently go to a local DuckDB store via
   `MastraStorageExporter()`; nothing leaves the box. Note
   `sensitiveDataFilter: true` and the `redactPromptBodies` span processor
   (~line 207), which already blanks span `input` and `output` wholesale — a
   Langfuse exporter added naively inherits that and produces traces with no
   content in them.
3. Traces would land in the **same `forge-mastra` Langfuse project** as the
   prompts. Langfuse's prompt-version → generation analytics only resolve
   within a single project, so moving traces to a separate project to isolate
   them forfeits the linkage that motivates tracing in the first place. Weigh
   that before treating a separate trace project as free.

## Decide Before It Ships

- Which of the three options above, and why.
- Re-check whether Langfuse has introduced scoped or read-only API keys. The
  research behind the plan's risk statements is dated 2026-07 (discussions
  #1692); if a read scope has shipped since, several of them need re-deriving.

## Prior Art

- `JesusFilm/core` — `apps/journeys/src/libs/langfuse/client.ts` and
  `pages/api/chat/index.ts` send message content and scrub downstream in
  `tools/langfuse-export/`. That team uses the Langfuse SDK, which is why
  prompt management and tracing arrive bundled for them and separately here.
- `apps/mastra/src/mastra/index.ts` — `redactPromptBodies` is this repo's
  existing answer to the same question for Datadog-bound spans.
