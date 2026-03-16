---
artifactType: issue
issueNumber: 108
issueTitle: "feat(mobile-ios): Watch home and experience-by-slug + locale"
issueUrl: "https://github.com/JesusFilm/forge/issues/108"
state: "CLOSED"
closedAt: "2026-03-16T06:11:14Z"
labels: ["feat", "mobile-ios"]
linkedPrs: []
---

# Issue Artifact: #108

## Background

The app must show a watch home (homepage experience) and experience-by-slug (e.g. easter, christmas) with locale. This composes the data layer and all section renderers into navigable screens.

## Expected outcome

Watch home screen and experience detail screen(s); navigation by slug and locale; sections rendered via MediaCollection, PromoBanner, InfoBlocks, and CTA renderers. Locale resolved (e.g. from env or user setting) and passed to API.

## Acceptance criteria

- [ ] Watch home fetches homepage experience and renders sections.
- [ ] Experience-by-slug screen(s) for at least one slug (e.g. easter or christmas) with locale.
- [ ] Navigation/routing between home and experience(s).
- [ ] Locale passed to GraphQL; empty/error states handled.

## Possible solution(s)

1. Root navigation (e.g. NavigationStack); home view and experience view; section list that switches on section type and uses 4a–4d views.
2. Reuse web behavior: homepageExperience(locale) and experience(slug, locale).

## References

- Parent: #100
- Depends on: #104, #105, #106, #107
- apps/web/src/lib/content.ts, apps/web/src/app/[slug]/[locale]/page.tsx

## Execution summary

- No linked merged PR found.

## Key review notes

- No PR review notes found.
