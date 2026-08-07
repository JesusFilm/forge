---
id: "feat-321"
title: "Langfuse tracing for the Seeker agent"
owner: "jian wei"
priority: "P2"
status: "complete"
start_date: "2026-07-29"
duration: 3
depends_on: []
blocks:
  - "feat-336"
  - "feat-337"
tags:
  - "ai-pipeline"
  - "infrastructure"
---

## Resolution

**Shipped:** 2026-08-05 via [PR #TBD](https://github.com/JesusFilm/forge/pulls) (`feat(mastra): Langfuse tracing for the seeker agent (ai-chat feat-321)`).

**What landed.** Opt-in Langfuse tracing for `/forge-seeker` turns behind the
default-off `LANGFUSE_TRACING_ENABLED` string-boolean: a second observability
config (`langfuse-seeker`) exporting RAW conversation content — the owner's
content decision, option 1 of the three this ticket posed — with session
(`threadId`), user (`resource`), and `seeker-system` prompt-version
provenance stamped on the root span, verified end-to-end against the real
`forge-mastra` project on 2026-07-29. Implementation lives in
`apps/mastra/src/mastra/langfuse-tracing.ts` (config builder, selector,
per-turn call-options helper) with the route stamping in
`agents/seeker-route.ts` via a `getPromptProvenance` seam.

Decisions taken beyond the brief, all 2026-08-05 unless noted:

- **Langfuse-ONLY export.** The raw config carries no storage exporter, so
  no raw (or redacted) local DuckDB copy exists — retention and erasure
  govern one store. Accepted: seeker runs leave Studio's trace viewer while
  enabled, and a Langfuse outage drops those spans.
- **Retention 30/180 days** mirroring the ai-chat Postgres windows, to be
  enforced by a DIY sweep (feat-336, NOT yet shipped) rather than the paid
  configurable-retention tier.
- **Per-user erasure across both stores** (Langfuse traces + `ai_chat`
  Postgres) tracked in feat-337; the existing runbook covered Postgres only.
- **`LANGFUSE_MEDIA_UPLOAD_ENABLED` code-defaulted to `"false"`** on the
  enabled path — the SDK's auto media upload defaults ON and
  `@mastra/langfuse` 1.4.6 exposes no code-level option. A blank value is
  treated as unset (the SDK reads only exact `"false"`/`"0"` as disabled).
- **Key custody re-affirmed:** the full-access Langfuse pair now guards raw
  conversations, not just prompt text; two pairs, Railway pair never leaves
  Railway.
- **KTD1 scoped, not reversed:** `@mastra/langfuse` transitively installs the
  Langfuse SDK, exercising the reopening feat-303's KTD1 reserved for
  tracing. The prompt-READ path stays hand-rolled; a dated SCOPED note on
  `docs/solutions/tooling-decisions/langfuse-prompt-api-contract-and-sdk-rejection.md`
  records the boundary.

**Review.** `/ce-code-review` ran twice — once over the full feature (12
findings; 9 applied, incl. a security fix replacing the guessable
config-name routing marker with an unguessable per-process token after the
reviewer proved Mastra's unauthenticated `/api/agents/*` merges body-supplied
`requestContext`, and structural enforcement of the `default`-first config
ordering) and once over the Langfuse-only + media-default delta (4 reviewers;
the empty-string `??=` hole and stale CLAUDE.md passages found and fixed).
The tree then passed an INDEPENDENT verification session (verdict: ready with
conditions): suites re-run from scratch, the marker-forgery defense, the
`default`-first ordering invariant, and the media-upload env default each
re-derived against the installed `@mastra/*` and `@langfuse/otel` dists
rather than taken from this ticket, and the ordering guard deliberately
falsified and restored to prove its test actually fails when broken.

**Compound docs.**
`docs/solutions/tooling-decisions/langfuse-vs-mastra-native-management-layer-20260805.md`
(platform decision + flip triggers),
`docs/solutions/best-practices/order-sensitive-registry-config-structural-enforcement.md`,
`docs/solutions/security-issues/mastra-body-merged-requestcontext-forgeable-markers.md`,
plus a dated update to
`docs/solutions/integration-issues/mastra-editor-peer-range-false-negative-20260722.md`
(ported to `main` here; its version blocker dissolved in PR #1794).

**Residual risk / follow-ups.** Tracing ships OFF: enabling it in Railway is
gated on feat-336 (retention) and feat-337 (erasure), plus setting
`LANGFUSE_MEDIA_UPLOAD_ENABLED=false` explicitly and re-running one live
seeker-turn smoke (the pre-review smoke used the now-replaced name marker).
No exporter flush on SIGTERM — the final batch is lost per redeploy
(observability only). `LangfuseExporter` DOES expose `flush()`/`shutdown()`;
what is missing is a server-lifecycle hook that calls them, so the remedy is
a self-registered `process.on("SIGTERM")` — deferred, not blocked.
Release-gating concerns beyond this ticket are registered in feat-339.

**Unblocked.** feat-336, feat-337 (both depend on this export existing);
feat-339 references all three.

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
