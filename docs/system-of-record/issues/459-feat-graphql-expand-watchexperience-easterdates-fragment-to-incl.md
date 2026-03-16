---
artifactType: issue
issueNumber: 459
issueTitle: "feat(graphql): expand watchExperience EasterDates fragment to include all fields"
issueUrl: "https://github.com/JesusFilm/forge/issues/459"
state: "CLOSED"
closedAt: "2026-03-13T04:19:29Z"
labels: []
linkedPrs: []
---

# Issue Artifact: #459

## Background

The `watchExperience` query in `packages/graphql/src/watchExperience.ts` currently only fetches `id` for `ComponentSectionsEasterDates` (lines 179-181). The CMS schema defines 7 fields, but only `id` is queried. Both the web app and iOS app already query all fields for their EasterDates renderers.

The mobile Expo app cannot render the EasterDates section until the shared GraphQL query includes the full field set.

## Expected outcome

The `ComponentSectionsEasterDates` fragment in `watchExperience.ts` includes all fields defined in the CMS schema:

- `id`, `sectionKey`, `easterDatesTitle`, `westernEasterLabel`, `orthodoxEasterLabel`, `passoverLabel`, `locale`

## Acceptance criteria

- [ ] `watchExperience.ts` query fragment expanded for `ComponentSectionsEasterDates`
- [ ] `graphql-env.d.ts` regenerated to reflect the updated query
- [ ] `WatchExperienceBlock` type updated to include the new fields
- [ ] No other files outside `packages/graphql/` modified

## Possible solution(s)

Replace lines 179-181 in `watchExperience.ts`:

```graphql
... on ComponentSectionsEasterDates {
  id
  sectionKey
  easterDatesTitle
  westernEasterLabel
  orthodoxEasterLabel
  passoverLabel
  locale
}
```

Then regenerate `graphql-env.d.ts` and update the `WatchExperienceBlock` type.

## References

- `apps/cms/schema.graphql` — `ComponentSectionsEasterDates` type definition
- `apps/web/src/components/sections/EasterDates.tsx` — web fragment (queries all 7 fields)
- `mobile/ios/GraphQL/Fragments/SectionFragments.graphql` — iOS fragment (queries all 7 fields)
- Epic #89 — parent Expo epic

## Execution summary

- No linked merged PR found.

## Key review notes

- No PR review notes found.
