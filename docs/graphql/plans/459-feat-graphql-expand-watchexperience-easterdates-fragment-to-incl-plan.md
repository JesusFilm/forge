---
artifactType: plan
sourceIssueNumber: 459
sourceIssueTitle: "feat(graphql): expand watchExperience EasterDates fragment to include all fields"
sourceIssueUrl: "https://github.com/JesusFilm/forge/issues/459"
linkedPrs: []
scope: "graphql"
---

# Plan Artifact: #459

## Objective

The `ComponentSectionsEasterDates` fragment in `watchExperience.ts` includes all fields defined in the CMS schema:

- `id`, `sectionKey`, `easterDatesTitle`, `westernEasterLabel`, `orthodoxEasterLabel`, `passoverLabel`, `locale`

## Planned approach

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

## Validation

- [ ] `watchExperience.ts` query fragment expanded for `ComponentSectionsEasterDates`
- [ ] `graphql-env.d.ts` regenerated to reflect the updated query
- [ ] `WatchExperienceBlock` type updated to include the new fields
- [ ] No other files outside `packages/graphql/` modified

## Source links

- Issue: [#459](https://github.com/JesusFilm/forge/issues/459)
- PRs:
- None
