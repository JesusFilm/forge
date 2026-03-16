---
artifactType: plan
sourceIssueNumber: 334
sourceIssueTitle: "feat(web): add Video section component with custom player controls"
sourceIssueUrl: "https://github.com/JesusFilm/forge/issues/334"
linkedPrs: []
---

# Plan Artifact: #334

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

## Source links

- Issue: [#334](https://github.com/JesusFilm/forge/issues/334)
- PRs:
- None
