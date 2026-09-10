---
title: "Restore Watch analytics after consent regression"
type: fix
status: completed
date: "2026-09-10"
---

## Scope and decision

Address feat-476 by reverting only the analytics gates introduced in #1976.
Both `GoogleAnalytics` and `DatadogRum` must initialize from their existing
environment configuration when the Watch layout mounts them without props.
Recommendation consent remains owned by `RecommendationConsentShell`.

## Implementation and verification

1. Update `apps/web/src/components/__tests__/GoogleAnalytics.test.tsx` and
   `DatadogRum.test.tsx` to reproduce configured no-prop initialization failures.
2. Remove the unused consent props and gates from the two implementation files,
   restoring their pre-#1976 behavior. Preserve the missing-configuration guards,
   GA route tracking and `afterInteractive` strategy, and RUM initialization latch.
3. Cover mounting both integrations in
   `apps/web/src/app/[locale]/[htmlLang]/layout.test.tsx`. Verify GA navigation
   and custom events, RUM single initialization, and missing configuration.
4. Run the focused suites, adjacent Watch/recommendation tests, Web typecheck,
   lint, formatting, and local browser/resource timing checks. Record what local
   verification proves; production receipt requires merge and deployment.
5. Review the complete diff, document the shared-component caller coverage gap,
   complete the ticket, and open a focused PR from `origin/main`.
