---
artifactType: issue
issueNumber: 388
issueTitle: "feat(web): redesign media collection carousel with video bible collection layout"
issueUrl: "https://github.com/JesusFilm/forge/issues/388"
state: "CLOSED"
closedAt: "2026-03-12T03:28:27Z"
labels: ["feat", "web"]
linkedPrs: []
scope: "web"
---

# Issue Artifact: #388

## Background

The existing MediaCollection component has a basic card layout that doesn't match the dark-themed video bible collection design. The component needs to be redesigned to use shadcn Carousel (Embla), support item badges (chapter/item counts), video type labels (Feature Film / Collection), and a rich dark background aesthetic.

## Expected outcome

- MediaCollection component redesigned with dark themed carousel matching the Video Bible Collection mockup
- Schema extended with `labelOverride` and `ctaLabel` fields for item-level and section-level overrides
- Seed data updated with Video Bible Collection content (6 top-level videos: JESUS, Life of Jesus, LUMO series)
- Uses shadcn Carousel, Button, and Badge components

## Acceptance criteria

- [ ] `media-collection-item.json` extended with `labelOverride` field
- [ ] `media-collection.json` extended with `ctaLabel` field
- [ ] MediaCollection component redesigned with dark carousel variant matching mockup
- [ ] Cards show thumbnail, badge (count), label, and title
- [ ] Carousel uses shadcn Embla carousel with drag-free scrolling
- [ ] CTA button (WATCH) rendered in header
- [ ] Footer text / description rendered below carousel
- [ ] Seed data updated with Video Bible Collection block
- [ ] GraphQL fragment updated to include new fields

## Possible solution(s)

1. Extend CMS schemas, update GraphQL fragment, redesign MediaCollection.tsx carousel variant, add seed data block to seed-easter.cjs

## References

- Related: #159 (feat(web): add videos carousel)
- `apps/cms/src/components/sections/media-collection.json`
- `apps/cms/src/components/sections/media-collection-item.json`
- `apps/web/src/components/sections/MediaCollection.tsx`

## Execution summary

- No linked merged PR found.

## Key review notes

- No PR review notes found.
