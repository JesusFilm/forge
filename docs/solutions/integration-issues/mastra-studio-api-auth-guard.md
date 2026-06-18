---
title: "Mastra Studio API routes must not inherit service-bearer route guards"
date: 2026-05-26
last_updated: 2026-06-09
category: integration-issues
module: apps/mastra
problem_type: integration_issue
component: authentication
symptoms:
  - "Mastra Studio workflow graph loaded the shell but failed its workflow API calls with 401 Service bearer required"
  - "Direct service routes such as /forge-smoke still worked with the expected bearer token"
  - "The scene embedding workflow could not be inspected from Studio even though the runtime was healthy"
root_cause: scope_issue
resolution_type: code_fix
severity: medium
related_components:
  - apps/mastra-gateway
  - apps/admin
tags:
  - mastra
  - studio
  - bearer-auth
  - workflow
  - scene-embedding
  - service-routes
  - gateway
  - agents
  - route-isolation
---

# Mastra Studio API Routes Must Not Inherit Service-Bearer Route Guards

## Problem

During feat-133 validation, Mastra Studio could open the scene embedding
workflow shell but its graph/API calls failed with `401 Service bearer
required`. The scene workflow itself was healthy, and service-to-service routes
worked, but the broad Mastra runtime middleware treated Studio's own
`/api/workflows` calls like backend service calls.

## Symptoms

- Studio opened at `/studio/workflows/sceneEmbeddingWorkflow/graph`, but the
  workflow list and graph calls returned `401`.
- A bearer-authenticated `POST /forge-smoke` returned `200`, so the service key
  parser and runtime were not the failing piece.
- Once Studio's API calls were reachable, the same runtime showed the scene
  workflow graph and ran the three expected steps.

## What Didn't Work

- Proving a custom route with `POST /forge-smoke` was not enough. That tests
  explicit Forge service routes, not Mastra Studio's built-in workflow APIs.
- Keeping the original `/api/*` guard matched the early Mastra runtime rollout
  plan, but the plan did not account for Studio using the same `/api/workflows`
  namespace from the browser.
- A local-only proxy on `4112` that injected the development bearer proved the
  route could work when a bearer was present, but it was only a workaround
  (session history). It depended on local Studio/process state and would have
  put a backend service credential on a browser-facing path.
- Stale duplicate Mastra dev processes made validation noisy. A process still
  bound to `4111` can keep serving old env or old code while another restart
  reports `EADDRINUSE`, so workflow validation should start from one known
  Mastra process.
- Earlier feat-133 research correctly identified that Mastra should keep service
  bearer validation receiver-side and keep workflow outputs safe, but it did not
  flag the Studio/API namespace collision before browser validation (session
  history).

## Solution

Keep bearer authentication on Forge-owned service routes, but do not attach a
global service-bearer middleware to Mastra's built-in `/api/*` namespace.

Before, `apps/mastra/src/mastra/index.ts` protected every `/api/*` request:

```ts
server: {
  apiRoutes: [
    registerApiRoute("/forge-smoke", { method: "POST", handler }),
    registerApiRoute("/forge-transcript-embeddings", { method: "POST", handler }),
  ],
  middleware: [
    {
      path: "/api/*",
      handler: async (c, next) => {
        if (!isValidServiceBearer({ authHeader, allowlist: serviceKeys })) {
          return unauthorizedJson()
        }
        await next()
      },
    },
  ],
}
```

After the fix, only explicit service routes validate the bearer. Studio's
runtime APIs remain available to the Studio frontend, while service callers
still cannot invoke Forge routes without a valid key:

```ts
server: {
  studioBase: "/studio",
  apiRoutes: [
    registerApiRoute("/forge-smoke", {
      method: "POST",
      handler: async (c) => {
        const authHeader = c.req.header("authorization")
        if (!isValidServiceBearer({ authHeader, allowlist: serviceKeys })) {
          return c.json({ error: "Service bearer required" }, 401)
        }

        const body = (await c.req.json().catch(() => ({}))) as {
          input?: unknown
        }
        return c.json(createSmokeResponse(String(body.input ?? "smoke")))
      },
    }),
    registerApiRoute("/forge-transcript-embeddings", {
      method: "POST",
      handler: async (c) => {
        const outcome = await handleTranscriptEmbeddingRouteRequest({
          authHeader: c.req.header("authorization"),
          serviceKeys,
          readJson: () => c.req.json(),
        })

        return new Response(JSON.stringify(outcome.body), {
          status: outcome.status,
          headers: { "content-type": "application/json" },
        })
      },
    }),
    registerApiRoute("/forge-scene-embeddings", {
      method: "POST",
      handler: async (c) => {
        const outcome = await handleSceneEmbeddingRouteRequest({
          authHeader: c.req.header("authorization"),
          serviceKeys,
          readJson: () => c.req.json(),
        })

        return new Response(JSON.stringify(outcome.body), {
          status: outcome.status,
          headers: { "content-type": "application/json" },
        })
      },
    }),
  ],
}
```

The human access boundary belongs outside these service routes:
`apps/mastra-gateway`, Railway networking, and edge controls own who may reach
Studio. `apps/mastra` owns runtime execution plus service-bearer checks for
stable backend entry points like `/forge-scene-embeddings`.

## Why This Works

Mastra Studio is not just static assets. The browser shell calls Mastra's
built-in workflow APIs, including `/api/workflows`, to render graphs, run
workflows, and inspect run state. A runtime-level `/api/*` bearer guard blocks
those browser calls unless Studio is also changed to inject the service token,
which would leak the backend service credential into a human browser surface.

Scoping the bearer check to explicit Forge service routes preserves both
boundaries:

- Backend callers still need `MASTRA_SERVICE_API_KEYS` for `/forge-*` routes.
- Studio can call Mastra's built-in APIs without receiving a service secret.
- Public Studio exposure remains controlled by the gateway and infrastructure
  layer, not by sharing service credentials with the browser.

The fix was validated with a real scene embedding run from Studio. The workflow
ran against the local Admin target `10_Darkroom01Doubt`, stored two
`video_scene_locale` rows with non-null `vector(1536)` embeddings and Mastra
provenance, then existing Admin semantic retrieval returned the video as the top
result for matching text.

Focused Mastra validation passed after the route-scope fix:

```bash
pnpm --filter @forge/mastra test -- scene-embedding.test.ts admin-scene-ingest-client.test.ts
pnpm --filter @forge/mastra typecheck
pnpm --filter @forge/mastra lint
```

## Prevention

- Browser-test Studio after changing Mastra server middleware or route
  registration. A green custom route does not prove Studio's built-in APIs.
- Treat Mastra service-bearer auth as an explicit service-route concern unless
  the gateway architecture also supplies a safe browser-auth story for Studio's
  own `/api/*` calls.
- Add or keep negative tests for custom route handlers: missing and wrong
  bearers must reject `/forge-smoke`, `/forge-transcript-embeddings`, and
  `/forge-scene-embeddings`.
- For local end-to-end checks, confirm one Mastra dev server owns `4111` before
  trusting Studio results. Kill duplicate `pnpm --filter @forge/mastra dev`
  processes and restart with the Admin ingest URL, Admin ingest bearer,
  `MASTRA_SERVICE_API_KEYS`, provider key, and Mastra storage database URL.
- Keep workflow outputs scrubbed. This auth fix makes Studio usable, so step
  outputs must continue exposing only summaries such as counts, hashes, ids,
  model names, dimensions, and run ids, not raw vectors or full source text.
- When applying old rollout plans, re-check assumptions against the running
  product. `docs/plans/2026-05-22-001-feat-mastra-railway-runtime-plan.md`
  recommended `/api/*` middleware before the Studio workflow graph behavior was
  validated.

## Generalization: registered agents are exposed too, and route-isolation tests only guard custom routes

The same framework behavior that makes Studio's `/api/workflows` calls work also
applies to agents. **Any agent registered in `new Mastra({ agents: { ... } })`
is automatically reachable over the framework-generated built-in `/api/agents/*`
surface** (generate/stream), regardless of whether any custom
`registerApiRoute` / `/forge-*` route references it. The runtime deliberately
has no broad `/api/*` service-bearer guard (that guard would also block Studio's
own browser calls), so a registered agent is reachable by anyone who can reach
the Mastra HTTP endpoint.

Consequence for tests: a "route-isolation" test that only inspects the custom
`apiRoutes` array / `registerApiRoute` calls — e.g. a source-text assertion that
the agent symbol does not appear in `apiRoutes` — proves only **"no CUSTOM route
exposes the agent."** It does **not** prove the agent is private or unreachable.
"Not on a custom route" ≠ "not exposed." The seeker skeleton's
`apps/mastra/src/mastra/seeker-route-isolation.test.ts` is scoped exactly this
way, and its header comment says so verbatim ("WHAT THIS DOES NOT PROVE: that
the agent is unreachable … Mastra's framework-generated `/api/agents/*` surface
exposes ANY registered agent").

The real containment boundary is the same one this doc establishes for Studio:
the network/gateway layer (`apps/mastra-gateway` + Railway networking), **not**
application code and **not** a route-isolation test. Any such test's assertion
comment must state plainly that it guards custom routes only — a green
`/forge-*` isolation check must never be read as proof the agent is or isn't
exposed.

## Related Issues

- `mastra-conversational-agent-memory-and-model-router-wiring.md` documents the
  feat-198 seeker agent wiring (memory API, model-router provider/key) whose
  route-isolation test is the worked example of the generalization above.
- `../platform/mastra-scene-embedding-workflow-pattern.md` documents the
  feat-133 ownership split: Manager source artifacts, Mastra provider calls,
  Admin ingest/storage/search.
- `../platform/mastra-transcript-embedding-workflow-pattern.md` is the sibling
  transcript pattern that scene embedding copied for safe step summaries and
  Admin-owned vector storage.
- `../architecture-patterns/parity-bearer-narrow-carveout-pattern-20260513.md`
  covers the broader Forge pattern of narrow bearer principals instead of
  widening shared auth surfaces.
- `../../plans/2026-05-22-001-feat-mastra-railway-runtime-plan.md` is
  historical for Mastra runtime rollout; its `/api/*` middleware note should be
  treated as superseded by this Studio validation.
