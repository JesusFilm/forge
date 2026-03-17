---
artifactType: plan
sourceId: 334
sourceTitle: "feat(web): add Video section component with custom player controls"
linkedPrs: []
scope: "web"
---

# Plan Artifact: "feat(web): add Video section component with custom player controls"

## Objective

- A `Video` section component in `apps/web/src/components/sections/` that renders `ComponentSectionsVideo` blocks with custom video.js-based player controls.
- A GraphQL fragment for `ComponentSectionsVideo` registered in the experience query.
- The component is wired into `ExperienceSectionRenderer` and `Container`'s `SlotContentRenderer`.
- The seed script creates a video block in the Easter experience.

## Planned approach

1. Adapt the `CollectionVideoPlayer` pattern from the existing JesusFilm project, using video.js + Tailwind CSS custom controls instead of MUI. Follow the same fragment + section renderer pattern used by other section components.

## Validation

- [ ] GraphQL fragment `VideoSection` on `ComponentSectionsVideo` exists and is registered
- [ ] `Video` component renders with custom controls (play/pause, progress slider, time, mute, fullscreen)
- [ ] `ExperienceSectionRenderer` handles `ComponentSectionsVideo`
- [ ] `Container` SlotContentRenderer handles `ComponentSectionsVideo`
- [ ] `content.ts` query includes the Video fragment spread
- [ ] Seed script adds a video block to the Easter experience
- [ ] No lint errors introduced

## References

- Existing `VideoHero.tsx` component for video.js pattern
- CMS schema: `apps/cms/src/components/sections/video.json`
- GraphQL type: `ComponentSectionsVideo` in `schema.graphql`

## Source links

- PRs:
- None

## Review notes

- No PR review notes found.
