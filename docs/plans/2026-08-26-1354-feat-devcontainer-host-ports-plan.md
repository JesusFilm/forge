---
title: "Devcontainer Host-Accessible Development Ports - Plan"
type: "feat"
date: "2026-08-26"
deepened: "2026-08-26"
artifact_contract: "ce-unified-plan/v1"
artifact_readiness: "implementation-ready"
execution: "code"
product_contract_source: "ce-plan-bootstrap"
---

# Devcontainer Host-Accessible Development Ports - Plan

## Goal

Developers running Forge services in the Compose devcontainer can reach every
stable development port from the Docker host without exposing those services
to the local network.

The host port contract is:

`3000`, `3002`, `3003`, `3004`, `3005`, `3010`, `3011`, `3012`, `3100`,
`3200`, and `4111`.

## Decisions

- Publish each port from the Compose `app` service as
  `127.0.0.1:<port>:<port>` on the default bridge network.
- Set `HOST=0.0.0.0`, `MASTRA_HOST=0.0.0.0`, and
  `MASTRA_AUTO_DETECT_URL=true` on the Compose `app` service. The Mastra CLI
  coordinator and its child server use different bind variables, while Studio
  must continue to use the host browser's `localhost:4111` origin.
- Keep VS Code's `forwardPorts` entry for port `3000` and its browser-opening
  metadata as an editor convenience. Compose remains the complete,
  editor-independent host publication contract.
- Preserve existing application development scripts. Their stable ports and
  listener defaults already satisfy the container runtime; only the
  Compose-scoped Mastra environment needs to change.
- Add one small dependency-free CI assertion over `docker compose config`
  output. It verifies the effective model instead of parsing raw YAML or
  duplicating application configuration.

## Scope

### In scope

- `.devcontainer/docker-compose.yml`: loopback-only application publications
  and the three Mastra environment values.
- `.devcontainer/devcontainer.json`: retain the existing Web forwarding UX.
- `scripts/check-dev-port-contract.mjs`: validate the resolved Compose
  publication and environment contract.
- `.github/workflows/ci.yml`: run the assertion unconditionally and gate CI.
- Roadmap and durable devcontainer guidance.

### Out of scope

- Production commands or deployment configuration.
- Package-script changes.
- Host networking, dynamic host ports, optional debugger ports, PostgreSQL, or
  Redis publication changes.
- Automatically publishing ports for direct `docker run` callers.

## Implementation

### 1. Publish the stable ports

Add same-number, IPv4-loopback mappings for all 11 ports to
`services.app.ports`. Keep the existing SSH mapping and default Compose bridge.
Add the three Compose-scoped environment values for Mastra.

Acceptance:

- The resolved `app` service has exactly one TCP mapping for every contracted
  port.
- Each mapping has host IP `127.0.0.1` and identical host/container ports.
- `network_mode: host` is absent.
- `HOST` and `MASTRA_HOST` resolve to `0.0.0.0`, and
  `MASTRA_AUTO_DETECT_URL` resolves to `true`.

### 2. Add a resolved-model assertion

Create a compact Node script that reads resolved Compose JSON from stdin and
fails with an actionable message when the `app` service, an approved mapping,
its loopback address, its same-number target, or either Mastra environment
value is missing or incorrect. Require the app to use only Compose's default
bridge network, without custom driver options or `network_mode`.

Run it in CI with:

```bash
docker compose -f .devcontainer/docker-compose.yml config --format json \
  | node scripts/check-dev-port-contract.mjs
```

The job must run independently of Turbo's affected-package graph and be a
dependency of `ci-gate`.

### 3. Document the workflow

Document the stable host URLs, the distinction between process listening,
Docker publication, and browser origin, and the need to recreate the
devcontainer after Compose changes. Record fixed-port conflicts, the Docker
Engine 28+ loopback-isolation prerequisite, remote Docker context behavior,
and explicit `docker run -p 127.0.0.1:<port>:<port>` requirements.

## Validation

1. Resolve Compose and run the contract assertion.
2. Run formatting and `git diff --check` for the touched files.
3. On Docker Engine 28 or newer, verify representative mappings report
   `127.0.0.1:<port>` and host loopback requests succeed while host LAN-address
   requests fail.
4. With representative services running, verify Web, a worker health endpoint,
   and Mastra Studio from the host. Confirm HMR and Studio API requests where a
   rebuilt devcontainer is available.

## Definition of Done

- All 11 stable ports are published on host IPv4 loopback only.
- Mastra is reachable through Compose without advertising `0.0.0.0` to the
  browser.
- The existing VS Code port-3000 convenience remains intact.
- Package scripts and production configuration are unchanged.
- The resolved-model assertion gates CI.
- Durable documentation and `feat-423` are complete.
- The change passes formal review, is compounded, and is available in a
  ready-for-review PR without deployment or merge.
