---
artifactType: issue
issueNumber: 334
issueTitle: "feat(web): add Video section component with custom player controls"
issueUrl: "https://github.com/JesusFilm/forge/issues/334"
state: "CLOSED"
closedAt: "2026-03-10T22:22:28Z"
labels: ["feat", "web"]
linkedPrs: []
scope: "web"
---

# Issue Artifact: #334

## Background

The CMS already has a `sections.video` component schema and `ComponentSectionsVideo` is in the GraphQL schema, but the web app has no corresponding React component to render it. We need a standalone video player component with custom controls (play/pause, progress, time, mute, fullscreen) that matches the existing VideoHero player pattern but is used as an inline section block.

## Expected outcome

- A `Video` section component in `apps/web/src/components/sections/` that renders `ComponentSectionsVideo` blocks with custom video.js-based player controls.
- A GraphQL fragment for `ComponentSectionsVideo` registered in the experience query.
- The component is wired into `ExperienceSectionRenderer` and `Container`'s `SlotContentRenderer`.
- The seed script creates a video block in the Easter experience.

## Acceptance criteria

- [ ] GraphQL fragment `VideoSection` on `ComponentSectionsVideo` exists and is registered
- [ ] `Video` component renders with custom controls (play/pause, progress slider, time, mute, fullscreen)
- [ ] `ExperienceSectionRenderer` handles `ComponentSectionsVideo`
- [ ] `Container` SlotContentRenderer handles `ComponentSectionsVideo`
- [ ] `content.ts` query includes the Video fragment spread
- [ ] Seed script adds a video block to the Easter experience
- [ ] No lint errors introduced

## Possible solution(s)

1. Adapt the `CollectionVideoPlayer` pattern from the existing JesusFilm project, using video.js + Tailwind CSS custom controls instead of MUI. Follow the same fragment + section renderer pattern used by other section components.

## References

- Existing `VideoHero.tsx` component for video.js pattern
- CMS schema: `apps/cms/src/components/sections/video.json`
- GraphQL type: `ComponentSectionsVideo` in `schema.graphql`

## Execution summary

- No linked merged PR found.

## Key review notes

- No PR review notes found.
