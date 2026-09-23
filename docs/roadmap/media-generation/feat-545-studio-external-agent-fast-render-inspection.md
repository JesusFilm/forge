---
id: "feat-545"
title: "Inspect a rendered draft quickly with attributable evidence"
owner: "tataihono"
priority: "P1"
status: "complete"
readiness: "ready-for-agent"
start_date: "2026-09-23"
duration: 3
depends_on: ["feat-543"]
blocks: ["feat-546"]
tags: ["manager", "ai-pipeline"]
---

## Problem

The external agent retrieves a bounded evidence package for the exact rendered draft, performs a quick quality pass, and hands off honest findings and inspection coverage.

## What To Build

Approved acceptance criteria:

- [x] Evidence identifies the exact project revision, render, duration, sampled timestamps, and evidence-generation version.
- [x] Provide representative frames and cut-adjacent samples plus deterministic gap, text-overflow, and audio checks where technically supported. Intentional gaps are distinguishable from suspected defects.
- [x] Evidence comes from the same output the human reviews; render success or composition metadata alone is not claimed as visual/audio inspection.
- [x] Bound the number/size of samples and processing time. Repeated inspection of the same artifact reuses evidence instead of rerendering.
- [x] The agent reports supported modalities, sampled coverage, findings, and unknowns; a client without audio/video inspection capability does not claim it listened/watched.
- [x] Measure additional time from output readiness to completed inspection, separating server preparation and client reasoning. Target under 60 seconds on a documented representative short; report misses honestly.
- [x] Publish fixture results for clean output, deliberate gaps, unreadable/overflowing text, cut defects, and audio defects. Report detector limitations and false positives rather than claiming universal detection.
- [x] At most one automatic repair pass is prescribed per review handoff. Any repair render is separately timed; remaining defects/timeouts return an incomplete inspection summary.
- [x] Inspection results are advisory and never human approval. Heavy evidence work does not execute during editor page initialization.

## Verification

Test boundary:

MCP evidence retrieval plus actual contained-render fixtures and representative client inspection timing.

Read actual package scripts before running targeted Vitest/DB tests, typechecks, lint and formatting. Use only guarded loopback databases and fake paid providers. Regenerate Admin SDL and admin-graphql together if Pothos changes. Record real-client evidence separately from transport probes.

## Constraints

Preserve expected-revision and idempotency semantics, human edits, scoped OAuth authority, and exact-render human approval. No paid provider calls, deployment, agent publication, automatic wakeups, or editor comments.

## Entry Points — Read These First

1. `apps/studio-render/src/vm/controller.mjs`
2. `packages/studio-contracts/src/render.ts`
3. `apps/manager/src/features/video-studio/render-panel.tsx`

See `docs/plans/2026-09-23-studio-external-agent/spec.md` and `code-map.md` for the complete approved scope.

## Grep These

- `authenticateStudioMcp|studioServiceCall|expectedRevision`
- `narrationReserve|render-review|idempotencyKey`

## Implementation and remaining qualification

Implemented in the dedicated feat-545 worktree: exact completed-output inspection,
immutable successful-evidence cache, read-scoped MCP JPEG blocks, lazy interactive
context seam, bounded decoding, and separately labeled composition heuristics.
See [validation evidence](../../validation/studio-545/README.md).

Server preparation passed actual contained-render fixtures, including a 30-second
short. Actual Codex reasoning/inspection timing is now recorded in the final assessment
below. Repository/fixture success alone does not prove either client's modalities;
Claude remains unqualified under feat-548.

## Final integration assessment — 2026-09-23

Actual Codex received eight images per exact output, interpreted sampled pixels and disclosed no listening/full-watch capability. Added handoff times were 52.260, 34.026 and 37.116 seconds; an explicit fourth reuse probe took 60.992 seconds, a disclosed target miss under concurrent build load without a causal claim. Bounded evidence, cache and timeout tests pass. See the exact timing provenance in the client workflow; no production latency guarantee is claimed.
