---
id: "feat-169"
title: "Mastra Firecrawl web data tools"
owner: "vlad"
priority: "P1"
status: "complete"
start_date: "2026-06-08"
duration: 2
depends_on:
  - "feat-129"
blocks: []
tags:
  - "platform"
  - "mastra"
  - "agents"
  - "ai-pipeline"
  - "external-api"
---

## Problem

Forge's Mastra runtime can run agents and workflows, but it has no governed way
to search or scrape live web pages. Operators and future Manager-driven
workflows need Firecrawl-backed web data access without putting Firecrawl
credentials in Manager/Admin, bypassing Mastra's service-bearer boundary, or
depending on an ad-hoc MCP bridge for production behavior.

## Entry Points - Read These First

1. `apps/mastra/AGENTS.md` - Mastra ownership boundaries and validation commands.
2. `apps/mastra/src/mastra/index.ts` - registered agents, workflows, and
   service-bearer API routes.
3. `apps/mastra/src/config/env.ts` - Mastra runtime env parsing and production
   assertions.
4. `apps/mastra/src/services/admin-search-eval-client.ts` - local HTTP client
   pattern for typed failures, retries, and injectable fetch.
5. `apps/mastra/src/mastra/agents/smoke-agent.ts` - current agent registration
   baseline.
6. `docs/roadmap/platform/feat-129-mastra-railway-workflow-runtime.md` -
   service-bearer and Studio gateway constraints.

## What To Build

1. Add Mastra-owned Firecrawl configuration for API key, optional API URL,
   timeout, result caps, and production egress validation.
2. Add a shared Firecrawl client service with typed search and scrape contracts,
   response validation, safe error mapping, and injectable fetch for tests.
3. Expose Firecrawl search and scrape as Mastra tools that agents can use.
4. Register a dedicated web research agent with those tools, keeping the smoke
   agent isolated.
5. Add a small Studio-friendly workflow and service-bearer route so workflows
   and non-browser callers can exercise deterministic Firecrawl search/scrape.
6. Document env vars and boundaries in the Mastra package guide.

## Constraints

- Do not import from `apps/admin`, `apps/manager`, or `apps/auth`.
- Do not log Firecrawl API keys, raw auth headers, cookies, or unnecessary page
  content.
- Do not make Firecrawl MCP the production runtime dependency for this slice.
- Do not add Firecrawl calls to existing embedding or search-eval workflows in
  this PR.
- Do not expose Firecrawl service routes without Mastra service-bearer checks.
- Keep output bounded so Studio/tool responses cannot return unbounded page
  content.

## Verification

- `pnpm --filter @forge/mastra test`
- `pnpm --filter @forge/mastra typecheck`
- `pnpm --filter @forge/mastra lint`
- Mastra Studio lists the Firecrawl workflow and the web research agent when
  local env enables the runtime.
