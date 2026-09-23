---
id: "feat-546"
title: "Review an exact draft and revise from conversation feedback"
owner: "tataihono"
priority: "P1"
status: "blocked"
readiness: "ready-for-agent"
start_date: "2026-09-23"
duration: 3
depends_on: ["feat-543", "feat-545"]
blocks: ["feat-547"]
tags: ["manager", "ai-pipeline"]
---

## Problem

The human follows the agent handoff to review an exact render, gives feedback in their existing conversation, optionally makes direct edits, and receives a reconciled revision with accessible prior evidence.

## What To Build

Approved acceptance criteria:

- [ ] Handoff includes the exact revision/render, concise change summary, inspection coverage/findings, and a functioning Studio review link.
- [ ] Human can watch the intended render and see whether the current project has advanced; stale output cannot be approved as the new revision.
- [x] Feedback remains in the external conversation, including optional timestamps. No editor comments database, polling daemon, or automatic client wakeup is introduced.
- [x] On revision the agent rereads canonical state/history; nonconflicting feedback preserves human edits and creative conflicts are surfaced rather than overwritten.
- [ ] Previous revision/render evidence remains accessible and existing restore mechanisms are usable. A side-by-side comparison editor is not required.
- [ ] Final approval remains an interactive human action for exact bytes and effective script/voice. Agents cannot invoke approval, publication, or destructive commands.
- [x] Test human edits made before and during agent revision, changed content after inspection, and attempted approval of outdated evidence.
- [x] If review UI changes, verify browser behavior and page-loading performance using matched fixtures; avoid eagerly loading full evidence packages.

## Verification

Test boundary:

MCP plus human review UI over real revisions/render records; concurrent edits and approval-staleness integration.

Read actual package scripts before running targeted Vitest/DB tests, typechecks, lint and formatting. Use only guarded loopback databases and fake paid providers. Regenerate Admin SDL and admin-graphql together if Pothos changes. Record real-client evidence separately from transport probes.

## Constraints

Preserve expected-revision and idempotency semantics, human edits, scoped OAuth authority, and exact-render human approval. No paid provider calls, deployment, agent publication, automatic wakeups, or editor comments.

## Entry Points — Read These First

1. `apps/manager/src/features/video-studio/render-panel.tsx`
2. `apps/manager/src/app/api/shorts/render-review/route.ts`
3. `apps/admin/src/services/studio-authoring/publication-readiness-resolver.ts`

See `docs/plans/2026-09-23-studio-external-agent/spec.md` and `code-map.md` for the complete approved scope.

## Grep These

- `authenticateStudioMcp|studioServiceCall|expectedRevision`
- `narrationReserve|render-review|idempotencyKey`

## Implementation and validation — 2026-09-23

- Exact revision/render handoffs open the lazy human review panel, including
  attempts outside the recent 20-render window. Private completed MP4 review no
  longer depends on Mux or catalog staging. Prior evidence stays read-only when
  canonical or local state advances.
- Review displays effective speech, voice version, provider/model, settings and
  pronunciation for the selected immutable document. Human script/render approval
  uses separate canonical commands; stale and dirty state is denied, with Admin
  revision/attempt checks as final authority. Existing history/restore remains usable.
- Inspection is explicitly loaded; metadata responses omit sample images.
  Narration allowance shows project-cycle accounting, honest unknown pricing,
  explicit additional-pass authorization and exact-command recovery after a lost
  response. Definitive rejected grants require explicit discard and renewed consent.
- Manager 17 focused tests, typecheck and scoped lint passed. Real loopback Admin
  delegated/render regression scenarios passed, including human-edit preservation
  and outdated exact-render approval refusal. Production build and synthetic
  browser/performance evidence are detailed in `docs/validation/studio-546/README.md`.
- No paid provider calls, migrations, Pothos changes or production deployments.
- Status remains in progress pending authenticated human UI/client qualification.
  Synthetic fixtures do not satisfy that boundary; automatic approval review
  rejected session creation pending explicit operator permission. Full workflow
  qualification remains feat-548.

## Final integration assessment — 2026-09-23

Implementation, real canonical authority tests, independent review and synthetic browser/load checks pass. Authenticated human review, direct correction and exact-render approval remain unverified because automatic approval review rejected temporary synthetic browser-session creation pending explicit operator permission. This gate is not replaced by fixture UI or backend commands.
