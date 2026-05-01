# Agentic Agent Guide

`apps/agentic` owns Forge's Mastra runtime, Studio surface, agent registry,
tool registry, workflow registry, and operational runtime storage.

## Boundaries

- Manager, CMS, Web, and other apps must consume Agentic through HTTP contracts.
- Do not import Manager internals from this app.
- V1 Manager automation support is dry-run only. Live job creation remains
  Manager-owned and requires a later approval plan.
- Canonical content remains in Strapi/CMS. Mastra storage is operational state,
  not user-visible content truth.

## Runtime

- Package: `@forge/agentic`
- Local default port: `4111`
- `AGENTIC_PORT` overrides Railway `PORT`; `PORT` is used when `AGENTIC_PORT` is unset.
- Public health route: `GET /health`
- Manager trigger route: `POST /forge/manager-automation-dry-run`
- Mastra custom route note: `registerApiRoute` reserves `/api/*`, so custom
  Forge routes should use non-`/api` root paths unless platform ingress adds a
  proxy later.

## Auth

- Studio and built-in API routes require `AGENTIC_OPERATOR_API_KEY` bearer auth.
- `AGENTIC_SERVICE_API_KEY` is only valid for `POST /forge/manager-automation-dry-run`.
- `/health` must stay public.
- Required secrets:
  - `AGENTIC_SERVICE_API_KEY` for Manager-to-Agentic calls.
  - `AGENTIC_OPERATOR_API_KEY` for operator Studio/API access.
  - `MANAGER_AGENTIC_API_KEY` for Agentic-to-Manager calls.

## Verification

Run:

```sh
pnpm --filter @forge/agentic lint
pnpm --filter @forge/agentic typecheck
pnpm --filter @forge/agentic test
pnpm --filter @forge/agentic build
```
