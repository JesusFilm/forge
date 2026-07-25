---
id: "feat-197"
title: "Watch search query and outcome logging"
owner: "nisal"
priority: "P2"
status: "complete"
start_date: "2026-06-22"
duration: 5
depends_on: []
blocks: []
tags:
  - "web"
  - "watch"
  - "search"
  - "observability"
  - "analytics"
  - "datadog"
  - "watch-events"
---

## Problem

Algolia gives the team visibility into what people search for, which searches
fail, and which results get clicked. The replacement Watch search needs similar
anonymous analytics in Datadog so the team can answer product questions such as
top searches, no-result searches, clicked results, search language mismatch,
and search-mode health.

This ticket is about anonymous Watch search observability, similar to Watch
events. It must log every Watch search request that reaches the server-side
search path, so Datadog RUM sampling cannot be the canonical source of search
counts. RUM may still add browser-side UX context and result-click signals, but
the authoritative search-submission/outcome record belongs on the server side.
Server-side Datadog delivery must be asynchronous, non-blocking, best-effort,
and fire-and-forget so search responses never wait on Datadog.
It is not blocked by Mastra eval trace work. Anonymous means no name, email,
full user identifier, auth token, cookie, session id, or IP address is stored
with the search event. Anonymous search analytics should not be deleted from
the database solely because they are older than 30 days.

The search analytics shape should also be future-compatible with Watch event
collection. If Watch events later expose an anonymous analytics context, search
analytics events and supplemental RUM events should be able to consume that
context and pass it through to Datadog without changing the search event
contract. This ticket should not build the Watch event storage/API itself.

Roadmap window: next week, June 22-26, 2026.

## Entry Points - Read These First

1. `docs/roadmap/platform/feat-182-web-watch-datadog-rum.md`
   - completed Watch Datadog RUM foundation.
2. `docs/brainstorms/2026-07-01-watch-search-analytics-requirements.md`
   - requirements and scope decisions for this ticket.
3. `apps/web/src/components/DatadogRum.tsx`
   - Datadog RUM initialization and reporting helper.
4. `apps/web/src/components/FloatingSearchController.tsx`
   - Watch search execution, no-result state, pagination, and result source.
5. `apps/web/src/lib/search-actions.ts`
   - server-side Watch search action wrapper; canonical place to log every
     search request that reaches the app.
6. `apps/web/src/lib/search.ts`
   - Admin semantic search client response shape, mode, result count, and
     latency source.
7. `apps/web/src/lib/search-language-actions.ts`
   - active site/search language resolution.
8. `apps/admin/src/services/hybrid-search.service.ts`
   - server-side search mode and result metadata if server correlation is
     needed later.
9. `docs/roadmap/content-discovery/feat-090-watch-event-collection.md`
   - historical Watch event collection concept; use only for analytics context
     vocabulary, not as a dependency or CMS implementation pattern.

## What To Build

1. Emit a server-side Datadog-backed anonymous Watch search analytics event for
   every search request and load-more request that reaches the Watch search
   server action, including completed, failed, and no-result outcomes.
   Delivery must be asynchronous, non-blocking, best-effort, and
   fire-and-forget.
2. Treat the server-side event as the canonical source for top-search,
   no-result, failed-search, latency, and result-count analytics. RUM events can
   mirror browser-side submitted/clicked behavior, but they must not be the only
   source for search counts.
3. Include a stable anonymous search event/request id so server-side search
   events and optional RUM/click events can be correlated without user identity.
4. Include exact submitted query text, detected query language where available,
   active site language, selected search language, result source, search mode,
   result count, no-result status, latency, and load-more context where useful.
5. Include clicked result metadata where available: result id, slug, type,
   position, title, and active query context.
6. Keep events anonymous by excluding name, email, full user identifiers, auth
   tokens, cookies, session ids, IP addresses, and bearer/key material.
7. Provide a Datadog review path for common searches, no-result searches,
   failed searches, and clicked outcomes. If Datadog MCP is available, document
   the MCP query/report path; otherwise document the Datadog dashboard/log query
   to use.
8. Keep this product analytics path separate from Mastra eval sampling. Logged
   search trends can inform future eval query ideas, but eval generation is not
   the acceptance driver for this ticket.
9. Define the search analytics emitter so it can accept an optional sanitized
   Watch analytics context when Watch events exist. This context can carry
   anonymous page/video/playback/language/referrer fields into search analytics
   and RUM events, but the emitter must no-op on that context when no Watch
   event provider is present.

## Acceptance Criteria

- Datadog receives one canonical anonymous server-side outcome event for every
  Watch search request that reaches the server action, including completed,
  failed, and no-result outcomes.
- Datadog receives canonical server-side events for load-more requests that
  reach the server action.
- Top-search, no-result, failed-search, latency, and result-count analytics do
  not depend on Datadog RUM sampling.
- Server-side Datadog delivery does not delay search results, does not wait for
  a Datadog response, and does not surface Datadog delivery failures to viewers.
- Datadog receives clicked-result events with query context and result
  position/identity where available.
- Events include exact submitted query text, detected query language where
  available, active site language, selected search language, result source,
  search mode, result count, no-result status, latency, and load-more context
  where useful.
- Events do not include name, email, full user identifiers, auth tokens,
  cookies, session ids, IP addresses, or bearer/key material.
- The team has a Datadog review path for top searches, no-result searches,
  failed searches, and clicked outcomes.
- Anonymous search analytics are not subject to a 30-day database deletion
  requirement solely because they are anonymous search records.
- The search analytics path has an optional Watch-event-context hook that can
  pass sanitized anonymous Watch event context into RUM without making Watch
  event collection a dependency of this ticket.

## Verification

- Server-side Datadog event writes are asynchronous, non-blocking,
  best-effort, and fire-and-forget; they do not block or break live search
  responses.
- Tests or payload fixtures prove success, no-result, failed-search, and
  load-more paths emit canonical server-side events.
- Verification proves search outcome logging still works when browser RUM is
  unavailable or sampled out.
- No-result, failed-search, and clicked-result cases are visible in the
  Datadog review path.
- Event payload inspection confirms no name, email, full user identifiers, auth
  tokens, cookies, session ids, IP addresses, or bearer/key material are sent.
- Tests or payload fixtures cover both cases: Watch event context absent, and
  sanitized Watch event context present and included in the RUM event payload.

## Implementation Notes

- Implemented canonical server-side `forge-web` Datadog structured logs through
  `apps/web/src/lib/watch-search-analytics.ts` and the direct structured sender
  in `apps/web/src/observability/datadog-logs.ts`.
- Watch `runSearch` callers pass explicit `surface=watch-search` analytics
  context, so shared non-Watch search callers do not pollute Watch counts.
- Result-click RUM actions use `watch_search.result_clicked` and carry
  bounded result metadata plus `searchRequestId`; exact query text remains in
  the canonical server log attribute `watch_search.query`.
- Exact query text can be disabled without stopping outcome analytics by
  setting `WATCH_SEARCH_ANALYTICS_INCLUDE_QUERY_TEXT=false`.
- Datadog review and production smoke steps live in
  `docs/operations/watch-search-analytics-datadog.md`.
- Verified with:
  `pnpm --filter @forge/web exec vitest run src/instrumentation.test.ts src/observability/datadog-logs.test.ts src/lib/watch-search-analytics.test.ts src/lib/search-actions.test.ts src/lib/algolia-search.test.ts src/components/__tests__/DatadogRum.test.tsx src/components/__tests__/FloatingSearchProvider.test.tsx src/components/search/VideoCard.test.tsx`,
  `pnpm --filter @forge/web typecheck`, and
  `pnpm --filter @forge/web lint`.
