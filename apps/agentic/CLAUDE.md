# Agentic App

This app is Forge's first-class agentic runtime, powered by Mastra and Mastra
Studio. It is a platform boundary for agents and workflows that may be used by
Manager first and future apps later.

## Ownership

- Owns: Mastra runtime config, Studio access, agents, tools, workflows,
  operational traces, and runtime storage.
- Does not own: canonical content, Manager automation definitions, enrichment
  job truth, live job creation, or human approval semantics.

## Environment

Required for all non-test boots:

- `AGENTIC_SERVICE_API_KEY`
- `AGENTIC_OPERATOR_API_KEY`
- `AGENTIC_STORAGE_URL`
- `AGENTIC_MODEL`
- `MANAGER_BASE_URL`
- `MANAGER_AGENTIC_API_KEY`
- `AGENTIC_MANAGER_REQUEST_TIMEOUT_MS` (optional, defaults to `60000`)

Production rejects missing auth, storage, model, and Manager service config.
Production also rejects weak secrets, relative file storage, and `:memory:`
storage even when `CI=true`. CI may use distinct placeholders from `.env.ci`;
service, operator, and Manager callback tokens must not be reused.

`AGENTIC_PORT` is the preferred explicit runtime port. If it is unset, the app
falls back to Railway's `PORT` env var before using the local default `4111`.

## Auth And Routes

Mastra `server.auth` plus the app global middleware are the app-level source of
truth for Studio and built-in API protection. `GET /health` uses Mastra's
built-in health endpoint and stays public.

`AGENTIC_OPERATOR_API_KEY` is the only credential that can access Studio, root
HTML, and built-in Mastra API routes. `AGENTIC_SERVICE_API_KEY` is only valid for
`POST /forge/manager-automation-dry-run`; it must not grant Studio or broad
`/api/*` access.

The Manager dry-run route is bearer-gated and accepts only:

```ts
{
  automationDocumentId: string
  requestedBy: {
    kind: "manager_user" | "service"
    id: string
  }
  idempotencyKey: string
}
```

V1 does not accept `runMode`; Agentic can only call Manager's dry-run-only
contract.

## Runtime State

Mastra uses LibSQL storage via `AGENTIC_STORAGE_URL`. Local development may use a
file URL such as `file:./.mastra/local.db`. Production must provision persistent
storage; relative file URLs and `:memory:` are rejected in production. Manager
remains the operator-visible source for dry-run reports.

## Deployment

Intended Railway service name: `agentic`.

- Build command: `pnpm --filter @forge/agentic build`
- Start command: `cd apps/agentic && node .mastra/output/index.mjs`
- Health check: `GET /health`

`apps/agentic/railway.toml` is the intended config-as-code source. Before
promoting a deployment, verify the Railway service `configFile` points at
`apps/agentic/railway.toml` and is not `null`; dashboard overrides can shadow
repo config.

### Private Agentic Studio service

Manager-gated Studio access is deployed as a separate Railway service named
`agentic-studio` in the same project/environment as Manager and `agentic`.

- Branch: `stage`
- Root directory: `/`
- Build command: `pnpm --filter @forge/agentic build`
- Start command: start from `pnpm --filter @forge/agentic exec mastra studio --port $PORT`, then include the proven base-path/server-target/private-bind settings required for Manager proxying.
- Required vars: `PNPM_CONFIG_PROD=false`, `HUSKY=0`, `NODE_ENV=production`,
  `MASTRA_STUDIO_BASE_PATH=/api/agentic-studio`, and the same
  `AGENTIC_OPERATOR_API_KEY` used by the runtime.

Do not attach a public domain to `agentic-studio`. Manager should use
`AGENTIC_STUDIO_ORIGIN=http://agentic-studio.railway.internal:<port>` or the
Railway reference-variable equivalent, validate the Manager session, and inject
the operator bearer server-side. Deployment proof must include Railway config
readback and an outside-Railway unauthenticated probe showing no known Studio
public domain serves Mastra Studio.

## External Docs Used

- Mastra project structure: `src/mastra/index.ts`, `agents`, `tools`,
  `workflows`.
- Mastra server auth protects Studio and custom routes, with `requiresAuth:
false` used for public health.
- Mastra custom routes registered by `registerApiRoute` are root paths and
  cannot start with `/api`.
