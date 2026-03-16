---
artifactType: issue
issueNumber: 231
issueTitle: "fix(web): narrow renderable watch section types"
issueUrl: "https://github.com/JesusFilm/forge/issues/231"
state: "CLOSED"
closedAt: "2026-03-08T22:11:37Z"
labels: ["fix", "cms", "web"]
linkedPrs: []
scope: "web"
---

# Issue Artifact: #231

## Background

The `@forge/web` build is failing in CI because the `Section` type used by the watch page is broader than the set of sections the web app actually renders. Unsupported section union members remain in the query result with only `__typename`, so `section.id` is not safe on the current `Section` alias and TypeScript fails during `next build`.

## Expected outcome

The web app narrows watch-page sections to the supported renderable variants before rendering, `section.id` is type-safe again for those variants, and the build passes without local type assertions or generated-file edits.

## Acceptance criteria

- [ ] The watch-page section type only includes the renderable section variants used by `SectionRenderer`.
- [ ] The page entrypoints filter sections through a shared renderable-section type guard.
- [ ] `apps/web` builds without the `Property 'id' does not exist on type 'Section'` error.
- [ ] No generated GraphQL files are hand-edited.

## Possible solution(s)

1. Narrow the `Section` alias to the four section variants currently rendered by the web app.
2. Export a shared type guard and reuse it in all watch-page entrypoints.
3. Keep unsupported section variants filtered out until renderers are implemented for them.

## References

- CI run: https://github.com/JesusFilm/forge/actions/runs/22748399403/job/65977246512
- `apps/web/src/lib/content.ts`
- `apps/web/src/components/sections/index.tsx`
- `apps/web/src/app/page.tsx`
- `apps/web/src/app/[slug]/page.tsx`
- `apps/web/src/app/[slug]/[locale]/page.tsx`

## Execution summary

- No linked merged PR found.

## Key review notes

- No PR review notes found.
