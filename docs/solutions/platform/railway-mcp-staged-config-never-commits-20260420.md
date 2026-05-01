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

## Recurrence — 2026-04-29

This trap repeated 9 days after this doc was written. During the
`@forge/admin` prod migration recovery, the agent (Nisal session)
called `updateServiceTool` to clear a dashboard `Custom Start
Command` override, watched the `"applied" / "staged for deployment"`
ACK, and called `mcp__railway__redeploy` instead of `accept-deploy`.
Result: deployment `3b1408a1` snapshotted the unchanged canonical
config and ran the OLD command. One extra deploy cycle (~10 min)
burned before the user (also Nisal) flagged that the Railway dashboard
UI was prompting "Confirm and Deploy" — the unflushed staged-patch
buffer surfaced visually. Searching `docs/solutions/platform/railway-*`
then surfaced this doc, and the recovery completed via the correct
`updateServiceTool` → `accept-deploy` sequence.

The institutional learning is not a new failure mode; it's that the
existing learning was missed. Two mitigations landed alongside the
2026-04-29 incident:

1. **Memory breadcrumb** at `~/.claude/projects/-workspace/memory/feedback_railway_mcp_accept_deploy.md`
   indexed in `MEMORY.md` so future agent sessions surface this doc
   before any railway-mcp write.
2. **A new sibling solutions doc** at
   [`deployment/railway-dashboard-override-shadows-railway-toml-20260429.md`](../deployment/railway-dashboard-override-shadows-railway-toml-20260429.md)
   covers a related-but-distinct trap (per-service `apps/<svc>/railway.toml`
   not honored unless Config-as-code Path is set; dashboard `Custom
Start Command` override silently winning) that the 2026-04-29
   incident also surfaced.

If you're an agent and you reached this doc _after_ calling
`updateServiceTool` followed by `redeploy` and seeing nothing happen:
the fix is `mcp__railway__accept-deploy(environmentId)`. Cancel any
in-flight redeploy that snapshotted the stale config, then re-trigger
via `accept-deploy` from a clean state.

## Recurrence — 2026-04-30 (env-var VALUES variant)

This trap bit a third time, this time with an extra wrinkle: the
staged-patch buffer affects env-var **values**, not just build/deploy
fields like `startCommand`. Earlier framing pushed the trap as a
build-config concern, which masked the env-var case.

During the demo-search-keyword + Algolia parity column work
(PR #864, 2026-04-30), four env vars (`ALGOLIA_APP_ID`,
`ALGOLIA_SEARCH_API_KEY`, `ALGOLIA_INDEX`,
`SEARCH_DEBUG_ALLOWED_ORIGINS`) were written via the railway-agent's
`updateServiceTool`. The agent reported `"applied" / "staged for
deployment"`, then followed up with its own `deployServiceTool` call
(equivalent to `redeploy`). Two consecutive deploys
(`960a674c` → `0b4fe905`) booted containers whose runtime
threw `Error: algolia_not_configured` — env values absent from
`process.env` despite `getServiceConfigTool` showing all four KEYS
present in canonical config.

The masking trap: `getServiceConfigTool` returns
`{ "ALGOLIA_INDEX": { "value": "<hidden_from_agent>" } }` whether
the value is committed or staged-but-uncommitted. The KEY appearing
in canonical config is therefore not evidence the VALUE landed.

Resolution required calling `mcp__railway__accept-deploy(envId)`
explicitly (the railway-agent doesn't expose this tool through its
own surface; load it via `ToolSearch select:mcp__railway__accept-deploy`).
After flush, deploy `50ea8af1` came up — but with a **rotated**
Algolia key (separate problem; see related Algolia learning), so a
fourth deploy `29b854a1` was needed with the current Doppler value.
Total: ~45 minutes + 4 build cycles before the column rendered live.

**The corrected detection rule:** The runtime is the source of
truth. If logs show empty / missing values when canonical-config
readback "shows" them set, the staged patch never flushed —
regardless of whether the keys appear present. Don't trust the
masked readback alone; verify by hitting an endpoint that exercises
the value, or grep runtime logs for the symptom.

**Why the railway-agent failure repeats:** the `railway-agent`
MCP tool reports it doesn't have `accept-deploy` available and
falls back to `deployServiceTool`. That is wrong for any write that
includes env vars or build/deploy fields. Always load
`mcp__railway__accept-deploy` directly via ToolSearch and call it
yourself when staging via the agent.

## Related

- PR #804 — feat-104 admin Railway provisioning (where the usage
  mistake surfaced).
- PR #807 — filed feat-105 + this learning.
- [`deployment/railway-dashboard-override-shadows-railway-toml-20260429.md`](../deployment/railway-dashboard-override-shadows-railway-toml-20260429.md)
  — sibling failure mode authored after the 2026-04-29 recurrence.
- `docs/plans/2026-04-29-004-fix-admin-prod-migration-recovery-plan.md`
  — recovery plan whose Phase 1 reproduced this trap.
- `~/.claude/projects/-workspace/memory/railway_prod_credentials.md`
  documents the project-scoped token and the GraphQL endpoint.
- `~/.claude/projects/-workspace/memory/feedback_railway_mcp_accept_deploy.md`
  — agent memory pointer to this doc + the verify-infra-writes meta-pattern.
