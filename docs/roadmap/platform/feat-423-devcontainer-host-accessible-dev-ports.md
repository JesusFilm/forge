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

Developers can run Forge application servers inside the repository devcontainer, but the `app` service publishes only SSH. A server can therefore be healthy inside Docker while remaining unreachable from a browser or API client on the host machine. Mastra adds a second failure mode because its development server defaults to container-local `localhost` rather than an externally reachable bind address.

## Entry Points — Read These First

1. `.devcontainer/docker-compose.yml` — Compose service and current host port publications.
2. `.devcontainer/devcontainer.json` — supported devcontainer entrypoint and container runtime configuration.
3. `package.json` — root Turborepo development command.
4. `apps/*/package.json` — stable application development ports and Mastra development command.
5. `apps/yt-video-mapper-backend/src/config/env.ts` — mapper API default port.
6. `apps/crop-worker/src/config/env.ts` — crop worker API default port.
7. `apps/shorts-worker/src/config/env.ts` — shorts worker API default port.
8. `apps/{yt-video-mapper-backend,crop-worker,shorts-worker}/src/server.ts` — worker HTTP listener addresses.
9. `docs/solutions/integration-issues/mastra-eval-workflow-local-dev-contracts.md` — established Mastra host-reachability and browser-origin constraints.
10. `docs/solutions/platform/devcontainer-setup.md` — durable devcontainer setup guidance.

## Grep These

- `ports:` in `.devcontainer/docker-compose.yml`
- `"dev"` in `apps/*/package.json`
- `PORT:` in `apps/*/src/config/env.ts`
- `mastra dev`
- `0.0.0.0`
- `localhost:4111`
- `127.0.0.1:2222:22`

## What To Build

1. Publish every stable Forge development port from the Compose `app` service to the same port on host loopback: Web `3000`, Manager `3002`, Admin `3003`, Auth `3004`, Mastra Gateway `3005`, YouTube Mapper `3010`, Crop Worker `3011`, Shorts Worker `3012`, Roadmap `3100`, Chat `3200`, and Mastra `4111`.
2. Make both repository Mastra development entrypoints listen on all container interfaces while preserving `localhost` as the browser-facing origin.
3. Keep the new application publications and existing SSH publication loopback-only; do not expose them to the local network.
4. Add a regression check that derives the required port inventory from a single repository-owned contract and fails when Compose publication or development commands drift.
5. Document the internal bind, Docker publication, and browser-origin boundaries, including the limitation that raw `docker run` callers must publish ports explicitly.

## Constraints

- Do not use host networking; preserve Docker bridge isolation and cross-platform Docker Desktop behavior.
- Do not replace stable same-number URLs with dynamically assigned host ports because local auth, callbacks, CORS, and HMR depend on predictable `localhost` origins.
- Do not change production start commands, Railway configuration, application authentication policy, or generated GraphQL artifacts.
- Do not mix `127.0.0.1` and `localhost` in browser-facing Mastra URLs.
- Do not expose optional or ephemeral tool ports unless they become part of the stable development contract.
- Do not change the existing PostgreSQL or Redis publication contract in this scope; the user-confirmed application-port inventory does not include those sidecars.

## Verification

- `docker compose -f .devcontainer/docker-compose.yml config --format json | node scripts/check-dev-port-contract.mjs --resolved-compose-stdin` succeeds and verifies loopback-only same-number mappings for every stable development port in the normalized model.
- The port-contract regression check passes and detects a deliberately omitted mapping or loopback-only Mastra bind in test fixtures.
- Inside the rebuilt devcontainer, representative Next.js, plain Node, and Mastra servers listen on container-external interfaces.
- From the host, Web and Mastra Studio load at `http://localhost:3000` and `http://localhost:4111/studio`; representative worker health endpoints are reachable on their documented ports.
- Next.js HMR and Mastra Studio credentialed API requests work without cross-origin errors.
- Host LAN-address probes fail while loopback probes succeed.
- Formatting, CI-sensitive validation, and `git diff --check` pass for the touched scope.

## Outcome

- Compose now publishes all 11 stable application ports as same-number IPv4 loopback mappings and supplies the container-side Mastra bind/origin environment.
- A dependency-free contract checker and unconditional CI gate fail closed on unapproved raw or resolved publications, Compose indirection, editor forwarding, host networking, devcontainer target drift, package-script drift, worker defaults/listeners, and Mastra script or source policy overrides.
- The devcontainer guide documents host URLs, raw-image publication, fixed-port conflicts, remote Docker contexts, and the Docker Engine 28+ isolation prerequisite.
- Local validation passed the 57-test contract suite, the real repository checker, normalized Compose-model validation on Docker Engine 28.3.3, formatting, and a disposable loopback/LAN-boundary smoke for the ten ports not already reserved by the active developer environment. Port 3000 was statically validated but not rebound because an existing Code Helper listener owned it.
