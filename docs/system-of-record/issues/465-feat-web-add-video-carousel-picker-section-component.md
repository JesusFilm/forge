---
artifactType: issue
issueNumber: 465
issueTitle: "feat(web): add video carousel picker section component"
issueUrl: "https://github.com/JesusFilm/forge/issues/465"
state: "CLOSED"
closedAt: "2026-03-16T02:49:27Z"
labels: ["feat", "web"]
linkedPrs: []
---

# Issue Artifact: #465

## Background

The Easter watch page needs a carousel-based video picker component inspired by the `CollectionVideoContentCarousel` from the legacy codebase. This component shows a main video player with a horizontal carousel of selectable video thumbnails beneath it, allowing users to switch between videos in a documentary series.

## Expected outcome

A new `VideoCarousel` Strapi component schema and matching Next.js frontend component that:

- Renders a main video player (reusing the existing `VideoPlayer`) for the selected video
- Displays a horizontal thumbnail carousel (using shadcn/embla-carousel) for picking videos
- Is nestable inside sections and containers (not top-level)
- Includes seed data for the Easter documentary series (3 NFS videos)

## Acceptance criteria

- [ ] Strapi schema `sections.video-carousel` with repeatable `sections.video-carousel-slide` slides
- [ ] Registered in `section.json` and `container-slot.json` dynamic zones
- [ ] GraphQL fragment created and wired into section query
- [ ] `CarouselVideo.tsx` component reuses `VideoPlayer` from `Video.tsx` and shadcn `Carousel`
- [ ] `SectionContentRenderer` handles `ComponentSectionsVideoCarousel`
- [ ] Seed data added to `seed-easter.cjs` with 3 NFS documentary slides
- [ ] Codegen runs successfully after schema changes

## Possible solution(s)

1. Create `video-carousel.json` and `video-carousel-slide.json` Strapi schemas
2. Create `videoCarouselFragment` GraphQL fragment
3. Export `VideoPlayer` from `Video.tsx` and build `CarouselVideo.tsx` on top
4. Wire into renderers and seed file

## References

- Plan: video_carousel_component_841695f4
- Related: #175 (CMS schema epic), #176 (web section components epic)

## Execution summary

- No linked merged PR found.

## Key review notes

- No PR review notes found.
