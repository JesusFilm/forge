---
id: "feat-700"
title: "Prevent transient Watch render failures from becoming cached HTML"
owner: "vlad"
priority: "P1"
status: "not-started"
start_date: "2026-10-14"
duration: 3
depends_on:
  - "feat-699"
blocks: []
tags:
  - "web"
  - "watch"
  - "caching"
  - "reliability"
---

Plan only. The owner authorized this planned follow-up ticket alongside the lookup repair in PR #2641. Renderer implementation and a separate follow-up PR remain unapproved. FGE-172 stays open until the acceptance boundary is resolved.

Problem proven with actual Next 16.3.8 production-mode fixture: force-static ISR treats returned error JSX as successful 200 HTML and caches it. The corrected Data Cache resolver can retry, but a cached HTML error prevents the renderer from running until regeneration. Keep issue open until the whole acceptance boundary is agreed/verified.

## Runtime paths and current behavior

1. `apps/web/src/app/[locale]/[htmlLang]/page.tsx:96`: home heroResult.error returns inline ExperienceError wrapped with Watch chrome and NextIntl messages. Builder-authored pageResult failure is separately optional/degraded content with a development log; do not convert that branch indiscriminately into a total outage.
2. `apps/web/src/app/[locale]/[htmlLang]/[...rest]/page.tsx:757`: language home hero failure returns inline ExperienceError. A missing builder homepage currently redirects to the public language videos index after tryAsLocaleSlug classification; preserve that exact redirect.
3. Same catch-all `:818`: curated one-segment Experience error first classifies isWatchPageMissingError. Intentional missing non-language page goes through notFound(); the isLanguageHome branch keeps ExperienceEmpty if reachable. Only real remaining error currently returns ExperienceError.
4. Same catch-all `:1279`: final Experience fallback first calls notFound() on intentional missing; real failure returns ExperienceError.
5. Inventory `generateMetadata` and other catch-all catches separately before editing: metadata fallback, missing manifest/content and playable-variant eligibility outcomes must not be reclassified as transient server errors. Full video route resolvers already generally throw; preserve player and admission contracts.

`apps/web/src/components/ExperienceError.tsx` currently translates known messages and otherwise shows a localized generic unexpected error in a red paragraph; no retry control. `apps/web/src/app/[locale]/[htmlLang]/error.tsx` existing client boundary instead renders generic page-load failure, a localized Try again button calling reset(), and reports Datadog RUM errors. Throwing changes the failure UI to that generic retry boundary, not the raw resolver message; cold failure response can be 500, and regeneration failure should preserve the last successful page. Verify that the correct nested boundary has translation context and that reset can recover. Preserve required analytics.

## Proposed decision and implementation shape

Prefer allowing proven transient upstream failure to throw from the renderer after deterministic missing classification, rather than switching all pages to force-dynamic or disabling caching. Keep `{data:null,error}` resolver compatibility where callers rely on it; change only render failure branch semantics after source inventory. Throw an actual Error rather than an opaque plain object if the resolver error type needs conversion. Do not expose upstream secrets in client error text. Generic boundary/redacted production digest is acceptable but verify observability preserves actionable server detail.

Tradeoff: cold visitors see a retry UI and a genuine failed render instead of a normally cached error page; previously successful ISR pages should survive a failed background regeneration. The exact Next/Redis production handler behavior must be tested, not inferred solely from a mock. Deterministic missing content stays normal notFound/redirect/empty as already designed. Optional builder degradation and accepted sparse/empty recommendation coverage remain distinct from server errors under October 2 policy. No blanket cache-busting.

## Required checks

- Actual render-path unit coverage in `page.test.tsx` and catch-all `__tests__/page-routing.test.tsx`: home hero transient failure, language home failure, curated Experience transient failure, final fallback failure, preserved intentional missing 404/redirect/empty, healthy rendering, optional-body behavior, metadata compatibility.
- Actual production-mode Next app with local fake Admin: cold transient failure then recovery, correct retry UI/reset, successful HTML remains cached, failing stale revalidation preserves known-good HTML and data, later recovery updates it. Include default filesystem and matched custom cache handler/isolated Redis if available without production mutation.
- Native T3 browser: initial failure UI, keyboard-accessible translated retry control, recovered home/curated content and playable video controls. Healthy canonical live baseline only; never induce Admin faults in production.
- Cache/header evidence: cold failure is not persisted as successful HTML; healthy HIT/TTL/invalidation tags remain, deterministic missing stays expected 404/private headers, no blanket no-store/dynamic introduced.
- Alternating healthy baseline/fixed page-loading samples with equivalent fake content and warmed/cold states; compare response start, DOM ready/player readiness, upstream calls and payload. Verify cache preservation and no increased healthy upstream load; no synthetic endpoint timing treated as full-page speed.
- Web touched/full relevant tests, typecheck, lint, format, roadmap generation and required normal hooks; fresh CI and preview after publication. Normal PR-to-main deployment only and background production check without forced faults.

Evidence: /tmp/watch-fge-172-real-next-full-route-cache.json and /tmp/watch-fge-172-next-review-report.md. Follow-up plan does not authorize cache purge, production configuration changes or manual deploy.
