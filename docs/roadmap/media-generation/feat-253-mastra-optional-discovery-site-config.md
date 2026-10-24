---
id: "feat-253"
title: "Keep Mastra website discovery configuration optional"
owner: "vlad"
priority: "P0"
status: "complete"
start_date: "2026-07-14"
duration: 1
depends_on:
  - "feat-240"
blocks: []
tags:
  - "mastra"
  - "instagram"
  - "ai-pipeline"
  - "infrastructure"
---

## Problem

Mastra production startup currently rejects missing or partial website
discovery integration settings. That optional integration can therefore take
down the entire runtime and Studio even though discovery submissions are
best-effort and the original contract says the website settings must not be
required at boot.

## Entry Points - Read These First

1. `apps/mastra/src/config/env.ts` - production boot assertions and optional
   website discovery config accessors.
2. `apps/mastra/src/config/env.test.ts` - production startup regression
   coverage.
3. `apps/mastra/src/services/discovery/secure-url.ts` - request-time HTTPS
   protection used before website bearer tokens are sent.
4. `apps/mastra/CLAUDE.md` - operator documentation for the optional website
   integration.

## Grep These

- `assertDiscoveryEndpointsConfiguredForProduction`
- `DISCOVERY_SITE_ALLOWED_HOSTS`
- `INSTAGRAM_DISCOVERY_SITE_INGEST_URL`
- `getDiscoverySiteIngestConfig`
- `getDiscoverySourcesConfig`

## What To Build

- [x] Remove website discovery settings from Mastra's production boot
      assertions.
- [x] Treat incomplete URL/token pairs as a disabled integration through the
      existing nullable config accessors.
- [x] Remove the redundant discovery-site host allowlist setting while keeping
      request-time HTTPS validation and redirect rejection.
- [x] Add a regression test proving production Mastra starts without complete
      website discovery configuration.
- [x] Update operator documentation and the example environment file.

## Constraints

- Do not make website discovery availability a prerequisite for Mastra,
  Studio, or unrelated workflows.
- Do not send a website bearer token to a non-HTTPS URL or across a redirect.
- Do not change the Firecrawl, YouTube, AI Gateway, RAG, or core production
  startup requirements.
- Do not deploy directly to Railway; ship through the normal PR-to-main flow.

## Verification

- `pnpm --filter @forge/mastra test -- src/config/env.test.ts src/services/discovery/site-ingest-client.test.ts src/services/discovery/sources-client.test.ts src/services/instagram-discovery/site-ingest-client.test.ts`
- `pnpm --filter @forge/mastra typecheck`
- `pnpm --filter @forge/mastra lint`
- Confirm the production startup regression test covers absent and partial
  website discovery configuration without weakening request-time HTTPS tests.

## Completion Notes

- Removed website discovery URL/token grouping and host-allowlist assertions
  from production startup, and removed `DISCOVERY_SITE_ALLOWED_HOSTS`.
- Kept incomplete URL/token pairs inert and moved URL syntax/HTTPS enforcement
  fully to the outbound clients so malformed optional values cannot block
  Mastra or Studio startup.
- Preserved `redirect: "error"` and added regression coverage proving malformed
  URLs are rejected before fetch or bearer transmission.
- Validation passed: 90 focused assertions, full Mastra suite (1,033 tests),
  typecheck, and lint.
