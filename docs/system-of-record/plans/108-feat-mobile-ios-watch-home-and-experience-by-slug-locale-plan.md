---
artifactType: plan
sourceIssueNumber: 108
sourceIssueTitle: "feat(mobile-ios): Watch home and experience-by-slug + locale"
sourceIssueUrl: "https://github.com/JesusFilm/forge/issues/108"
linkedPrs: []
---

# Plan Artifact: #108

## Objective

Watch home screen and experience detail screen(s); navigation by slug and locale; sections rendered via MediaCollection, PromoBanner, InfoBlocks, and CTA renderers. Locale resolved (e.g. from env or user setting) and passed to API.

## Planned approach

1. Root navigation (e.g. NavigationStack); home view and experience view; section list that switches on section type and uses 4a–4d views.
2. Reuse web behavior: homepageExperience(locale) and experience(slug, locale).

## Validation

- [ ] Watch home fetches homepage experience and renders sections.
- [ ] Experience-by-slug screen(s) for at least one slug (e.g. easter or christmas) with locale.
- [ ] Navigation/routing between home and experience(s).
- [ ] Locale passed to GraphQL; empty/error states handled.

## Source links

- Issue: [#108](https://github.com/JesusFilm/forge/issues/108)
- PRs:
- None
