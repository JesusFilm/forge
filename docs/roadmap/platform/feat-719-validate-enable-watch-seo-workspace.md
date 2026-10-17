---
id: "feat-719"
title: "Validate and enable the Watch SEO workspace"
owner: "unassigned"
priority: "P1"
status: "planned"
depends_on:
  - "feat-718"
blocks: []
tags:
  - "platform"
  - "watch"
  - "admin"
  - "seo"
  - "performance"
---

## Problem

The Watch SEO workspace is implemented and locally verified, but production
enablement needs evidence that cannot be established from the development
worktree: production-shaped PostgreSQL plans, canonical-URL normalization
against retained crawler records, and before/after Watch loading measurements.

## Scope

1. Configure disjoint `WATCH_SEO_API_KEYS` in Admin and Web without widening
   existing consumer or Web Admin credentials.
2. Deploy Admin first. Have existing Admins whose database user id differs from
   their authentication subject sign in once to establish the durable binding;
   confirm conflicts fail closed before deploying Web.
3. Run `EXPLAIN (ANALYZE, BUFFERS)` for the retained GSC and crawler queries on
   production-shaped data. Smoke-test exact canonical-URL normalization before
   changing JSON predicates or adding an expression index.
4. Compare anonymous Watch before/after JS and RSC bytes, requests, LCP, player
   readiness, and CLS at desktop and mobile widths. Confirm the workspace chunk
   and evidence request remain absent until an authorized Admin selects the tab.
5. Verify the capability, evidence, and Admin confirmation paths in the target
   environment, including downgrade/revocation, 429 retry behavior, stale
   proposal conflicts, Apply draft/ticket creation, and Decline rejection.

## Exit Criteria

- Database plans are bounded and use the intended status/date index, or a
  reviewed follow-up change is created with captured plan evidence.
- Anonymous Watch loading has no material regression and the private panel
  causes no unacceptable layout shift when mounted.
- Admin-to-Web rollout order, subject binding, service-key separation, and
  rollback steps are documented and exercised.
- The workspace is enabled only after the above evidence is attached.
