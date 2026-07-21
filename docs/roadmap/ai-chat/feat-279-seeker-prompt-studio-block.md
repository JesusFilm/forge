---
id: "feat-279"
title: "Seeker system prompt as a Mastra Editor prompt block (Studio-editable)"
owner: "jaco"
priority: "P2"
status: "blocked"
start_date: "2026-07-21"
duration: 3
depends_on: []
blocks: []
tags:
  - "ai-pipeline"
  - "infrastructure"
---

## Blocked — editor/core hard incompatibility (2026-07-22)

Implementation was attempted on 2026-07-22 from the approved plan
(`docs/plans/2026-07-21-001-feat-seeker-prompt-studio-block-plan.md`) and hit
the plan's explicit stop condition: **every acceptable `@mastra/editor`
release is hard-incompatible with the app's pinned `@mastra/core@1.36.0` at
boot.** Per the plan's Product Contract, that outcome converts this effort
into comparison findings (below) rather than a shipped feature. Only U1 (the
`SEEKER_SYSTEM_PROMPT` byte-identity constant) shipped — it is
editor-independent and serves either prompt-management path.

### Verified findings (probed against real dists, not declared metadata)

- The plan's floor is `@mastra/editor >= 0.13.1` (prompt-block persistence
  fix; 0.10.x has a Studio data-loss bug — mastra-ai/mastra#18007). Every
  release in 0.13.1–0.13.7 pins `@mastra/memory` (1.21.1–1.23.0) as a hard
  dependency, and ALL of those memory versions statically import
  `modelSupportsAttachments` from `@mastra/core/llm` — an export that first
  ships in **core 1.37.0**. On core 1.36.0 the import throws `SyntaxError`
  at module load; `mastra dev` hard-crashes at boot.
- `@mastra/editor@0.13.7` itself additionally imports
  `SourceAgentsSourceControl` from `@mastra/core/storage`, which first ships
  in **core 1.43.0**. A clean-room probe confirms editor 0.13.7 constructs
  fine against core 1.43.0 and fails against 1.36.0/1.37.0. The real floor
  for the current editor is **core ≥ 1.43.0**.
- The editor's declared peer range (`@mastra/core >=1.34.0-0 <2.0.0-0`) is
  false upstream, so `pnpm install` resolves silently — zero peer warnings.
- `pnpm --filter @forge/mastra build` (`mastra build --studio`) **passes**
  with the editor wired in: the Rollup deployer externalizes `@mastra/editor`
  and never link-checks it. The build smoke is a false negative for this
  breakage class; only booting the server catches it. See
  `docs/solutions/integration-issues/mastra-editor-peer-range-false-negative-20260722.md`.

### Unblock path

Bump `@mastra/core` 1.36.0 → ≥ 1.43.0 (plus whatever `@mastra/pg` /
`@mastra/memory` / `@mastra/duckdb` / `@mastra/observability` / `mastra` CLI
bumps ride along). That is its own ticket-sized effort, NOT a rider on this
one: the repo pins several **verified-dist behavioral facts** to 1.36.0 that
must be re-verified on any core bump (see `apps/mastra/CLAUDE.md`):

- ai-chat thread-ownership fail-CLOSED contract (`getThreadById` rejects on
  store outage; `ai-chat-pg-failmode-contract.test.ts`).
- `recall` chronological return ordering (history replay contract).
- The per-entry model retry loop retrying any non-APICallError (the
  feat-237 gateway `maxRetries: 0` rationale).
- The plan's KTD2 fact that `{ status: "published" }` block reads fall back
  to the latest draft when never published (re-verify on the bumped dist).

When the bump lands, resume the 2026-07-21 plan from U2 — U1 is already on
`main` and the plan's decisions (direct block read, never the stored-agent
override path; published-status guard; fresh per-turn read; off-switch env
var; runbook-over-seeding) carry over unchanged. One resume-time adjustment
(2026-07-22 review finding): `SEEKER_SYSTEM_PROMPT` lives in
`seeker-agent.ts`, whose module scope constructs the Agent — U3's reader
imports the constant while U4 makes the agent consume the reader, a circular
import through a side-effect-bearing module. Relocate the constant to a
side-effect-free module before building U3.

## Problem

The seeker agent's full system prompt is an inline string in this public
repository — every tuning improvement is published to the internet on merge.
The team wants prompt text private and editable without code deploys, and
prefers first-party Mastra mechanisms over adding a vendor. Mastra's Agent
Editor offers prompt blocks: versioned, database-stored prompt content with
draft/publish and native fallback to the code-defined agent.

This ticket is the **first-party arm of a side-by-side comparison** with the
Langfuse-managed-prompt arm (feat-272, PR
[#1621](https://github.com/JesusFilm/forge/pull/1621) — unmerged; neither
ticket blocks the other). Comparison criteria: editing experience,
governance, reliability, operational cost, programmatic read/write
accessibility for future eval loops — and now, from the findings above,
**framework version coupling**: the Studio-block path is hostage to
`@mastra/*` release lockstep in a way the vendor path is not.

## Entry Points — Read These First

1. `docs/plans/2026-07-21-001-feat-seeker-prompt-studio-block-plan.md` — the
   full implementation-ready plan (Product Contract, KTD1–KTD11, U1–U6).
   Resume from U2 once unblocked.
2. `apps/mastra/src/mastra/agents/seeker-agent.ts` — `SEEKER_SYSTEM_PROMPT`
   (shipped U1): the exported byte-identity constant that becomes the
   fallback text, runbook paste source, and test anchor.
3. `apps/admin/src/mastra/index.ts` (~lines 36/90/146) — the admin app's
   `new MastraEditor()` construction precedent (dev-only there; this feature
   deliberately enables everywhere).
4. `apps/mastra/src/config/env.ts` — `SEEKER_ROUTE_ENABLED` is the house
   pattern for the planned `MASTRA_EDITOR_DISABLED` off-switch
   (`.optional()`, exact-`"true"`, never boot-required).

## Grep These

```
SEEKER_SYSTEM_PROMPT
MastraEditor
MASTRA_STORAGE_BACKEND
modelSupportsAttachments   # the 1.37.0+ core export the editor's memory dep needs
```

## What To Build

Once unblocked: U2–U6 of the plan — `@mastra/editor` (+ `@mastra/mcp` peer)
constructed on the Mastra instance behind an optional `MASTRA_EDITOR_DISABLED`
off-switch; a never-throw published-status-guarded prompt-block reader with
provenance logging; the seeker agent's `instructions` as a dynamic function
delegating to that reader; the per-environment manual-creation runbook; and
the delivery record. All decisions are in the plan.

## Constraints

- Nothing from the Langfuse arc (PR #1621, feat-272, Managed Prompt docs) is
  modified, closed, or retired — the comparison decision is separate
  follow-up work.
- The ten content-authoring prompts stay as code constants; only the seeker
  prompt moves.
- Byte-identity: the code fallback must serve exactly the pre-change prompt;
  no prompt line rewording rides along.

## Verification

- Blocked-state check: `pnpm --filter @forge/mastra test` green with
  `SEEKER_SYSTEM_PROMPT` pinned byte-identical to the served instructions.
- Unblock precondition: `MASTRA_STORAGE_BACKEND=memory pnpm --filter
@forge/mastra dev` boots with `@mastra/editor` constructed on the instance
  (the failing check today).
- Post-unblock: the plan's Verification Contract (unit gates + the three
  deployed operator checks AE1/AE2/AE3).
