---
artifactType: plan
sourceIssueNumber: 388
sourceIssueTitle: "feat(web): redesign media collection carousel with video bible collection layout"
sourceIssueUrl: "https://github.com/JesusFilm/forge/issues/388"
linkedPrs: []
---

# Plan Artifact: #388

## Objective

- MediaCollection component redesigned with dark themed carousel matching the Video Bible Collection mockup
- Schema extended with `labelOverride` and `ctaLabel` fields for item-level and section-level overrides
- Seed data updated with Video Bible Collection content (6 top-level videos: JESUS, Life of Jesus, LUMO series)
- Uses shadcn Carousel, Button, and Badge components

## Planned approach

1. Extend CMS schemas, update GraphQL fragment, redesign MediaCollection.tsx carousel variant, add seed data block to seed-easter.cjs

## Validation

- [ ] `media-collection-item.json` extended with `labelOverride` field
- [ ] `media-collection.json` extended with `ctaLabel` field
- [ ] MediaCollection component redesigned with dark carousel variant matching mockup
- [ ] Cards show thumbnail, badge (count), label, and title
- [ ] Carousel uses shadcn Embla carousel with drag-free scrolling
- [ ] CTA button (WATCH) rendered in header
- [ ] Footer text / description rendered below carousel
- [ ] Seed data updated with Video Bible Collection block
- [ ] GraphQL fragment updated to include new fields

## Source links

- Issue: [#388](https://github.com/JesusFilm/forge/issues/388)
- PRs:
- None
