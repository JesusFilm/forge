---
title: "fix: Give Web semantic search a bounded Admin timeout"
type: "fix"
date: "2026-06-12"
---

# fix: Give Web semantic search a bounded Admin timeout

## Summary

Web semantic search should use a longer bounded Admin GraphQL timeout while other Web Admin GraphQL callers keep the existing 15 second budget.

## Problem Frame

Production semantic search normally returns in several seconds but can brush past the current global 15 second `AbortSignal.timeout` in `apps/web/src/lib/admin-client.ts`. The mitigation must keep the timeout finite, avoid search-quality or retriever changes, and leave the Algolia rollout path alone.

## Requirements

- R1. Semantic search requests from `searchVideos` use a longer bounded Admin GraphQL timeout, targeted at 45 seconds.
- R2. Non-search Admin GraphQL callers keep the existing 15 second timeout.
- R3. Server-only Admin GraphQL configuration remains behind the server data layer and is not exposed through client code or public environment variables.
- R4. Algolia behavior, Admin ranking, and Admin retriever SQL stay unchanged.
- R5. Tests prove the timeout budget selected by the default Admin client and the semantic-search Admin client.

## Key Technical Decisions

- KTD1. Add a second lazy Admin client rather than lengthening the singleton timeout: this keeps the mitigation limited to the semantic search adapter and avoids changing every Admin GraphQL request in Web.
- KTD2. Keep both clients in `apps/web/src/lib/admin-client.ts`: bearer parsing, endpoint configuration, cache construction, and lazy env access stay centralized.
- KTD3. Use a 45 second search budget: it gives production semantic search headroom above the current 15 second ceiling while remaining bounded.

## Implementation Units

### U1. Add a search-specific Admin client

- **Goal:** Refactor `apps/web/src/lib/admin-client.ts` so it can create lazy Admin clients with distinct timeout budgets.
- **Requirements:** R1, R2, R3.
- **Dependencies:** None.
- **Files:** `apps/web/src/lib/admin-client.ts`, `apps/web/src/lib/admin-client.test.ts`.
- **Approach:** Extract timeout-fetch and lazy-client construction helpers, keep the default export on the 15 second budget, and export a named semantic-search client on the 45 second budget.
- **Patterns to follow:** Existing lazy singleton comment in `apps/web/src/lib/admin-client.ts`; outbound timeout guidance in `docs/solutions/best-practices/outbound-timeout-shorter-than-caller-budget-20260506.md`.
- **Test scenarios:** Query through the default export and assert `AbortSignal.timeout` receives 15000; query through the semantic-search client and assert `AbortSignal.timeout` receives 45000; bearer parsing still uses the first trimmed CSV key.
- **Verification:** Tests show both client entry points remain bounded and select different budgets.

### U2. Route semantic search through the search client

- **Goal:** Make `searchVideos` use the longer bounded Admin client without touching Algolia dispatch or search result normalization.
- **Requirements:** R1, R4.
- **Dependencies:** U1.
- **Files:** `apps/web/src/lib/search.ts`, `apps/web/src/lib/search.test.ts`, `apps/web/src/lib/search-actions.test.ts`.
- **Approach:** Replace the generic Admin client import in `search.ts` with the semantic-search Admin client and leave `runSearch` dispatch rules unchanged.
- **Patterns to follow:** `apps/web/src/lib/search-actions.ts` remains the server-action fork between semantic and Algolia search.
- **Test scenarios:** Existing `runSearch` tests keep proving flag-off and type-filtered paths call `searchVideos`; `search.test.ts` proves `searchVideos` uses the search-specific Admin client; admin-client tests prove that client uses the longer timeout.
- **Verification:** Search-action tests remain green and no Algolia adapter tests need behavior changes.

## Scope Boundaries

- Do not edit generated GraphQL files.
- Do not change Admin semantic ranking, retrieval SQL, or embedding behavior.
- Do not change Algolia request behavior, flags, result transforms, or UI controls.
- Do not remove timeouts or make Admin GraphQL fetches unbounded.

## Risks & Dependencies

- A longer server-side search request can occupy a Web worker longer during Admin slowness; keeping the budget search-specific limits the blast radius.
- Admin performance work remains the durable fix. This plan only prevents Web from aborting expected slow semantic-search requests too early.

## Sources & Research

- `apps/web/src/lib/admin-client.ts` owns the current 15 second Admin GraphQL fetch timeout and lazy server-only env access.
- `apps/web/src/lib/search.ts` is the semantic search adapter used by `apps/web/src/lib/search-actions.ts`.
- `docs/solutions/architecture-patterns/forge-algolia-search-modal-20260610.md` keeps the Algolia rollout split in the server action and preserves semantic search as the fallback path.
- `docs/solutions/platform/admin-hybrid-search-r4-pattern.md` and `docs/solutions/architecture-patterns/admin-semantic-video-transcript-evidence-pattern.md` confirm this mitigation should not alter Admin retrieval topology.
