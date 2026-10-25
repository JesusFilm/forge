---
id: "feat-228"
title: "TV perf tooling: Datadog MCP for agents and Hermes profiler pairing"
owner: "urim"
priority: "P2"
status: "not-started"
start_date: "2026-07-10"
duration: 2
depends_on: []
blocks: []
tags:
  - "platform"
  - "tv"
  - "observability"
  - "infrastructure"
---

## Problem

Two gaps identified during the 2026-07 observability research remain open. (1) Agents cannot query the new TV telemetry: no Datadog MCP is registered in this repo, and no doc describes how an agent (or a script) verifies telemetry is flowing — every "is it working?" check requires a human in the Datadog UI. (2) Datadog structurally cannot profile the Hermes JS bundle — RUM names the slow screen, never the slow function — so the dominant TV cost (the ~2.8-3.2s series-detail client-side parse/render from the 2026-06-30 perf sweep) needs a dedicated on-device profiler. The research verdict was "pair, don't switch": keep Datadog for detection, add a Hermes profiler for root-cause.

## Entry Points — Read These First

1. `.mcp.json` (repo root) — currently has `railway` + `chrome-devtools`; the Datadog MCP entry goes here (or per-user docs if org auth prevents repo-level config).
2. `docs/observability/datadog.md` — "TV production variables" section; the agent query-loop documentation extends this file.
3. `docs/brainstorms/2026-06-30-tv-client-performance-sweep-requirements.md` — the perf questions (esp. SC7: series parse/render) the profiler must answer.
4. `apps/tv/CLAUDE.md` — "Observability (Datadog)" section documents the RUM-is-not-a-JS-profiler boundary; profiler usage docs belong beside it.
5. `patches/` + root `package.json` `pnpm.patchedDependencies` — precedent if the profiler's native module needs a tvOS patch (same class of risk as the Datadog SDK).

## Grep These

- `mcpServers` (in `.mcp.json`)
- `search_datadog_rum_events` (the MCP's GA RUM query tool — for the docs)
- `react-native-release-profiler` (not yet present)
- `EXPO_TV=1 npx expo prebuild`

## What To Build

1. **Register the official Datadog MCP** (`https://mcp.datadoghq.com/api/unstable/mcp-server/mcp`, OAuth or API+app key) — repo `.mcp.json` if auth allows, otherwise a per-user setup section in `docs/observability/datadog.md`. Document the agent regression-hunt loop against `service:forge-tv`: `search_datadog_rum_events` (views/resources by version), `search_datadog_spans`/`get_datadog_trace` (client-vs-server split via trace-linking to admin APM), `search_datadog_error_tracking_issues`. Note the read-only boundary: the MCP cannot provision apps/tokens.
2. **Agent verification recipe**: a short documented check (MCP query or read-scoped `curl` against the RUM search API) answering "did telemetry arrive in the last N minutes?" — closes the human-screenshot dependency.
3. **Hermes profiler spike** (`react-native-release-profiler`): install; verify its native module compiles for the tvOS target under `EXPO_TV=1` prebuild + the react-native-tvos alias (unverified in research — the one open risk); wire a dev-only trigger for `startProfiling`/`stopProfiling` reachable by D-pad (the package's programmatic API is why it was chosen — TV remotes cannot open the touch Dev Menu); capture a trace of the series-detail load; convert and read the flame graph; record which functions dominate the ~3s parse/render against the perf-sweep baseline.

## Constraints

- Pair, don't switch: no observability vendor migration (research verdict 2026-07-01 — no vendor offers MCP + Datadog-breadth + RN/Hermes profiling + TV support).
- Profiler is dev tooling: no profiler code on the release-build runtime path beyond what the library itself gates.
- MCP usage is read-only telemetry querying; provisioning stays in the Datadog UI/REST API.
- If the profiler's native module fails on tvOS, document the failure and fall back to tvOS-simulator-only profiling via React Native DevTools — do not force a patch unless it is as small as the Datadog one.

## Verification

- A fresh agent session (no prior context) can, via the registered MCP + docs alone, answer "show me forge-tv sessions from the last hour" and "which GraphQL resource was slowest."
- A Hermes trace/flame graph exists for a cold series-detail load on the tvOS simulator, with the dominant functions named in the spike notes (attach to the perf-sweep doc or its follow-up).
- `EXPO_TV=1 npx expo prebuild --clean && pod install` succeeds with the profiler dependency installed (or the tvOS incompatibility is documented with the fallback path).
