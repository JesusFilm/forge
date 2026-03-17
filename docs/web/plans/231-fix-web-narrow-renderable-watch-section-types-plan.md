---
artifactType: plan
sourceId: 231
sourceTitle: "fix(web): narrow renderable watch section types"
linkedPrs: []
scope: "web"
---

# Plan Artifact: "fix(web): narrow renderable watch section types"

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

## References

- CI run: https://github.com/JesusFilm/forge/actions/runs/22748399403/job/65977246512
- `apps/web/src/lib/content.ts`
- `apps/web/src/components/sections/index.tsx`
- `apps/web/src/app/page.tsx`
- `apps/web/src/app/[slug]/page.tsx`
- `apps/web/src/app/[slug]/[locale]/page.tsx`

## Source links

- PRs:
- None

## Review notes

- No PR review notes found.
