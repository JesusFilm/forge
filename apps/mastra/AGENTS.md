# Mastra Agent Guide

`apps/mastra` owns Forge's Mastra runtime, Studio surface, agent registry,
tool registry, workflow registry, and operational runtime storage.

## Boundaries

- Manager, CMS, Web, and other apps must consume Mastra through HTTP contracts.
- Do not import Manager internals from this app.
- V1 Manager automation support is dry-run only. Live job creation remains
  Manager-owned and requires a later approval plan.
- Canonical content remains in Strapi/CMS. Mastra storage is operational state,
  not user-visible content truth.

## Runtime

- Package: `@forge/mastra`
- Local default port: `4111`
- `MASTRA_PORT` overrides Railway `PORT`; `PORT` is used when `MASTRA_PORT` is unset.
- Public health route: `GET /health`
- Manager trigger route: `POST /forge/manager-automation-dry-run`
- Mastra custom route note: `registerApiRoute` reserves `/api/*`, so custom
  Forge routes should use non-`/api` root paths unless platform ingress adds a
  proxy later.

## Auth

- Studio and built-in API routes require `MASTRA_OPERATOR_API_KEY` bearer auth.
- `MASTRA_SERVICE_API_KEY` is only valid for `POST /forge/manager-automation-dry-run`.
- `/health` must stay public.
- Required secrets:
  - `MASTRA_SERVICE_API_KEY` for Manager-to-Mastra calls.
  - `MASTRA_OPERATOR_API_KEY` for operator Studio/API access.
  - `MANAGER_MASTRA_API_KEY` for Mastra-to-Manager calls.

## Verification

Run:

```sh
pnpm --filter @forge/mastra lint
pnpm --filter @forge/mastra typecheck
pnpm --filter @forge/mastra test
pnpm --filter @forge/mastra build
```
