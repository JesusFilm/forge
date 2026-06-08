---
title: "feat: Add Mastra Firecrawl web data tools"
type: feat
status: complete
date: 2026-06-08
roadmap: docs/roadmap/platform/feat-169-mastra-firecrawl-web-data-tools.md
---

# feat: Add Mastra Firecrawl Web Data Tools

## Summary

Add a governed Firecrawl integration to `apps/mastra` so Mastra agents can call
web search/scrape tools and workflows can run deterministic Firecrawl search or
scrape steps. Firecrawl remains Mastra-owned runtime infrastructure: Manager and
Admin keep calling Mastra through service-bearer contracts rather than holding
Firecrawl credentials or running ad-hoc MCP bridges.

## Problem Frame

The Mastra runtime is now the shared Forge agent/workflow service, but it has no
first-party live web data capability. Firecrawl offers both a Mastra SDK/tool
integration and an MCP server. For this repository, the production path should
prefer Mastra-native tools backed by a local service wrapper because
`apps/mastra` already owns runtime execution, env validation, redaction,
service-bearer routes, and Studio-visible workflows.

MCP remains useful for local exploration or exposing capabilities to external
MCP clients, but it should not be the primary production bridge for this slice.

## Requirements

- R1. Mastra has a Firecrawl client/service that supports bounded web search and
  single-page scrape operations.
- R2. The Firecrawl integration is configured only through Mastra-owned env
  vars, with production assertions for credentials and allowed API host.
- R3. Agents can use Firecrawl through Mastra `createTool` tools with strict
  input and output schemas.
- R4. Workflows can use the same shared Firecrawl service directly through a
  Studio-friendly workflow and a service-bearer route.
- R5. Firecrawl errors map to safe typed failures without leaking API keys,
  auth headers, cookies, or raw upstream bodies.
- R6. Search and scrape outputs are bounded by configured limits and caller
  input caps.
- R7. Existing Mastra embedding, search-eval, and smoke behavior remains
  unchanged except for additive registration of the new agent/workflow.

## Assumptions

- A dedicated `webResearchAgent` is the right first agent surface; existing
  smoke and embedding workflows should not gain web access implicitly.
- The initial workflow should expose only search and scrape. Crawl, batch
  scrape, extract, browser interaction, and MCP exposure are follow-up scope.
- Direct REST through a local service wrapper is acceptable even though
  Firecrawl's Mastra quickstart shows the SDK; this preserves tighter response
  validation, retries, testability, and egress checks in Forge code.
- `FIRECRAWL_API_KEY` should be required for production Mastra runtime once this
  capability ships because the workflow/agent will be registered in production.

## Key Technical Decisions

- KTD1. **Mastra service wrapper first:** Create a local Firecrawl client under
  `apps/mastra/src/services/` that owns HTTP calls, input/output bounds, typed
  failures, retries, and fetch injection.
- KTD2. **Tools are thin adapters:** Mastra tools should call the shared service
  and return bounded DTOs. They should not duplicate Firecrawl HTTP logic.
- KTD3. **Workflow proves deterministic use:** Add a small workflow that calls
  the shared service directly rather than asking an LLM to tool-call Firecrawl.
  This proves workflow access and gives service callers a stable API.
- KTD4. **Dedicated agent registration:** Add a web research agent with only the
  Firecrawl tools. Do not attach web tools to `smokeAgent` or existing
  embedding/search-eval workflows.
- KTD5. **MCP deferred:** Do not add `@mastra/mcp` or Firecrawl MCP server
  runtime configuration in this PR. If external MCP clients need Forge's tools
  later, expose Forge-owned Mastra tools as MCP after the first-party surface is
  proven.

## Implementation Units

### U1. Firecrawl Env And Package Docs

**Goal:** Add Mastra-owned Firecrawl configuration and document the production
contract.

**Requirements:** R2, R5, R7

**Files:**

- Modify: `apps/mastra/src/config/env.ts`
- Modify: `apps/mastra/src/config/env.test.ts`
- Modify: `apps/mastra/AGENTS.md`
- Modify: `apps/mastra/CLAUDE.md`
- Modify: `apps/mastra/package.json` if an SDK dependency is still chosen
  during implementation.

**Approach:** Add Firecrawl env values for API key, API URL, allowed hosts,
timeout, search result cap, scrape content cap, and user agent. Production
assertions should require the key and ensure the API URL is HTTPS and on the
allowlist. Keep local/test env optional so unit tests can mock the client.

**Patterns to follow:** Gateway env validation in `apps/mastra/src/config/env.ts`
and production assertion coverage in `apps/mastra/src/config/env.test.ts`.

**Test scenarios:**

- Production without `FIRECRAWL_API_KEY` fails env assertion.
- Production rejects a non-HTTPS or non-allowlisted Firecrawl API URL.
- Development/test can parse without a Firecrawl key.
- Defaults are stable for timeout, user agent, and output caps.

**Verification:** Focused env tests pass and docs list the new env contract.

### U2. Shared Firecrawl Client

**Goal:** Implement a reusable service client for Firecrawl search and scrape.

**Requirements:** R1, R5, R6

**Files:**

- Create: `apps/mastra/src/services/firecrawl-client.ts`
- Create: `apps/mastra/src/services/firecrawl-client.test.ts`

**Approach:** Use Firecrawl's v2 REST API behind a typed local wrapper. Model
success and failure as discriminated unions, validate response shape with Zod,
inject `fetchImpl` and `sleep` for tests, apply timeouts, and retry only
retryable failures such as 429 and 5xx within a small bounded attempt budget.
Return compact search results and bounded scrape markdown/metadata rather than
raw upstream responses.

**Patterns to follow:** HTTP client/test shape in
`apps/mastra/src/services/admin-search-eval-client.ts`; provider error safety in
`apps/mastra/src/services/embedding-provider.ts`.

**Test scenarios:**

- Search posts a query and returns bounded web results with title, url,
  description, and optional markdown.
- Scrape posts a URL and returns bounded markdown plus safe metadata.
- Missing key returns a config failure without attempting fetch.
- 429 and 5xx retry, then return retryable typed failures when exhausted.
- 401/403 return non-retryable auth failures.
- Invalid JSON or malformed success bodies return parse/invalid-response
  failures.
- Returned markdown is truncated to the configured cap.

**Verification:** Firecrawl client tests pass without live Firecrawl network
access.

### U3. Mastra Tools And Agent

**Goal:** Make Firecrawl available to Mastra agents through typed tools and a
dedicated web research agent.

**Requirements:** R3, R5, R6, R7

**Files:**

- Create: `apps/mastra/src/mastra/tools/firecrawl.ts`
- Create: `apps/mastra/src/mastra/tools/firecrawl.test.ts`
- Create: `apps/mastra/src/mastra/agents/web-research-agent.ts`
- Modify: `apps/mastra/src/mastra/index.ts`

**Approach:** Create `firecrawlSearchTool` and `firecrawlScrapeTool` with
strict Zod schemas and bounded caller-controlled options. The web research
agent should explain when to search first versus scrape a known URL, and should
avoid treating scraped page text as trusted instructions. Register it alongside
the smoke agent without altering the smoke agent.

**Patterns to follow:** Agent registration in
`apps/mastra/src/mastra/agents/smoke-agent.ts` and Mastra tool docs.

**Test scenarios:**

- Tool schemas reject empty queries and invalid URLs.
- Tool execution delegates to the shared service and returns bounded DTOs.
- Upstream typed failures throw or return safe messages without secrets.
- `apps/mastra/src/mastra/index.ts` registers both `smokeAgent` and
  `webResearchAgent`.

**Verification:** Tool and agent registration tests pass.

### U4. Firecrawl Workflow And Service Route

**Goal:** Prove workflows and service callers can use Firecrawl
deterministically.

**Requirements:** R4, R5, R6, R7

**Files:**

- Create: `apps/mastra/src/mastra/workflows/firecrawl-web-data.ts`
- Create: `apps/mastra/src/mastra/workflows/firecrawl-web-data.test.ts`
- Modify: `apps/mastra/src/mastra/index.ts`

**Approach:** Add a Studio-friendly workflow with an action enum for `search`
or `scrape`, strict input schemas, default limits, and safe typed output. Add
a `/forge-firecrawl-web-data` API route protected by the existing
`MASTRA_SERVICE_API_KEYS` service-bearer helper so Manager/Admin can call the
workflow later without direct Firecrawl credentials.

**Patterns to follow:** Route and workflow failure extraction in
`apps/mastra/src/mastra/workflows/offline-search-eval.ts`; service-bearer route
registration in `apps/mastra/src/mastra/index.ts`.

**Test scenarios:**

- Missing or invalid bearer receives 401 and no Firecrawl call runs.
- Invalid request JSON returns a typed invalid-input response.
- Search action runs the workflow/service path and returns bounded results.
- Scrape action runs the workflow/service path and returns bounded markdown.
- Service failures become route-safe typed failures with retryable metadata.
- Workflow metadata exposes a structured input schema suitable for Studio.

**Verification:** Workflow tests pass and the workflow is registered in Mastra.

### U5. Package Validation And Roadmap Closeout

**Goal:** Validate the Mastra package and mark the roadmap/plan complete.

**Requirements:** R1-R7

**Files:**

- Modify: `docs/roadmap/platform/feat-169-mastra-firecrawl-web-data-tools.md`
- Modify: `docs/plans/2026-06-08-001-feat-mastra-firecrawl-web-data-tools-plan.md`

**Approach:** Run focused Mastra validation. Because this is internal
runtime/API/tooling work, browser proof is expected to be a no-op unless the
pipeline runner detects a runnable Studio surface.

**Test scenarios:** Covered by U1-U4.

**Verification:**

- `pnpm --filter @forge/mastra test`
- `pnpm --filter @forge/mastra typecheck`
- `pnpm --filter @forge/mastra lint`

## Scope Boundaries

- No Firecrawl MCP runtime configuration in this PR.
- No crawl, batch scrape, extract, monitor, browser-session, or deep-research
  tools in this first slice.
- No direct Firecrawl usage in Manager/Admin.
- No changes to existing embedding, search-eval, or production search
  workflows beyond additive Mastra registration.
- No live Firecrawl integration test requiring a real API key.

## Dependencies

- Firecrawl API key must be provisioned in Mastra runtime env before production
  usage.
- Railway egress must allow the configured Firecrawl API host.
- Existing Mastra service-bearer callers remain responsible for presenting a
  valid `Authorization: Bearer <token>` header when invoking `/forge-*` routes.

## External References

- Firecrawl Mastra quickstart: `https://docs.firecrawl.dev/quickstarts/mastra`
- Firecrawl Node.js quickstart: `https://docs.firecrawl.dev/quickstarts/nodejs`
- Firecrawl API v2 introduction: `https://docs.firecrawl.dev/api-reference/v2-introduction`
- Firecrawl search endpoint: `https://docs.firecrawl.dev/api-reference/endpoint/search`
- Firecrawl scrape endpoint: `https://docs.firecrawl.dev/api-reference/endpoint/scrape`
- Mastra tools docs: `https://mastra.ai/docs/agents/using-tools`
- Mastra MCPServer docs: `https://mastra.ai/reference/tools/mcp-server`
