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

## Workflow (mandatory)

1. **Issue first**: Create a GitHub issue using the **Bounded Context Work Item** template before any code changes. If user requests work and no issue exists, create the issue first—never start coding without an issue. Include: expected outcome, possible solution(s). Use title format `type(scope): description` (e.g. `feat(web): add validation`, `fix(cms): schema fix`, `chore(tooling): add commitlint`). Labels `type` and `scope` are auto-applied from the title.
2. **Branch**: Checkout/create branch from `main` using `fix/123-slug` or `feat/123-slug`.
3. **Work**: Make changes within the bounded context of the issue. When contracts change: run codegen in same PR and tick "Regeneration Required: yes" in PR template.
4. **Commits**: Produce a series of commits—one per small block of work. Each commit must use conventional format (`feat:`, `fix:`, `chore:`, `docs:` etc.). Atomic and reviewable (e.g. `feat: add validation`, `fix: resolve #123`).
5. **PR**: Rebase on `main`, then open PR targeting `main`. Use same title format as issue: `type(scope): description`. Fill PR template (Summary, Contracts Changed, Regeneration Required, Validation). Include `Resolves #123` in description.
6. **Checks**: Ensure all CI checks pass before marking work complete. Re-run or fix failures.
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
