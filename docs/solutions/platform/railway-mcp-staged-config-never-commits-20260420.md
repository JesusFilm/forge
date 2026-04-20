---
title: Railway remote MCP stages build/deploy config to a layer that never commits — fall back to GraphQL
date: 2026-04-20
tags: [railway, mcp, deployment, infrastructure]
category: platform
severity: high
---

## Problem

The Railway remote MCP (`https://mcp.railway.com`) exposes an
`updateServiceTool` for editing a service's build and deploy config —
`buildCommand`, `startCommand`, `healthcheckPath`, `watchPatterns`,
`multiRegionConfig`. Calls return success:

```json
{
  "status": "applied",
  "message": "Service has been updated and changes are staged for deployment."
}
```

and subsequent `getServiceConfigTool` reads back the updated values.
The values **never reach the actual builder**. Every deployment
captures `startCommand: null`, `buildCommand: null`,
`healthcheckPath: null` in its snapshot and Railpack auto-detects
instead, failing with `No start command detected` on a workspace
package where the root has no `start` script.

Observed in feat-104 (admin Railway provisioning) on 2026-04-20:
five deployments failed in a row before the diagnosis clicked. Each
MCP `updateServiceTool` call appeared to succeed. `getServiceConfigTool`
reported the correct values. `getDeploymentInfoTool` on each deploy
showed the same nulls.

## Root cause

Railway has two layers of service config:

1. **`serviceInstance`** — the canonical per-(service, environment) row.
   Holds `startCommand`, `buildCommand`, `healthcheckPath`, `region`,
   `builder`, etc. **Deployments snapshot from this row** at trigger
   time.
2. **Staged patches** — Railway's dashboard supports "stage then commit"
   edits. Unapplied patches live here; a commit operation merges them
   into `serviceInstance`.

The MCP's `updateServiceTool` writes to the staged patch layer. The
wording in the response (`"staged for deployment"`) confirms this.
However:

- `accept-deploy` (`commitChanges` in the underlying API) only commits
  patches attached to a new **deploy-triggering** change (e.g. initial
  service creation, template deploy). Post-creation config patches
  don't pivot off a deploy trigger, so they sit in the staged layer
  indefinitely.
- `deployServiceTool` triggers a deploy from the **live**
  `serviceInstance` snapshot, not from staged patches.
- `getServiceConfigTool` reads the staged-merged view, which is why
  the values look "set" even though `serviceInstance` is empty.

Net effect: build/deploy config edits via the MCP are a no-op against
the actual deploy pipeline until the staged layer is also flushed —
and as of this writing, the MCP exposes no tool to do that flush for
non-deploy-triggering edits.

Environment variables bundled into initial `serviceCreate` DO commit
(because service creation is itself a deploy trigger). Post-creation
variable edits via MCP are untested but likely affected.

## Fix — use direct GraphQL via a project-scoped token

Railway's public GraphQL API at `https://backboard.railway.com/graphql/v2`
writes directly to `serviceInstance`. A project-scoped token sent via
the `Project-Access-Token` header has enough permission for all
relevant mutations.

### Verify the token

```bash
curl -sS -X POST https://backboard.railway.com/graphql/v2 \
  -H "Content-Type: application/json" \
  -H "Project-Access-Token: $RAILWAY_API_TOKEN" \
  -d '{"query":"query { projectToken { projectId environmentId } }"}'
```

### Update build + deploy config

```graphql
mutation (
  $serviceId: String!
  $environmentId: String!
  $input: ServiceInstanceUpdateInput!
) {
  serviceInstanceUpdate(
    serviceId: $serviceId
    environmentId: $environmentId
    input: $input
  )
}
```

`ServiceInstanceUpdateInput` accepts:

- `startCommand: String`
- `buildCommand: String`
- `healthcheckPath: String`
- `healthcheckTimeout: Int`
- `watchPatterns: [String!]`
- `multiRegionConfig: JSON` (shape: `{ "<region-id>": { "numReplicas": <n> } }`)
- `builder: Builder` (`NIXPACKS` | `RAILPACK` | `DOCKERFILE` | `HEROKU`)
- `rootDirectory: String`
- `preDeployCommand: [String!]`

### Trigger a fresh deploy so the next snapshot captures the update

```graphql
mutation ($serviceId: String!, $environmentId: String!) {
  serviceInstanceDeployV2(serviceId: $serviceId, environmentId: $environmentId)
}
```

### Rename a service (MCP has no rename)

```graphql
mutation ($id: String!, $input: ServiceUpdateInput!) {
  serviceUpdate(id: $id, input: $input) {
    id
    name
  }
}
```

### Verify the update landed

```graphql
query ($serviceId: String!) {
  service(id: $serviceId) {
    serviceInstances {
      edges {
        node {
          startCommand
          buildCommand
          healthcheckPath
          builder
          multiRegionConfig
        }
      }
    }
  }
}
```

If these match what you set, the next deploy will honor them. If they
don't, the write went to the staged layer — switch to direct GraphQL.

## When the MCP is fine

- **Service creation with bundled env vars** — committed by the initial
  `accept-deploy` that actualizes the service.
- **`mcp__railway__list-projects` / `list-services` / `whoami`** —
  read-only queries, return live data.
- **`mcp__railway__accept-deploy`** on the first service-creation
  transaction.

## When to drop to GraphQL

- Post-creation edits to `startCommand`, `buildCommand`,
  `healthcheckPath`, `watchPatterns`, `multiRegionConfig`,
  `rootDirectory`, `builder`.
- Service renames (MCP has no rename endpoint).
- Custom domain creation (`serviceDomainCreate`).
- Anything where you need to confirm the write actually reached
  `serviceInstance`.

## Detection signal during an outage

If builds fail with `No start command detected` on a service where
`getServiceConfigTool` reports the start command as set:

1. Query `service(id).serviceInstances.edges[0].node.startCommand` via
   direct GraphQL.
2. If that's `null`, you've hit this bug.
3. Fix via `serviceInstanceUpdate`, then redeploy.

## Related

- PR #804 — feat-104 admin Railway provisioning (where this surfaced).
- Issue opened upstream on the Railway MCP: _(TODO when filed)_.
- `~/.claude/projects/-workspace/memory/railway_prod_credentials.md`
  documents the project-scoped token and the GraphQL endpoint.
