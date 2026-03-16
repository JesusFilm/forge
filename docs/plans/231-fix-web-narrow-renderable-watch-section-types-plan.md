---
artifactType: plan
sourceIssueNumber: 231
sourceIssueTitle: "fix(web): narrow renderable watch section types"
sourceIssueUrl: "https://github.com/JesusFilm/forge/issues/231"
linkedPrs: []
---

# Plan Artifact: #231

## Objective

The web app narrows watch-page sections to the supported renderable variants before rendering, `section.id` is type-safe again for those variants, and the build passes without local type assertions or generated-file edits.

## Planned approach

1. Narrow the `Section` alias to the four section variants currently rendered by the web app.
2. Export a shared type guard and reuse it in all watch-page entrypoints.
3. Keep unsupported section variants filtered out until renderers are implemented for them.

## Validation

- [ ] The watch-page section type only includes the renderable section variants used by `SectionRenderer`.
- [ ] The page entrypoints filter sections through a shared renderable-section type guard.
- [ ] `apps/web` builds without the `Property 'id' does not exist on type 'Section'` error.
- [ ] No generated GraphQL files are hand-edited.

## Source links

- Issue: [#231](https://github.com/JesusFilm/forge/issues/231)
- PRs:
- None
