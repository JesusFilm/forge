# Implementation entry points

This companion map keeps exact repository paths out of the product specification
and draft ticket bodies. Transfer relevant entries into published Forge roadmap
tickets, whose conventions require concrete entry points and verification.

## Shared boundaries

- `CONCEPTS.md` — Registered Application, Application Environment, Application Grant, Dynamic MCP Client, Content Pack.
- `apps/manager/AGENTS.md` and `apps/manager/CLAUDE.md` — Manager data ownership, frontend checks and contained-render guidance.
- `apps/admin/AGENTS.md` and `apps/admin/CLAUDE.md` — canonical persistence and schema conventions; read before implementation there.
- `packages/studio-contracts/AGENTS.md` and `packages/studio-contracts/CLAUDE.md` — runtime-neutral contracts.
- `docs/solutions/security-issues/studio-native-agent-admission.md` — delegated authority and instruction isolation.
- `docs/solutions/database-issues/studio-command-revisions-and-publication-latch.md` — canonical transaction/retry/approval semantics.
- `docs/solutions/security-issues/studio-contained-render-and-immutable-watch-publication.md` — contained rendering and exact-output approval.
- `docs/solutions/database-issues/studio-shared-assets-and-source-retention.md` — trusted sources and asset identities.

## Ticket 01: connection and editing

- `apps/manager/src/app/mcp/route.ts` — current tool registry and RPC handler; grep `authenticateStudioMcp|tools/list|studioServiceCall`.
- `apps/manager/src/services/studio-agent/oauth.ts` — issuer, resource, scopes, client and membership checks.
- `apps/manager/src/services/studio-agent/transport.ts` — delegated transport.
- `apps/auth/src/domain/apps.ts` — registered Studio MCP application; grep `STUDIO_MCP_APP_SEED`.
- `apps/admin/src/services/studio-authoring/delegated.ts` and `delegated.db.test.ts` — durable delegated command behavior.
- `apps/admin/src/services/studio-authoring/commands.db.test.ts` — existing database-backed command race tests.

## Ticket 02: draft rendering

- `apps/manager/src/app/api/shorts/render-prepare/route.ts` — existing interactive preparation.
- `apps/manager/src/services/studio-render-pool-gateway.ts` — outbound VM gateway integration.
- `apps/admin/src/services/studio-authoring/render-rpc.ts`, `render-jobs.ts`, `render-state.ts` — canonical render admission and lifecycle.
- `apps/admin/src/services/studio-authoring/render-jobs.db.test.ts` — renderer lifecycle test precedent.
- `packages/studio-contracts/src/render.ts` — shared render identities.
- `apps/studio-render/src/vm/controller.mjs` — existing execution lifecycle, not a new queue to duplicate.

## Ticket 03: draft narration

- `apps/manager/src/services/studio-production/narration.ts`, `provider.ts`, `rates.ts`, `runner.ts` — provider execution and estimates.
- `apps/manager/src/features/video-studio/production-panel.tsx` — current preliminary human checkpoint and script/voice presentation.
- `apps/admin/src/services/studio-authoring/narration.ts`, `production-rpc.ts` — canonical narration policy and admission.
- `apps/admin/src/services/studio-authoring/narration.db.test.ts`, `narration-recovery.db.test.ts` — attachment/recovery behavior.
- `packages/studio-contracts/src/production.ts` — shared production contracts.
- Proposed allowance contract/persistence must be defined during implementation; no schema migration is prescribed without reading current models.

## Tickets 04–05: inspection and human review

- `apps/manager/src/features/video-studio/render-panel.tsx` — exact-output human review.
- `apps/manager/src/app/api/shorts/render-review/route.ts` — interactive review transport.
- `apps/admin/src/services/studio-authoring/publication-readiness-resolver.ts` — publication eligibility.
- `apps/admin/src/services/studio-authoring/publication-hook.db.test.ts` — publication behavior tests.
- `apps/manager/src/features/video-studio/editor-session.test.ts` — editor state test precedent.
- `apps/studio-render/ops/release/README.md` — reviewed worker release flow if evidence generation changes the worker.
- Proposed inspection extraction/report contracts need concrete design against immutable renderer output; do not relabel existing source subtitles as rendered inspection.

## Tickets 06–07: skill and qualification

- Reuse the registry/schema from Ticket 01 and execution/evidence contracts from 02–05 as the skill's source of truth.
- Skill installation location and portable distribution are deliverables, not an assumption that all users have this repository checked out.
- `docs/validation/studio-feedback/README.md` — example of browser and performance evidence with explicitly bounded conclusions.
- `docs/solutions/conventions/frontend-change-page-load-performance-verification.md` — required measured frontend validation.

## Verification conventions

Use actual package scripts from each touched package's `package.json`; do not
infer script names from historical tickets. Admin schema changes must regenerate
`apps/admin/schema.graphql` and `packages/admin-graphql` outputs together. Read the
existing loopback test-database guard before executing database integration tests.
Never point them at production credentials.

For this documentation-only task, check Markdown formatting, all map paths, local
links, and the draft dependency graph. Runtime builds/tests belong to implementation.
