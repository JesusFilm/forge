---
id: "feat-317"
title: "Watch FAQ disclosure semantics"
owner: "vlad"
priority: "P2"
status: "complete"
start_date: "2026-07-25"
duration: 1
depends_on: []
blocks: []
tags:
  - "platform"
  - "web"
  - "watch-page"
  - "accessibility"
---

## Problem

FGE-40 identified that the Watch `RelatedQuestions` FAQ buttons do not expose
their expanded state or identify the answer panels they control. Assistive
technology therefore receives buttons without the disclosure state and
relationship needed to understand the interaction.

## Entry Points - Read These First

1. `docs/plans/2026-07-25-001-fix-watch-faq-disclosure-semantics-plan.md`
   - implementation plan for this scoped FGE-40 fix.
2. `apps/web/src/components/sections/RelatedQuestions.tsx`
   - hand-rolled FAQ disclosure and single-open state.
3. `apps/web/src/components/sections/RelatedQuestions.test.tsx`
   - focused disclosure semantics and state-transition coverage.
4. `apps/web/src/components/watch/WatchStudyQuestions.tsx`
   - existing per-row `useId`, `aria-expanded`, and `aria-controls` pattern.
5. `apps/web/src/components/sections/AdventCountdown.tsx`
   - existing controlled disclosure relationship in a section component.

## Grep These

- `function QuestionItem`
- `openIndex`
- `aria-expanded`
- `aria-controls`
- `useId`

## What To Build

1. Give every FAQ trigger an accurate `aria-expanded` value.
2. Generate a unique panel ID per question and reference it with
   `aria-controls`.
3. Keep the matching panel as a valid hidden DOM target while collapsed.
4. Preserve the existing single-open and toggle-closed behavior.
5. Add focused jsdom tests for collapsed, expanded, switched, and re-collapsed
   states.

## Constraints

- Keep the current FAQ content, visual styling, and single-open interaction.
- Do not migrate the section to a different accordion implementation.
- Do not broaden this change into the remaining FGE-40 carousel, dialog,
  focus-management, touch-target, axe, or screen-reader acceptance criteria.
- Preserve unrelated working-tree changes.

## Verification

- Focused `RelatedQuestions` component tests prove trigger state and that each
  `aria-controls` value resolves to the matching panel in every state.
- `@forge/web` typecheck and lint pass for the changed component and test.
- Browser DOM inspection confirms the production-shaped FAQ interaction keeps
  the relationship intact while toggling.

## Completion Notes

- FAQ triggers now use native button semantics with accurate `aria-expanded`
  and unique `aria-controls` relationships.
- Each answer panel remains as the referenced hidden DOM target while
  collapsed; its Markdown content still mounts only while open.
- Focused disclosure tests, `@forge/web` typecheck, and `@forge/web` lint pass.
- The full web suite remains blocked by two unrelated date-dependent failures
  in `src/lib/watch-home-carousel-sequence.test.ts`.

## Plan

Implementation plan:
`docs/plans/2026-07-25-001-fix-watch-faq-disclosure-semantics-plan.md`
