# apps/mastra Agent Guide

Full context lives in `apps/mastra/CLAUDE.md`. Keep both files aligned.

## Core model

- Runs the self-hosted Mastra Server runtime for Forge agents and workflows.
- Owns transcript embedding chunk planning and provider calls, then submits
  transcript vectors to Admin ingest.
- Owns scene embedding provider calls and workflow diagnostics, then submits
  scene vectors to Admin's scene-specific ingest endpoint.
- Owns experience embedding provider calls and workflow diagnostics, then
  submits experience vectors to Admin's experience-specific ingest endpoint.
- Owns offline eval query generation for catalog-derived, locale-quality, and
  Admin-trace-sampled candidates, then stores staged candidates back through
  Admin's authenticated HTTP contracts.
- Owns the offline search eval system: seed prompt sets, baseline/report
  artifacts, comparison workflows, judge orchestration, and developer/operator
  eval routes that call Admin search through authenticated HTTP.
- Owns a thin search eval orchestrator that coordinates those leaf workflows
  for baseline capture, comparison, native Evaluation sync, and release-gate
  summaries without moving leaf logic into one mega-workflow.
- All embedding workflows share provider-result validation for count alignment,
  finite vector values, and configured dimensions before calling Admin.
- AI Gateway content embeddings request the normal OpenAI-compatible
  embedding response and require the configured native dimensions before Admin
  ingest. Current production gateway output is native 1536, so Mastra does not
  pass `dimensions` through LiteLLM and does not apply a client transform; keep
  the shared 4096-to-1536 truncate/re-normalize helper for future gateway
  variants that truly return 4096.
- All embedding workflows use the shared Admin ingest client behavior but keep
  separate transcript, scene, and experience endpoints and payload schemas.
- Generation modes are consistent across embedding workflows: omitted means
  idempotent; explicit repair, force, and model-upgrade request rewrites.
- Builds Studio assets with `mastra build --studio` and serves them from the
  same internal Railway service.
- Human Studio access is handled by `apps/mastra-gateway`; this service should
  not become the human identity authority.
- App-to-runtime calls use service bearer authentication.

## Boundaries

- Do not import from app contexts such as `apps/admin`, `apps/manager`, or
  `apps/auth`.
- Do not log bearer tokens, model provider keys, cookies, or raw prompts that
  may contain sensitive data.
- Runtime storage uses Postgres via `DATABASE_URL`; Studio-visible logs and
  observability use DuckDB files under `MASTRA_STORAGE_DIR` on the Railway
  volume.
- Do not import from Admin or Manager to share types; use service HTTP
  contracts and local schemas.
- Eval query generation is offline only. It must not enter Admin's live search
  path, generate live query embeddings, or make generated candidates permanent
  regression truth before Admin human promotion.
- Offline search eval is also outside the live request path. Baselines are
  seed-prompt artifacts owned by Mastra. Keep the Studio-facing workflow
  seed-only until a later human promotion flow decides how staged generated
  candidates should become reviewable.
- The search eval orchestrator must not promote generated, trace-derived, seed,
  or user-submitted candidates. Candidate generation and seed submission are
  opt-in staging steps; human promotion stays behind Admin review contracts.
- Studio-facing workflows need structured Zod object input schemas on both the
  workflow and first step. Avoid `z.unknown()` for operator-run workflows, and
  prefer defaults/optional fields that render usable Studio forms.
- Keep service-bearer auth scoped to explicit `/forge-*` service routes so
  Studio's built-in `/api/workflows` calls continue to work.

## Validation

- `pnpm --filter @forge/mastra test`
- `pnpm --filter @forge/mastra typecheck`
- `pnpm --filter @forge/mastra lint`
- `pnpm --filter @forge/mastra eval:content-embedding-gate -- --baseline-name=<baseline>`
