# apps/mastra Agent Guide

Full context lives in `apps/mastra/CLAUDE.md`. Keep both files aligned.

## Core model

- Runs the self-hosted Mastra Server runtime for Forge agents and workflows.
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
- Runtime and Studio observability storage uses Postgres via `DATABASE_URL`;
  production should point at the existing Mastra gateway database.
- Keep Manager subtitle workflow migration out of this first runtime slice.

## Validation

- `pnpm --filter @forge/mastra test`
- `pnpm --filter @forge/mastra typecheck`
- `pnpm --filter @forge/mastra lint`
