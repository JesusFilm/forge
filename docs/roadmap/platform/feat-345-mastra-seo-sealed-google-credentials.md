---
id: "feat-345"
title: "Support sealed Google credentials for Mastra SEO"
owner: "codex"
priority: "P1"
status: "complete"
start_date: "2026-08-10"
duration: 2
depends_on:
  - "feat-344"
blocks: []
tags:
  - "platform"
  - "mastra"
  - "seo"
  - "search-console"
  - "analytics"
  - "railway"
  - "security"
---

## Problem

The SEO Marketing Agent can renew Google access through Application Default
Credentials, but Railway exposes production secrets as sealed environment
variables rather than credential files. A static access token expires and
cannot support the daily schedule. Production needs a validated, renewable
service-account credential path that never logs or persists private material.

## Entry Points — Read These First

1. `apps/mastra/src/config/seo.ts` — optional SEO provider configuration and capability reporting.
2. `apps/mastra/src/services/google-auth-client.ts` — current access-token and ADC authentication paths.
3. `apps/mastra/src/services/google-auth-client.test.ts` — Google token acquisition behavior.
4. `apps/mastra/.env.example` — operator-facing SEO configuration contract.

## Grep These

- `GoogleAuth`
- `SEO_GOOGLE_ACCESS_TOKEN`
- `GOOGLE_APPLICATION_CREDENTIALS`
- `getSeoCapabilities`
- `webmasters.readonly`
- `analytics.readonly`

## What To Build

1. Accept a sealed service-account JSON value through a dedicated `SEO_*`
   variable and parse it only when Google access is requested.
2. Validate the credential type, project identity, client email, and private
   key shape before constructing `GoogleAuth` with the existing read-only
   scopes.
3. Keep the static-token path for short-lived diagnostics and ADC/Workload
   Identity as the preferred ambient path; report the sealed credential as a
   configured renewable Google capability.
4. Add tests for valid credentials, malformed JSON, wrong credential type,
   missing fields, precedence, and sanitized failures that never expose secret
   material.
5. Document receiver-side Railway configuration without committing credential
   files or secret values.

## Constraints

- Never log, serialize into workflow state, or return the private key.
- Keep GSC and GA4 scopes read-only and property access least-privileged.
- Do not write a credential file at runtime or reuse `GOOGLE_APPLICATION_CREDENTIALS`.
- Optional Google configuration must remain non-blocking at process startup.
- Keep production automation `off` until a verified `dry_run` succeeds.

## Verification

- Focused Google auth/config tests cover renewable env credentials and safe errors.
- `pnpm --filter @forge/mastra test`, `typecheck`, and `lint` pass.
- The production Mastra service starts with the sealed credential configured.
- A production dry run reads the exact Search Console and GA4 properties while
  persisting zero proposals, drafts, tickets, approvals, or content changes.
