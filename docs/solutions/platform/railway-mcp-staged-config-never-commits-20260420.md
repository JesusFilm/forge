---
title: Railway remote MCP config edits need `accept-deploy` to flush — don't use `deployServiceTool` on its own
date: 2026-04-20
tags: [railway, mcp, deployment, infrastructure]
category: platform
severity: medium
---

## Problem

Editing a Railway service's build/deploy config via the remote MCP
(`https://mcp.railway.com`) — `buildCommand`, `startCommand`,
`healthcheckPath`, `watchPatterns`, `multiRegionConfig` — can appear
to silently do nothing. `updateServiceTool` returns:

```json
{
  "status": "applied",
  "message": "Service has been updated and changes are staged for deployment."
}
```

but subsequent deployments capture `startCommand: null`,
`buildCommand: null`, `healthcheckPath: null` in their snapshots and
Railpack auto-detects instead, failing with `No start command
detected` on a workspace package.

Observed in feat-104 (admin Railway provisioning) on 2026-04-20:
five deployments failed in a row before the usage mistake was caught.

## Root cause: wrong follow-up tool

Railway has two layers of service config:

1. **`serviceInstance`** — the canonical per-(service, environment) row.
   Deployments snapshot from this at trigger time.
2. **Staged patches** — a per-environment buffer holding unapplied
   edits. Merging the buffer into `serviceInstance` requires an
   explicit commit.

The MCP's `updateServiceTool` writes to the staged patch layer. The
response wording (`"staged for deployment"`) correctly says so. The
failure mode is choosing the wrong flush path:

- ✅ **Correct**: `mcp__railway__accept-deploy(environmentId)` — commits
  all staged patches in the environment AND triggers a new deployment.
  The deployment then snapshots the freshly-merged `serviceInstance`.
- ❌ **Wrong (what bit us)**: calling the Railway MCP agent's internal
  `deployServiceTool` directly. That tool triggers a deploy off the
  current live `serviceInstance` without flushing staged patches.
  Staged edits are left dangling; the build plan is auto-detected
  from an unchanged config.

### Verified behaviour (controlled test, 2026-04-20)

1. Via MCP `updateServiceTool`, add watchPattern
   `/apps/admin/MCP_TEST_SENTINEL/**`. Tool returns `applied`.
2. Query `serviceInstance.watchPatterns` via raw GraphQL:
   `['/apps/admin/**', '/packages/graphql/**']` — sentinel absent.
3. Call `mcp__railway__accept-deploy` on the environment.
4. Re-query `serviceInstance.watchPatterns`:
   `['/apps/admin/**', '/packages/graphql/**', '/apps/admin/MCP_TEST_SENTINEL/**']` ✓

The staged layer flushes cleanly on `accept-deploy`. No upstream bug.

## Correct usage pattern

```
# Pseudocode
mcp.updateServiceTool(serviceId, { startCommand: "...", buildCommand: "..." })
mcp.accept-deploy(environmentId, commitMessage: "describe the edit")
# wait for the resulting deployment; confirm status = SUCCESS
```

### When this is the only tool you need

- First-time service creation with build/deploy config bundled into
  `createServiceTool` — the initial `accept-deploy` that actualizes
  the service already flushes the bundled patches.
- Post-creation edits to any service field (`startCommand`,
  `buildCommand`, `watchPatterns`, env vars) — follow with
  `accept-deploy`.

### When to drop to direct GraphQL

Some capabilities the MCP doesn't expose and require
`https://backboard.railway.com/graphql/v2` with a project-scoped token
(`Project-Access-Token` header):

- **Service rename** — no MCP endpoint. Use `serviceUpdate(id, { name })`.
- **Multi-region config** — the MCP's `updateServiceTool` doesn't
  accept `multiRegionConfig`. Use
  `serviceInstanceUpdate(serviceId, environmentId, { multiRegionConfig })`.
- **Custom domain** — use `serviceDomainCreate` /
  `customDomainCreate`.
- **Inspecting the canonical `serviceInstance`** when you suspect a
  staged edit didn't flush. Query
  `service(id).serviceInstances.edges[].node.{startCommand, buildCommand, ...}`.

## Detection signal during an outage

If a deploy fails with Railpack's `No start command detected` on a
service where `getServiceConfigTool` reports startCommand as set:

1. Did you call `accept-deploy` after the last `updateServiceTool`?
   If not — that's the fix.
2. If yes and it still looks null, query
   `service(id).serviceInstances.edges[0].node.startCommand` via
   direct GraphQL. If that's null, the flush didn't happen — retry
   `accept-deploy`.

## Takeaway

The MCP isn't broken — calling `updateServiceTool` without a follow-up
`accept-deploy` is a use error. Treat `updateServiceTool` as
"prepare a change," not "apply a change." `accept-deploy` is the
apply step.

Three things the MCP legitimately doesn't expose (rename, multi-region
config, custom domains) still require direct GraphQL, but those are
narrow gaps rather than a fundamental fault.

## Related

- PR #804 — feat-104 admin Railway provisioning (where the usage
  mistake surfaced).
- PR #807 — filed feat-105 + this learning.
- `~/.claude/projects/-workspace/memory/railway_prod_credentials.md`
  documents the project-scoped token and the GraphQL endpoint.
