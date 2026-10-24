---
id: "feat-347"
title: "Reuse Mastra OpenRouter access for SEO"
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
  - "openrouter"
  - "grounded-search"
  - "security"
---

## Problem

Production Mastra already has paid-first OpenRouter credentials, but the SEO
agent and grounded-search client are wired to direct OpenAI credentials. This
leaves model interpretation and grounded search unavailable unless operators
provision a redundant provider secret. SEO should reuse Mastra's existing
OpenRouter access and keep direct OpenAI credentials only as an explicit
compatibility fallback.

## Entry Points — Read These First

1. `apps/mastra/src/config/seo.ts` — SEO provider configuration and capability reporting.
2. `apps/mastra/src/mastra/agents/seo-marketing-agent.ts` — reusable SEO agent model binding.
3. `apps/mastra/src/services/grounded-search-client.ts` — bounded Responses API web-search client.
4. `apps/mastra/src/config/env.ts` — paid-first OpenRouter credential precedence.

## Grep These

- `SEO_OPENAI_API_KEY`
- `OPENROUTER_API_PAID_KEY`
- `openai/gpt-5.4-mini`
- `openrouter:web_search`
- `searchGroundedWeb`

## What To Build

1. Prefer `OPENROUTER_API_PAID_KEY`, then `OPENROUTER_API_KEY`, for SEO model interpretation and grounded search.
2. Bind the reusable SEO agent to OpenRouter's OpenAI-compatible chat endpoint without exposing credentials to tools or workflow state.
3. Route grounded search through OpenRouter's Responses API and bounded `openrouter:web_search` server tool while retaining the direct OpenAI path as an explicit fallback.
4. Preserve provider-independent observation semantics and fail-closed, optional-provider behavior.
5. Document and test credential precedence, endpoint/model selection, request bounds, and capability reporting.

## Constraints

- Never log, persist, or return provider credentials.
- Keep grounded output observational; GSC remains ranking authority.
- Cap searches, results, response bytes, retries, and output tokens.
- Missing provider configuration must not block Mastra startup or the deterministic SEO dry run.
- Keep production automation in `dry_run` until provider coverage is verified.

## Verification

- Focused SEO config, grounded-search, agent, and workflow tests pass.
- `pnpm --filter @forge/mastra test`, `typecheck`, and `lint` pass.
- Production reports GSC, GA4, Firecrawl, and grounded-search coverage while persisting zero proposals, drafts, tickets, approvals, or content changes.
