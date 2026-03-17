---
artifactType: plan
sourceId: 465
sourceTitle: "feat(web): add video carousel picker section component"
linkedPrs: []
scope: "web"
---

# Plan Artifact: "feat(web): add video carousel picker section component"

## Objective

A new `VideoCarousel` Strapi component schema and matching Next.js frontend component that:

- Renders a main video player (reusing the existing `VideoPlayer`) for the selected video
- Displays a horizontal thumbnail carousel (using shadcn/embla-carousel) for picking videos
- Is nestable inside sections and containers (not top-level)
- Includes seed data for the Easter documentary series (3 NFS videos)

## Planned approach

1. Create `video-carousel.json` and `video-carousel-slide.json` Strapi schemas
2. Create `videoCarouselFragment` GraphQL fragment
3. Export `VideoPlayer` from `Video.tsx` and build `CarouselVideo.tsx` on top
4. Wire into renderers and seed file

## Validation

- [ ] Strapi schema `sections.video-carousel` with repeatable `sections.video-carousel-slide` slides
- [ ] Registered in `section.json` and `container-slot.json` dynamic zones
- [ ] GraphQL fragment created and wired into section query
- [ ] `CarouselVideo.tsx` component reuses `VideoPlayer` from `Video.tsx` and shadcn `Carousel`
- [ ] `SectionContentRenderer` handles `ComponentSectionsVideoCarousel`
- [ ] Seed data added to `seed-easter.cjs` with 3 NFS documentary slides
- [ ] Codegen runs successfully after schema changes

## References

- Plan: video_carousel_component_841695f4
- Related: #175 (CMS schema epic), #176 (web section components epic)

## Source links

- PRs:
- None

## Review notes

- No PR review notes found.
