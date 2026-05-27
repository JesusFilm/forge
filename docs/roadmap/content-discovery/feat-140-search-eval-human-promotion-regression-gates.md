---
id: "feat-140"
title: "Search eval human promotion and regression gates"
owner: "nisal"
priority: "P0"
status: "not-started"
start_date: "2026-05-25"
duration: 3
depends_on:
  - "feat-139"
blocks:
  - "feat-141"
tags:
  - "admin"
  - "mastra"
  - "search"
  - "ai-pipeline"
  - "observability"
  - "evals"
---

## Problem

Generated eval candidates are useful for scale, but they should not become
long-lived regression gates until a human has reviewed and promoted them. The
system needs a promotion path that turns sanitized, source-anchored candidates
into durable benchmarks while keeping raw production traces subject to the
30-day deletion rule.

Before generated candidates become part of the loop, operators need a small
hand-authored baseline prompt set they can tweak directly. This lets the team
establish a known-good search baseline with prompts such as "Bible Project",
"Jesus", and "Who is Jesus?" before Mastra-generated or user-generated prompts
enter the review queue.

The seed set should also include audience and demographic intent prompts, such
as life stage, age range, family role, locale, and ministry context. These cases
should test whether search understands the intended audience without encoding
stereotypes as expected-result truth.

This completes the hybrid truth model: source-anchored for scale,
judge-scored for nuance, and human-promoted for regression gates.

The human promotion surface should live with the eval operator workflow in
Mastra, not as a hidden Admin-only table edit. Admin remains the durable owner
of search-eval storage, sanitization policy, reviewer audit fields, and
regression loading; Mastra owns the operator-facing review experience and must
call authenticated Admin HTTP contracts for candidate reads and state changes.

## Entry Points - Read These First

1. `docs/brainstorms/2026-05-25-mastra-embedding-search-migration-requirements.md`
   - human-promoted regression gate decision.
2. `docs/roadmap/content-discovery/feat-138-mastra-eval-query-generation.md`
   - generated candidate storage and promotion status.
3. `docs/roadmap/content-discovery/feat-139-mastra-offline-search-eval-runner-reports.md`
   - Mastra eval report output to review.
4. `apps/admin/eval/README.md`
   - existing regression and calibration artifact guidance.
5. `apps/admin/eval/regressions.json`
   - current hand-edited regression case store.
6. `apps/admin/src/services/search-eval/regressions.ts`
   - regression loading and validation.
7. `apps/admin/src/services/search-eval/reporter.ts`
   - report details that should support promotion decisions.
8. `apps/admin/src/app/dashboard/search/page.tsx`
   - existing Admin search/debug surface for result inspection and previewing.
9. `apps/mastra/src/mastra/index.ts`
   - Mastra workflow/route registration and service-bearer route patterns.
10. `apps/mastra/src/mastra/workflows/eval-query-generation.ts`
    - generated candidate provenance and Mastra run metadata.

## Grep These

```
rg -n "regressions.json|loadRegressions|Regression|calibration" apps/admin/eval apps/admin/src/services/search-eval
rg -n "candidate|promotion|approved|sanitized|human" apps/admin/src apps/mastra/src docs/roadmap
rg -n "dashboard/search|workflow reports|eval reports|registerApiRoute|studio|workflow" apps/admin/src/app apps/mastra/src
```

## What To Build

1. Add a seed baseline prompt set for operator-authored search prompts. These
   prompts should be easy to edit before the first baseline is captured and
   should include expected-result notes or source anchors where obvious.
   Include demographic/audience-intent coverage, such as prompts for teens,
   parents, new believers, small groups, church leaders, and locale-specific
   audiences.
2. Add support for user-generated prompt submissions as candidate eval inputs.
   User-generated prompts must enter the same pending-review flow as generated
   candidates before they can become regression gates.
3. Add a Mastra-owned operator review surface for generated, seed baseline, and
   user-generated eval candidates. Prefer placing it in Mastra's evaluation or
   workflow operator experience if the platform supports that cleanly; otherwise
   add a Mastra-hosted route/page/tool surface dedicated to candidate review.
   The surface must show candidate query text, source, locale, label
   provenance, source anchors, expected-result hints, judge summary, search
   preview/report links, promotion status, and review history.
4. Add authenticated Admin HTTP contracts for the Mastra review surface:
   candidate list/detail reads, sanitized field edits, reject/archive, and
   promote. Mastra must not import Admin code or connect to Admin's database.
5. Add a human review and promotion workflow for generated eval candidates.
   Promotion must record reviewer identity, review timestamp, source anchors,
   sanitization status, expected-result notes, and the Mastra/Admin run context
   used during review.
6. Ensure promoted evals can survive beyond the 30-day raw trace retention
   window without retaining unsafe raw trace data.
7. Add regression-gate loading so promoted evals can be used by Mastra offline
   eval runs and CI-sensitive search checks.
8. Preserve or migrate the existing hand-edited `apps/admin/eval/regressions.json`
   flow so current regression cases are not lost.
9. Add clear rejection/archive states for low-quality, ambiguous, abusive, or
   unsanitized candidates.
10. Document the review standards for seed baseline prompts, user-generated
    prompts, source-anchored candidates, judge-scored candidates, and
    human-promoted cases, including how demographic/audience-intent cases should
    be reviewed without relying on stereotypes.

## Constraints

- Do not retain raw per-query production traces longer than 30 days.
- Do not promote candidate queries that contain personal data, abusive content,
  prompt-injection content, or unclear viewer intent.
- Do not let user-generated prompts bypass review, sanitization, or source
  anchoring requirements.
- Do not encode protected-class stereotypes as expected-result truth for
  demographic/audience-intent prompts.
- Do not rely on LLM judge output alone as the durable expected-result truth.
- Do not change public search response shapes.
- CMS/Strapi is being deleted. Do not add, preserve, or depend on CMS support in
  this ticket. Promoted cases should reference Admin/Core-owned content IDs.
- Do not place Mastra in the live search request path.
- Do not let the Mastra review surface mutate candidates except through
  authenticated Admin HTTP contracts.
- Do not expose raw sensitive trace text, provider secrets, vectors, or
  unsanitized source payloads in the Mastra review surface.

## Verification

- Operators can open the Mastra-owned review surface, inspect pending
  candidates, edit sanitized review fields, reject/archive a bad candidate, and
  promote an approved candidate without using a direct database console.
- The Mastra review surface reads and mutates candidates only through Admin HTTP
  contracts; Mastra has no Admin database connection and no Admin app imports.
- A generated candidate can be reviewed, sanitized, promoted, and loaded as a
  durable regression case.
- Operators can define and edit a small seed prompt set, capture a baseline from
  it, and then use that baseline for before/after search-quality comparison.
- The seed prompt set covers audience/demographic intent, including at least
  life stage, family role, ministry role, and locale-sensitive examples.
- User-generated prompts are stored as pending candidates and cannot enter
  regression gates until reviewed and promoted.
- Rejected candidates do not enter regression gates.
- Raw trace retention still deletes per-query trace data after 30 days while
  preserving only approved sanitized benchmarks and aggregates.
- Existing hand-edited regression cases still load.
- Run focused validation for touched scopes, including:

```
pnpm --filter @forge/admin test -- search-eval/regressions.test.ts search-eval/runner.test.ts search-eval/reporter.test.ts
pnpm --filter @forge/mastra test
pnpm --filter @forge/admin typecheck
```
