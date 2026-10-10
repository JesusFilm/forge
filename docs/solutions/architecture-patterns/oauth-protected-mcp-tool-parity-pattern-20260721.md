---
title: "OAuth-protected MCP servers need advertised-tool parity and client-flexible token checks"
date: "2026-07-21"
category: "architecture-patterns"
module: "apps/admin, apps/auth"
problem_type: "best_practice"
component: "mcp"
severity: "high"
related_components:
  - "oauth"
  - "agent-tools"
tags:
  - "mcp"
  - "oauth"
  - "codex"
  - "claude"
  - "tool-contract"
root_cause: "contract_drift"
resolution_type: "implementation_pattern"
---

# OAuth-Protected MCP Tool Parity Pattern

## Context

Remote MCP clients discover server capability from `tools/list`, then call the
listed tools directly. If the server advertises a tool before the route
dispatches it, the agent sees an attractive path that fails at runtime.

OAuth has a similar edge: hosted MCP clients may dynamically register their own
public PKCE clients. A resource server that validates issuer, audience,
environment, scopes, and Admin principal can still accidentally block valid MCP
clients if it hard-codes only locally seeded client ids.

## Guidance

Keep three contracts aligned before shipping an MCP server:

- `tools/list` only advertises tools the JSON-RPC route dispatches.
- Every advertised write or privileged read has a per-tool required scope and a
  service-layer authorization check.
- Client id allow-lists are optional. Use them only for environments that need
  explicit pinning; default hosted MCP compatibility should rely on issuer,
  audience/resource, environment, scope, and principal validation.

For Admin MCP, this means `ADMIN_MCP_TOOLS`, `callAdminMcpTool`, and
`ExperienceLocaleMcpService` should change together. Tests should cover at
least one call for every non-trivial tool category: read, validate/diff, write,
media/video, Bible, and publish.
