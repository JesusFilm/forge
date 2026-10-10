---
id: "feat-423"
title: "Expose devcontainer development servers to the host"
owner: "nisal"
priority: "P1"
status: "complete"
start_date: "2026-08-26"
duration: 1
depends_on: []
blocks: []
tags:
  - "tooling"
  - "infrastructure"
  - "devcontainer"
  - "developer-experience"
---

## Problem

Forge services started inside the Compose devcontainer were not consistently
reachable from browsers and API clients on the Docker host. Mastra also needed
a container-reachable listener without turning its internal bind address into
the host browser's API origin.

## Entry Points — Read These First

1. `.devcontainer/docker-compose.yml` — application environment, bridge
   networking, and host-loopback publications.
2. `scripts/check-dev-port-contract.mjs` — effective Compose contract asserted
   by CI.
3. `.github/workflows/ci.yml` — unconditional `dev-port-contract` job and
   `ci-gate` dependency.

## Grep These

- `HOST:` and `MASTRA_HOST:` in `.devcontainer/docker-compose.yml`
- `127.0.0.1:` in `.devcontainer/docker-compose.yml`
- `EXPECTED_PORTS` in `scripts/check-dev-port-contract.mjs`
- `dev-port-contract` in `.github/workflows/ci.yml`

## What To Build

- Publish the stable application ports `3000`, `3002`-`3005`, `3010`-`3012`,
  `3100`, `3200`, and `4111` from the `app` service as same-number mappings on
  host IPv4 loopback.
- Set Compose-scoped `HOST=0.0.0.0`, `MASTRA_HOST=0.0.0.0`, and
  `MASTRA_AUTO_DETECT_URL=true` so the Mastra coordinator and child server
  listen through the container bridge while Studio uses its browser origin.
- Retain VS Code's port-3000 forwarding and browser-opening metadata as a
  convenience; Compose remains the editor-independent publication mechanism.
- Preserve the existing package development scripts.
- Gate CI with a small assertion over the resolved Compose model.

## Constraints

- Keep Docker bridge isolation; do not use host networking or wildcard host
  publication.
- Keep stable same-number URLs for auth, callbacks, CORS, HMR, and local tools.
- Do not change production commands, Railway configuration, generated GraphQL
  artifacts, PostgreSQL, Redis, or optional tool ports.
- Direct `docker run` users must publish required ports explicitly.

## Verification

```bash
docker compose -f .devcontainer/docker-compose.yml config --format json \
  | node scripts/check-dev-port-contract.mjs
```

The assertion verifies every contracted `app` mapping uses `127.0.0.1`, keeps
the same host and container port, retains all three Mastra environment values,
and uses an unmodified Compose default bridge network.
Formatting and `git diff --check` pass for the touched scope. On Docker Engine
28.3.3, disposable publication smoke checks confirmed loopback access and
rejected host-LAN access for the available ports; port `3000` remained reserved
by an existing local listener and was validated through the resolved model.

## Outcome

All stable Forge development ports are now available from the Docker host on
predictable `localhost` URLs without intentional LAN exposure. The durable
devcontainer guide covers recreation, fixed-port conflicts, raw-image use,
remote Docker contexts, and the Docker Engine 28+ isolation prerequisite.
