---
artifactType: plan
sourceIssueNumber: 100
sourceIssueTitle: "epic(mobile-ios): native iOS watch app with SwiftUI and Strapi Experience"
sourceIssueUrl: "https://github.com/JesusFilm/forge/issues/100"
linkedPrs: []
---

# Plan Artifact: #100

## Objective

- A native iOS (and iPadOS) SwiftUI app under `mobile/ios` that builds and runs.
- App fetches Experience(s) from Strapi via GraphQL and renders **server-driven UI** (section-based layout).
- Watch home and experience-by-slug with locale; visual parity goal with jesusfilm.org/watch and experience pages.
- Sub-issues enable **parallel work** where possible (e.g. section renderers split by type; config/CI parallel to feature work).
- Repo workflow (issue first, branch, PR, conventional commits) and CI (lint, typecheck, build) applied.

## Planned approach

1. **Scaffold:** Xcode app target/workspace under `mobile/ios`; SPM; feature-based folders; minimal SwiftUI entry.
2. **GraphQL:** Apollo iOS codegen from `apps/cms/schema.graphql` in `mobile/ios`; ContentClient adapter with endpoint + auth.
3. **Data layer expansion:** Expand models, query, and mapping to support all 10 section types with full nesting (Section → Container → leaf).
4. **Section renderers:** Tier 1 (leaf) renderers in parallel, then Tier 2 (structural) renderers, so multiple agents can implement concurrently.
5. **Routing:** Watch home (homepage experience) and experience-by-slug (e.g. `easter`, `christmas`) with locale.

## Validation

- [ ] All sub-issues created and linked (dependency order below updated with issue numbers).
- [ ] iOS app under `mobile/ios`; runnable app target; Swift 6, SwiftUI, SPM.
- [ ] App fetches Experience(s) and renders section-based UI for all **10 mobile-applicable section types** (see below).
- [ ] Watch home and at least one experience-by-slug with locale.
- [ ] SwiftLint/CI pass; dev/stage/prod config and README; unit tests for data layer and critical paths.

## Source links

- Issue: [#100](https://github.com/JesusFilm/forge/issues/100)
- PRs:
- None
