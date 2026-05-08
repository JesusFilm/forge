# Agentic Agent Guide

`apps/agentic` owns Forge's Mastra runtime, Studio surface, agent registry,
tool registry, workflow registry, and operational runtime storage.

## Boundaries

- Manager, CMS, Web, and other apps must consume Agentic through HTTP contracts.
- Do not import Manager internals from this app.
- V1 Manager automation support is dry-run only. Subtitle enrichment may start
  Agentic workflow runs only after Manager has created the approved job.
- Canonical content remains in Strapi/CMS. Mastra storage is operational state,
  not user-visible content truth.

## Runtime

- Package: `@forge/agentic`
- Local default port: `4111`
- `AGENTIC_PORT` overrides Railway `PORT`; `PORT` is used when `AGENTIC_PORT` is unset.
- Public health route: `GET /health`
- Manager dry-run route: `POST /forge/manager-automation-dry-run`
- Manager subtitle workflow route: `POST /forge/subtitle-enrichment-runs`
- Mastra custom route note: `registerApiRoute` reserves `/api/*`, so custom
  Forge routes should use non-`/api` root paths unless platform ingress adds a
  proxy later.

## Auth

- Studio and built-in API routes require `AGENTIC_OPERATOR_API_KEY` bearer auth.
- `AGENTIC_SERVICE_API_KEY` is only valid for Manager service routes:
  `POST /forge/manager-automation-dry-run` and
  `POST /forge/subtitle-enrichment-runs`.
- `/health` must stay public.
- Required secrets:
  - `AGENTIC_SERVICE_API_KEY` for Manager-to-Agentic calls.
  - `AGENTIC_OPERATOR_API_KEY` for operator Studio/API access.
  - `MANAGER_AGENTIC_API_KEY` for Agentic-to-Manager calls.
- These three tokens must be distinct. Production ignores CI placeholder
  leniency and rejects `:memory:` or relative file storage.
- Agentic-to-Manager callbacks use `AGENTIC_MANAGER_REQUEST_TIMEOUT_MS`, default
  `60000`.

## Private Studio service

- The primary runtime Railway service remains `agentic` and serves `/health`,
  `/forge/*`, and authenticated Mastra APIs.
- Manager-gated Studio access uses a separate private Railway service named
  `agentic-studio`.
- `agentic-studio` must have no public Railway domain. Manager reaches it through
  Railway private networking and exposes it only through `/api/agentic-studio/*`.
- The Studio service should use the same `AGENTIC_OPERATOR_API_KEY` as the
  runtime. The browser never receives that token; Manager injects it server-side.
- Set `MASTRA_STUDIO_BASE_PATH=/api/agentic-studio` and prove in browser smoke
  that Studio requests stay under the Manager origin.

## Verification

Run:

```sh
pnpm --filter @forge/agentic lint
pnpm --filter @forge/agentic typecheck
pnpm --filter @forge/agentic test
pnpm --filter @forge/agentic build
```
