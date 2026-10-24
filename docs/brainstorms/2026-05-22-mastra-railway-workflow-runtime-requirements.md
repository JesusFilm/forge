---
date: 2026-05-22
topic: mastra-railway-workflow-runtime
related:
  - docs/roadmap/platform/feat-121-jesus-film-auth-platform.md
  - docs/roadmap/media-generation/feat-084-manager-agents-automations.md
  - docs/roadmap/media-generation/feat-087-manager-agent-dry-run-mode.md
  - docs/brainstorms/2026-04-12-manager-agents-automations-requirements.md
  - docs/brainstorms/2026-03-28-subtitle-translation-pipeline-requirements.md
  - docs/solutions/platform/new-app-ci-and-deployment-patterns.md
  - docs/solutions/deployment/nextjs-pnpm-monorepo-railway-standalone.md
---

# Mastra Railway Workflow Runtime

## Problem Frame

Forge needs a shared agent and workflow runtime that apps such as Manager can
call for media operations like subtitle configuration, translation, retiming,
and future agent-driven workflows. Mastra is the candidate runtime, but the
first deployment must preserve Forge-owned authentication and avoid making
Mastra Studio publicly reachable without our auth boundary.

The desired first slice is a basic Railway deployment that proves Mastra Server
can run agents/workflows, Mastra Studio can be reached by authorized humans, and
Forge apps can call the server through a narrow service-bearer contract.

## Requirements

**Deployment Shape**

- R1. Add a new Railway-deployable Mastra service in the monorepo that runs the
  Mastra Server runtime for agents and workflows.
- R2. Serve Mastra Studio for authorized internal users without exposing an
  unauthenticated public Studio surface.
- R3. Keep Studio access and app-to-server access as separate auth concerns:
  Studio is for humans, while apps call Mastra Server APIs.
- R4. The first deployed runtime must include a simple smoke-test agent or
  workflow so deployment, health, and service calls can be verified before
  moving Manager subtitle work onto the runtime.

**Forge Authentication**

- R5. Use the existing Forge Auth app as the human identity provider for the
  public Studio entry point.
- R6. Use service-bearer authentication for app-to-Mastra calls in V1. Manager
  should call Mastra Server with a configured bearer token instead of requiring
  user-scoped Mastra tokens in the first slice.
- R7. Treat Forge Auth as the identity and token authority. The Mastra gateway
  owns Studio-specific access records, and Mastra validates service credentials
  at its boundary.
- R8. Do not depend on Mastra's native production SSO or RBAC features for V1.
  The brainstorm assumes those may require a Mastra Enterprise license when
  using third-party production providers.
- R8a. The Studio gateway must enforce gateway-owned Mastra Studio access
  records after Forge Auth login. `apps/admin` is an analogy for owning its own
  users; it is not the source of truth for this gateway's access list.
- R8b. The Studio gateway must expose a simple `/admin` user-management surface
  for Mastra Studio access. Gateway admins can review access requests, approve
  or revoke users, and change permission levels. Gateway editors can access
  Studio but cannot manage access.

**Manager Workflow Integration**

- R9. Preserve Manager as the product UI for subtitle and enrichment
  configuration. Operators should continue to start work from Manager, not from
  Mastra Studio.
- R10. Let Manager call a stable Mastra workflow or agent API for future
  subtitle operations, including target language configuration, glossary or
  language-specific prompts, translation, retiming, validation, and artifact
  reporting.
- R11. Use Mastra Studio as the advanced operator/developer surface for
  inspecting runs, traces, prompts, tool calls, workflow failures, and smoke
  tests.

**Security and Operations**

- R12. Prevent browser users from bypassing the Forge-authenticated Studio entry
  point and reaching the underlying Mastra service directly.
- R13. Avoid logging raw bearer tokens, session cookies, client secrets, model
  API keys, or unnecessary user-identifying data from Studio proxy or Mastra
  server traffic.
- R14. Include Railway deployment readiness checks: health endpoint, required
  environment variables, build/start commands, and a smoke path that proves the
  service bearer can run the smoke-test agent or workflow.

## Success Criteria

- An authorized Forge user can open the protected Studio entry point on Railway.
- A Forge user without the gateway-owned Mastra Studio access grant cannot open
  the protected Studio entry point even if they can sign in to Forge Auth.
- Revoking the Mastra Studio access grant prevents future Studio access without
  changing Mastra-native configuration.
- A gateway admin can open `/admin`, accept a pending access request, and assign
  the requester either admin or editor access.
- A gateway editor can open Studio but cannot open or use the `/admin` access
  management surface.
- An unauthenticated user cannot reach Studio or invoke Mastra APIs through the
  public entry point.
- Manager or a scripted stand-in can call Mastra Server with a service bearer
  and run the smoke-test agent/workflow.
- Mastra Studio can observe the smoke-test run against the deployed server.
- The deployment path does not require Mastra native production SSO/RBAC.
- Planning can proceed with clear boundaries between human Studio access,
  service-to-service runtime access, and future Manager subtitle integration.

## Scope Boundaries

- Do not migrate Manager subtitle workflows to Mastra in the first deployment
  slice.
- Do not build free-form agent authoring for Manager users in V1.
- Do not make Mastra Studio the normal product surface for subtitle
  configuration.
- Do not use user-scoped delegated tokens for Manager-to-Mastra calls in V1;
  service bearer is the chosen first contract.
- Do not rely on unauthenticated public Mastra endpoints protected only by
  obscurity or unlinked Railway URLs.

## Key Decisions

- Railway self-hosting: Aligns with Forge's existing deployment model and keeps
  runtime/network controls under the project.
- Forge-owned auth boundary: Better Auth in `apps/auth` remains the identity
  authority, avoiding a second user source of truth for V1.
- Service bearer first: This is enough for Manager and other server-side apps to
  call the runtime while avoiding early complexity around user delegation,
  token exchange, and Mastra-native RBAC.
- Manager remains the workflow product UI: Studio is powerful, but subtitle
  configuration belongs in Manager where existing operator workflows, review
  pages, and job state already live.

## Dependencies / Assumptions

- `apps/auth` continues as the Forge OAuth/OIDC authority and can register a
  new first-party app/client for the Studio gateway if needed.
- `apps/mastra-gateway` owns its own Studio access records and management UI.
  `apps/admin` should not be a dependency for approving or changing Mastra
  Studio gateway access.
- Railway can be configured so the underlying Mastra service is not directly
  reachable by normal users, or so direct access is independently rejected.
- Mastra Studio can be served behind or through a Forge-authenticated entry
  point without breaking required assets, streaming responses, or runtime API
  calls. This should be proven during planning/implementation.
- Mastra native production SSO/RBAC licensing remains a risk to avoid in V1
  unless the team chooses to purchase or confirm licensing.

## Outstanding Questions

### Resolve Before Planning

- None.

### Deferred to Planning

- [Affects R1-R4][Needs research] Should Studio be served by `mastra build
--studio` behind a gateway, deployed as a separate static Studio app, or
  reverse-proxied through a minimal Next.js gateway?
- [Affects R5-R8][Technical] Should the first gateway be a dedicated Next.js app
  or an authenticated route inside an existing internal app?
- [Affects R12][Technical] What Railway networking or edge controls best prevent
  direct access to the underlying Mastra service?
- [Affects R10][Technical] What is the smallest future Manager-to-Mastra API
  contract that preserves current subtitle job semantics and artifact reporting?

## Next Steps

-> /ce:plan for structured implementation planning.
