---
id: "feat-608"
title: "Verify colleague LUMO and Shorts MCP feedback in production"
owner: "tataihono"
priority: "P1"
status: "not-started"
start_date: "2026-10-06"
duration: 1
depends_on:
  - "feat-607"
blocks: []
tags: [studio, manager, cms, infrastructure]
---

## Problem

Local regressions verify fixes for subtitle-free source selection, source focus
and instruction-read availability. They do not prove that the colleague's two
LUMO clips have usable production dub/download records or identify the exact
source-tool arguments that produced opaque errors.

## Entry Points — Read These First

1. `docs/plans/2026-10-06-studio-shorts-feedback.md` — implementation scope.
2. `skills/shorts-creator/references/authoring.md` — exact source tool inputs.
3. `apps/manager/src/services/studio-agent/mcp-tools.ts` — live tool contracts.
4. `apps/admin/src/services/studio-authoring/sources.ts` — current eligibility.
5. `apps/mastra/src/mastra/index.ts` — native instruction-read availability.

## Grep These

`6_GOLuke2611|6_GOLuke2616|shorts.source|sourcePreview|Studio agent unavailable`

## What To Build

After normal PR-to-main deployment, replay the colleague's Studio URL, client,
installed skill and redacted tool arguments. Search exact titles and confirm
published downloadable exact-language dubs and usable media URLs. Capture with
`trackId: null` when appropriate; read the returned snapshot ID and preview a
range inside the captured trim. Verify off-centre preview/export framing.
Inspect scoped native instructions with hosted execution disabled. If a failure
persists, retain its bounded status/code and diagnose the configured public-key,
resource/environment or snapshot identity rather than silently substituting data.

## Constraints

Production reads only during diagnosis. Deployment uses the normal PR-to-main
flow. Exclude tokens, capability URLs and credentials from saved evidence.

## Verification

Record actual production tool responses and exact-render evidence, separating
source availability, missing subtitles, instruction access and hosted execution.
Local fixture evidence alone does not close this ticket.
