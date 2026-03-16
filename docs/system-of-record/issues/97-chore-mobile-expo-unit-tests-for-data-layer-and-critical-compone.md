---
artifactType: issue
issueNumber: 97
issueTitle: "chore(mobile-expo): Unit tests for data layer and critical components"
issueUrl: "https://github.com/JesusFilm/forge/issues/97"
state: "CLOSED"
closedAt: "2026-03-11T01:32:05Z"
labels: []
linkedPrs:
  [
    { "number": 492, "url": "https://github.com/JesusFilm/forge/pull/492" },
    { "number": 490, "url": "https://github.com/JesusFilm/forge/pull/490" },
    { "number": 488, "url": "https://github.com/JesusFilm/forge/pull/488" },
    { "number": 486, "url": "https://github.com/JesusFilm/forge/pull/486" },
    { "number": 485, "url": "https://github.com/JesusFilm/forge/pull/485" },
    { "number": 484, "url": "https://github.com/JesusFilm/forge/pull/484" },
    { "number": 482, "url": "https://github.com/JesusFilm/forge/pull/482" },
    { "number": 480, "url": "https://github.com/JesusFilm/forge/pull/480" },
    { "number": 478, "url": "https://github.com/JesusFilm/forge/pull/478" },
    { "number": 477, "url": "https://github.com/JesusFilm/forge/pull/477" },
    { "number": 475, "url": "https://github.com/JesusFilm/forge/pull/475" },
    { "number": 473, "url": "https://github.com/JesusFilm/forge/pull/473" },
    { "number": 472, "url": "https://github.com/JesusFilm/forge/pull/472" },
    { "number": 470, "url": "https://github.com/JesusFilm/forge/pull/470" },
    { "number": 468, "url": "https://github.com/JesusFilm/forge/pull/468" },
    { "number": 466, "url": "https://github.com/JesusFilm/forge/pull/466" },
    { "number": 463, "url": "https://github.com/JesusFilm/forge/pull/463" },
    { "number": 462, "url": "https://github.com/JesusFilm/forge/pull/462" },
    { "number": 461, "url": "https://github.com/JesusFilm/forge/pull/461" },
    { "number": 457, "url": "https://github.com/JesusFilm/forge/pull/457" },
  ]
---

# Issue Artifact: #97

## Background

The Expo watch app should have unit tests for the data layer (Experience/section mapping) and critical components so regressions are caught and behavior is documented. This issue adds those tests. Scope has been expanded to cover all 10 active section types.

## Expected outcome

- Unit tests for the Experience fetch and section data layer, covering mapping logic for all 10 section types.
- Unit tests for critical UI or hooks (e.g. section renderer dispatch, nested content resolution).
- Tests run in CI (see chore for CI); no flaky or environment-dependent tests in core paths.
- E2E strategy can be documented as deferred if out of scope.

## Acceptance criteria

- [ ] Data layer tests: at least one test per fetch path (watch home, experience-by-slug) or mapping logic.
- [ ] Mapping tests for each of the 10 section types: VideoHero, MediaCollection, CTA, Text, Video, BibleQuotesCarousel, RelatedQuestions, Card, Section, Container.
- [ ] Nested content tests: Section → recursive content, Container → slots → recursive content.
- [ ] MediaCollection variant tests (carousel, collection, grid, hero, player).
- [ ] SectionDispatcher tests: correct component resolved for each `__typename`.
- [ ] Tests run in CI (via Expo or Jest).
- [ ] README or CONTRIBUTING updated with how to run tests.

## Possible solution(s)

1. Jest or Expo's test runner; mock GraphQL client in data layer tests.
2. Keep tests colocated or in `__tests__` under `mobile/expo`.
3. Use the sample Experience (slug: `easter`, documentId: `lr6luew6oh4hurag4n8s0ddz`) as a fixture for integration-style mapping tests.

## References

- Parent: #89
- Depends on: #304 (expanded data layer), #93 (section renderers)
- [CONTRIBUTING.md](CONTRIBUTING.md)
- [AGENTS.md](AGENTS.md) (workflow, tests)
- [apps/cms/schema.graphql](apps/cms/schema.graphql) — `ExperienceSectionsDynamicZone` union (line 693)

## Execution summary

- [#492](https://github.com/JesusFilm/forge/pull/492): fix(cms): run easter seed only outside doppler prd — ## Summary - Invert Easter seed gating to run only when `DOPPLER_CONFIG !== prd`. - Skip seeding when `DOPPLER_CONFIG` is `prd`. - Keep boo…
- [#490](https://github.com/JesusFilm/forge/pull/490): chore(tooling): convert repo skills to codex-ready format — ## Summary - add repo-local Codex skills for the existing Forge workflow, issue work, PR review, and post-merge update flows - align shared…
- [#488](https://github.com/JesusFilm/forge/pull/488): fix(cms): gate easter seed to doppler prd — ## Summary - Run Easter seeding only when `DOPPLER_CONFIG` is exactly `prd`. - Remove dependency on `NODE_ENV` for this seed gate so stage-…
- [#486](https://github.com/JesusFilm/forge/pull/486): feat(cms): add video-subtitle content type schema — ## Summary Describe the bounded change and reason. PR title must use `type(scope): description` (e.g. `feat(web): add validation`). ## Cont…
- [#485](https://github.com/JesusFilm/forge/pull/485): feat(cms): move easter seed into bootstrap — ## Summary - Move internal API token bootstrap helper to `apps/cms/src/bootstrap/internal-api-token.ts`. - Refactor Easter seeding into `ap…
- [#484](https://github.com/JesusFilm/forge/pull/484): chore(tooling): migrate app secret sync commands to Doppler — ## Summary - add `fetch-secrets` scripts in `apps/cms`, `apps/web`, and `apps/mobile` to pull Doppler `dev` config into local `.env` - upda…
- [#482](https://github.com/JesusFilm/forge/pull/482): docs(cms): document shared key generation in env example — ## Summary - Add per-variable guidance for generating each shared key in `apps/cms/.env.example`. - Clarify which value is generated in Str…
- [#480](https://github.com/JesusFilm/forge/pull/480): feat(web): add navigation carousel section component — ## Summary - Add Navigation Carousel component: a horizontal free-scroll strip of clickable cards that smooth-scroll the page to matching `…
- [#478](https://github.com/JesusFilm/forge/pull/478): feat(web): add video carousel picker section component — ## Summary - Add `video-carousel` and `video-carousel-item` Strapi component schemas with `cosmic` backgroundColor enum and `staticOverlay`…
- [#477](https://github.com/JesusFilm/forge/pull/477): docs(tooling): align docs with repository simplification — ## Summary Align repository documentation with the current simplification work by removing references to deleted contexts (`apps/ai-orchest…
- [#475](https://github.com/JesusFilm/forge/pull/475): fix(web): restore next binary in Railway deploy for @forge/web — ## Summary Remove CMS-specific workspace exclusions from root `.dockerignore` so Railway includes `apps/web` and `packages` in the build co…
- [#473](https://github.com/JesusFilm/forge/pull/473): chore(deps): Bump the production-dependencies group across 1 directory with 20 updates — Bumps the production-dependencies group with 20 updates in the / directory: | Package | From | To | | --- | --- | --- | | [@strapi/plugin-g…
- [#472](https://github.com/JesusFilm/forge/pull/472): fix(web): use INTERNAL_GRAPHQL_URL for server traffic — ## Summary Update web GraphQL client URL selection by runtime: browser uses `NEXT_PUBLIC_GRAPHQL_URL`, server uses `INTERNAL_GRAPHQL_URL`. …
- [#470](https://github.com/JesusFilm/forge/pull/470): feat(cms): migrate cms infrastructure to railway — ## Summary - move CMS runtime configuration to Railway S3-compatible storage and Resend email - replace AWS ECS/ECR CMS deployment workflow…
- [#468](https://github.com/JesusFilm/forge/pull/468): fix(cms): bypass Strapi create() in API token bootstrap — ## Summary - Strapi v5's `apiTokenService.create()` always generates a random `accessKey` via `crypto.randomBytes(128)` and ignores the `ac…
- [#466](https://github.com/JesusFilm/forge/pull/466): feat(web): add video carousel picker section component — ## Summary Add a new `VideoCarousel` Strapi component schema and matching Next.js frontend component for a carousel-based video picker. The…
- [#463](https://github.com/JesusFilm/forge/pull/463): chore(deps): Bump the production-dependencies group across 1 directory with 21 updates — Bumps the production-dependencies group with 21 updates in the / directory: | Package | From | To | | --- | --- | --- | | [@aws-sdk/client-…
- [#462](https://github.com/JesusFilm/forge/pull/462): feat(mobile-expo): add EasterDates section renderer — ## Summary - Expands the shared GraphQL query (`watchExperience.ts`) to fetch all `ComponentSectionsEasterDates` fields (title, labels, loc…
- [#461](https://github.com/JesusFilm/forge/pull/461): fix(mobile-ios): cta button orange-red gradient, remove section background — ## Summary - Replace system `.borderedProminent`/`.bordered` button styles with a custom orange-to-red `LinearGradient` capsule button to m…
- [#457](https://github.com/JesusFilm/forge/pull/457): fix(mobile-ios): video section autoplay, padding, and full-screen — ## Summary - Video section now autoplays muted when scrolled into view and pauses when scrolled away, using `GeometryReader` frame visibili…

## Key review notes

- _⚠️ Potential issue_ | _🟠 Major_ **PR inference can target the wrong PR; constrain to open PRs and add merged-branch guard.** The current inference query can return a non-open PR…
- Handled in c2bcb68: the Codex review skill now guards against merged branch PRs, limits inference to open PRs, and uses an explicit PR variable through the follow-up commands.
- `@lumberman`, thanks for the update! The changes in c2bcb68 — guarding against merged branch PRs, scoping inference to `--state open`, and threading the explicit PR variable throu…
- _⚠️ Potential issue_ | _🟠 Major_ <details> <summary>🧩 Analysis chain</summary> 🌐 Web query: `Does `gh pr view <PR> --json reviews,comments` include review-thread resolution sta…
- _⚠️ Potential issue_ | _🟠 Major_ <details> <summary>🧩 Analysis chain</summary> 🏁 Script executed: ```shell #!/bin/bash # Verify jq behavior used by the snippet. printf '[]\n' |…
- _🛠️ Refactor suggestion_ | _🟠 Major_ **Move env resolution out of app bootstrap logic.** Lines 10-17 directly branch on `process.env.DOPPLER_CONFIG` inside app logic. Please mov…
- _⚠️ Potential issue_ | _🟠 Major_ **Avoid running destructive Easter reseed on every `prd` boot.** Line 11 runs `seedEaster` on every startup when `DOPPLER_CONFIG` is `"prd"`. In …
- _⚠️ Potential issue_ | _🟡 Minor_ **Add Space key support for button accessibility.** Interactive elements with `role="button"` should respond to both Enter and Space keys per WCA…
