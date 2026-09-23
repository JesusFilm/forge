---
id: "feat-548"
title: "Qualify Claude and Codex through the full review loop"
owner: "tataihono"
priority: "P1"
status: "blocked"
readiness: "ready-for-agent"
start_date: "2026-09-23"
duration: 3
depends_on: ["feat-547"]
blocks: []
tags: ["manager", "ai-pipeline"]
---

## Problem

Prove the complete experience in each supported client and publish an actionable onboarding and release checklist tied to observed behavior.

## What To Build

Approved acceptance criteria:

- [ ] For both Claude and Codex, record exact client/version, connection/auth steps, environment, and grants; demonstrate discovery/create/edit/render/inspection/handoff/revision.
- [ ] Each client resumes after a disconnect, handles an expired media capability, and reconciles an intervening human edit without duplicate effects.
- [x] Demonstrate approved-existing-voice narration and correction/reuse behavior with disclosed fake versus real provider evidence; obtain explicit authorization before any paid qualification.
- [x] Record output-ready, evidence-ready, inspection-complete, and repair timings separately with short duration, cut count, network/worker conditions, and warm/cold state.
- [ ] Prove humans can review and approve the intended exact result while agents remain unable to approve or publish. Publishing a real public video is not required for qualification.
- [ ] Document supported inspection modalities for each client; do not replace real-client proof with a generic JSON-RPC probe.
- [x] Run scope-appropriate formatting, tests, type/build/schema drift checks, code review, and changed-UI load verification. Capture durable implementation learnings.
- [x] Prepare normal PR-to-main deployment, required OAuth/configuration/migration steps, renderer release requirements if changed, rollback and smoke checks. No local-code production shortcut.
- [x] Keep acceptance incomplete if a required client is unavailable; record the exact remaining step without claiming both clients work.

## Verification

Test boundary:

Two real-client end-to-end runs plus repository checks and review; explicit release evidence.

Read actual package scripts before running targeted Vitest/DB tests, typechecks, lint and formatting. Use only guarded loopback databases and fake paid providers. Regenerate Admin SDL and admin-graphql together if Pothos changes. Record real-client evidence separately from transport probes.

## Constraints

Preserve expected-revision and idempotency semantics, human edits, scoped OAuth authority, and exact-render human approval. No paid provider calls, deployment, agent publication, automatic wakeups, or editor comments.

## Entry Points — Read These First

1. `docs/validation/studio-feedback/README.md`
2. `docs/solutions/conventions/frontend-change-page-load-performance-verification.md`

See `docs/plans/2026-09-23-studio-external-agent/spec.md` and `code-map.md` for the complete approved scope.

## Grep These

- `authenticateStudioMcp|studioServiceCall|expectedRevision`
- `narrationReserve|render-review|idempotencyKey`

## Final integration assessment — 2026-09-23

Actual Codex completed creation/render/inspection/revision, preserved an attributed synthetic human edit, resumed after local credential expiry, corrected narration once and reused unchanged audio without consuming a pass. Required actual Claude and authenticated operator review/approval plus reachable-test OAuth qualification remain unavailable. Direct HTTP media download failed in this read-only client configuration; MCP refresh/images and a separate backend expiry probe are evidenced distinctly. Rebuilt renderer image qualification is tracked in the release evidence. No paid call, production deployment or merge occurred.
