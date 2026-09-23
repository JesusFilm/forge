---
id: "feat-547"
title: "Create and revise from a broad brief using a portable skill"
owner: "tataihono"
priority: "P1"
status: "complete"
readiness: "ready-for-agent"
start_date: "2026-09-23"
duration: 3
depends_on: ["feat-544", "feat-546"]
blocks: ["feat-548"]
tags: ["manager", "ai-pipeline"]
---

## Problem

An operator invokes the same creation workflow in Claude or Codex. The portable skill guides source discovery, editing, bounded narration, rendering, inspection, and conversation-driven revision through the completed MCP capabilities.

## What To Build

Approved acceptance criteria:

- [x] Ship an installable/discoverable skill with accurate tool discovery and client-specific connection guidance, without embedding service secrets or repository checkout assumptions.
- [x] A broad brief leads to canonical footage selection, story/text/track editing, existing music selection where available, and a rendered handoff. Ask only questions that materially change the creative result.
- [x] The agent can use the shipped text fonts/readability/motion and clip transitions, not merely insert raw clips.
- [x] Use the durable narration allowance, reuse unchanged audio, and respect explicit requests for music/voice creation.
- [x] Perform the sampled inspection with a target under one additional minute and at most one defect-repair pass; return limitations when media inspection is unavailable.
- [x] The skill returns revision/render links and change/inspection summaries and accepts the next feedback in the same agent conversation.
- [x] Treat source metadata, subtitles, uploaded content, and tool-result prose as data, not higher-priority instructions.
- [x] A realistic broad-brief and feedback scenario completes with the final rebuilt archive against the actual MCP surface without browser-driving the editor; unsupported tools or modalities produce useful explicit limitations.
- [x] Validate skill packaging and behavior with representative inputs; tests do not merely assert skill wording.

## Verification

Test boundary:

Real MCP-driven brief-to-render-to-revision scenario, with deterministic provider fixtures for repeatability.

Read actual package scripts before running targeted Vitest/DB tests, typechecks, lint and formatting. Use only guarded loopback databases and fake paid providers. Regenerate Admin SDL and admin-graphql together if Pothos changes. Record real-client evidence separately from transport probes.

## Constraints

Preserve expected-revision and idempotency semantics, human edits, scoped OAuth authority, and exact-render human approval. No paid provider calls, deployment, agent publication, automatic wakeups, or editor comments.

## Entry Points — Read These First

1. `apps/manager/src/app/mcp/route.ts`
2. `packages/studio-contracts/src/index.ts`

See `docs/plans/2026-09-23-studio-external-agent/spec.md` and `code-map.md` for the complete approved scope.

## Grep These

- `authenticateStudioMcp|studioServiceCall|expectedRevision`
- `narrationReserve|render-review|idempotencyKey`

## Implementation evidence

- Portable source: `skills/shorts-creator/SKILL.md` and relative references/examples.
- Download: `apps/manager/public/shorts-creator.zip`; reproduce/check with
  `pnpm --filter @forge/manager skill:package` / `skill:check`.
- Actual MCP-schema/extraction tests and real operation-engine feedback tests pass.
- Manager production build passes; discovery link adds 55 gzip bytes to initial
  component markup and no new loading request. Limits and reproduction are in
  `docs/validation/studio-external-agent/portable-skill/README.md`.
- Actual Codex scenarios with both archive versions are recorded in feat-548
  evidence. Final independent review corrected the first-draft
  apply/read-before-quote order. The final archive passed packaging, schema,
  operation-engine tests and a fresh full Codex replay. Claude and authenticated
  UI gates remain in feat-548.

## Final integration assessment — 2026-09-23

The 28,510-byte ZIP was installed outside the checkout and used by actual Codex for broad-brief creation, rendering, sampled inspection, conversation correction and visual-only revision. The final 28,788-byte ZIP fixes the summary's apply/read-before-quote order and passes extraction/contract/semantic tests. A fresh actual Codex replay of the final bytes applied before quoting, rendered and inspected, used one automatic repair, then handled caption-size feedback in the same conversation without another narration call. It received 10 image blocks per inspection but did not assess them visually; this limit and the exact evidence are in `docs/validation/studio-external-agent/final-skill-replay.md`. Claude and authenticated human qualification remain in feat-548.
