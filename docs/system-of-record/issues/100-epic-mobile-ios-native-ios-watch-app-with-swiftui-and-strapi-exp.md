---
artifactType: issue
issueNumber: 100
issueTitle: "epic(mobile-ios): native iOS watch app with SwiftUI and Strapi Experience"
issueUrl: "https://github.com/JesusFilm/forge/issues/100"
state: "CLOSED"
closedAt: "2026-03-16T06:11:13Z"
labels: []
linkedPrs: []
---

# Issue Artifact: #100

## Background

Parent epic for the **native iOS** (SwiftUI) watch app under `mobile/ios`. Content is fetched from Strapi (this monorepo's CMS) via GraphQL; layout is **server-driven** by Experience/sections. This epic is the **source of truth** for iOS watch app development. All implementation work is tracked in sub-issues linked below. **iOS only**—no Android or Expo.

**Context:**

- **Product target:** Watch-style app mirroring [jesusfilm.org/watch](https://www.jesusfilm.org/watch) and experience pages (e.g. [Easter](https://www.jesusfilm.org/watch/easter.html/english.html), [Christmas](https://www.jesusfilm.org/watch/christmas.html/english.html))—streaming library, featured content, locale-specific experiences with sections (hero, media collections, text, video, CTA, containers, carousels, cards, Q&A).
- **CMS:** Strapi in `apps/cms`; schema at `apps/cms/schema.graphql`. Same **Experience** and `ExperienceBlocksDynamicZone` (10 mobile-applicable section types) as web.
- **App location:** Native app under **`mobile/ios`** (Swift Package today; epic adds app target/workspace).
- **GraphQL:** Apollo iOS (or equivalent) for Strapi; operations and generated types from `apps/cms/schema.graphql` in platform folder (platform-owned, no shared ops with Android/Expo).

## Expected outcome

- A native iOS (and iPadOS) SwiftUI app under `mobile/ios` that builds and runs.
- App fetches Experience(s) from Strapi via GraphQL and renders **server-driven UI** (section-based layout).
- Watch home and experience-by-slug with locale; visual parity goal with jesusfilm.org/watch and experience pages.
- Sub-issues enable **parallel work** where possible (e.g. section renderers split by type; config/CI parallel to feature work).
- Repo workflow (issue first, branch, PR, conventional commits) and CI (lint, typecheck, build) applied.

## Acceptance criteria

- [ ] All sub-issues created and linked (dependency order below updated with issue numbers).
- [ ] iOS app under `mobile/ios`; runnable app target; Swift 6, SwiftUI, SPM.
- [ ] App fetches Experience(s) and renders section-based UI for all **10 mobile-applicable section types** (see below).
- [ ] Watch home and at least one experience-by-slug with locale.
- [ ] SwiftLint/CI pass; dev/stage/prod config and README; unit tests for data layer and critical paths.

## Possible solution(s)

1. **Scaffold:** Xcode app target/workspace under `mobile/ios`; SPM; feature-based folders; minimal SwiftUI entry.
2. **GraphQL:** Apollo iOS codegen from `apps/cms/schema.graphql` in `mobile/ios`; ContentClient adapter with endpoint + auth.
3. **Data layer expansion:** Expand models, query, and mapping to support all 10 section types with full nesting (Section → Container → leaf).
4. **Section renderers:** Tier 1 (leaf) renderers in parallel, then Tier 2 (structural) renderers, so multiple agents can implement concurrently.
5. **Routing:** Watch home (homepage experience) and experience-by-slug (e.g. `easter`, `christmas`) with locale.

## References

- [AGENTS.md](AGENTS.md), [mobile/AGENTS.md](mobile/AGENTS.md), [mobile/ios/AGENTS.md](mobile/ios/AGENTS.md)
- [apps/cms/schema.graphql](apps/cms/schema.graphql)
- [apps/web/src/lib/content.ts](apps/web/src/lib/content.ts) (web watch experience consumption)
- Easter reference page: https://www.jesusfilm.org/watch/easter.html/english.html
- Sample Experience: documentId `lr6luew6oh4hurag4n8s0ddz` (Easter page mockup)
- Epic #89 (mobile-expo) for parallel structure; this epic is iOS-only and independent.

---

## Execution summary

- No linked merged PR found.

## Key review notes

- No PR review notes found.
