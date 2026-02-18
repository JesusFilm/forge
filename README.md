# Forge

Agent-first content platform. Canonical content source is Strapi v5. Web, iOS, and Android consume explicit contracts and generated clients.

## Core rules

- Explicit boundaries over convenience.
- Contract-first across all app integrations.
- Generated clients only; no handwritten API clients.
- AI can draft, never publish.
- Infra is Terraform-only.

## Workspace map

- `apps/` runtime systems (`web`, `cms`, `ai-orchestrator`)
- `packages/` contracts, generated clients, shared models, AI config, codegen tooling
- `mobile/` native iOS and Android apps (outside Turborepo graph)
- `infra/` Terraform for AWS + Vercel
- `docs/` architecture and runbooks

## Running with Docker

Dev stack runs in Docker from the repo root (main clone or any [git worktree](.cursor/worktrees.json)). See [docker/README.md](docker/README.md) for usage and worktree notes.

```bash
docker compose up --build
```

## Agent docs

- Global rules: `AGENTS.md`
- Context rules: each major directory has its own `AGENTS.md`
