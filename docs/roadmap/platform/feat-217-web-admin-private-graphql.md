---
id: feat-217
title: Route Web Admin GraphQL over Railway private networking
status: in-progress
lane: platform
depends_on:
  - feat-216
blocks: []
---

## Problem

After moving Admin Postgres into the same Railway region as Admin, the direct
Watch snapshot probe improved to roughly 1s median, but production Web still
uses `https://admin.jesusfilm.org/api/graphql` for server-side Admin GraphQL
calls. That keeps public DNS, Cloudflare, TLS, and public routing in the
critical path for every uncached Watch render.

## Scope

- Allow `.railway.internal` Admin GraphQL hosts in Web env validation.
- Configure production `@forge/web` `ADMIN_GRAPHQL_URL` to the Admin private
  endpoint.
- Redeploy Web and re-measure Watch single-video uncached and user-visible
  latency.

## Verification

1. `pnpm --filter @forge/web test -- env`
2. Production `@forge/web` deploy succeeds with
   `ADMIN_GRAPHQL_URL=http://forgeadmin.railway.internal:8080/api/graphql`.
3. Re-run Watch single-video page and Admin snapshot latency probes.
