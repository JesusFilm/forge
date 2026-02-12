# Forge Agent Guide

Purpose: let AI agents ship safe, small, parallel changes.

## Non-negotiable invariants

- Canonical content lives in Strapi only.
- AI can draft/translate/adapt; AI cannot publish.
- Contracts are source of truth for integrations.
- Generated clients are read-only artifacts.
- Infra changes are Terraform-only.

## Work intake

- One issue = one bounded context.
- One PR = one bounded context.
- Touch only listed impacted folders.

## Where changes belong

- `apps/web`: Next.js UI + web integration edges.
- `apps/cms`: Strapi schema, workflows, editorial controls.
- `apps/ai-orchestrator`: provider abstraction, RAG, provenance pipeline.
- `packages/contracts`: GraphQL/OpenAPI contracts.
- `packages/clients`: generated API clients only.
- `packages/content-models`: shared enums/state constants from contracts/schema.
- `packages/ai-config`: prompts, policies, eval configs.
- `packages/tooling/codegen`: generators + drift verification.
- `infra/aws`, `infra/vercel`: Terraform stacks.
- `mobile/ios`, `mobile/android`: native apps; no shared business logic.

## Agent operating rules

- Prefer explicit files over implicit conventions.
- If contracts change: regenerate clients in same PR.
- Never hand-edit generated files under `packages/clients/*`.
- Never add cross-imports between bounded app contexts.
- Keep changes small and reviewable.
