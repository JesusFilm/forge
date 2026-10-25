# PR #2783 review round 1 repairs

Base exactly on `7b9d30865e320ad178ab092604dc50dd829fe536` from `origin/feat/watch-audience-editor`; preserve the stage 5 concurrency, Auth, migration and schema repairs. This implements the five confirmed findings under feat-744.

1. Reproduce omitted transitive workspace packaging with a dependency-closure regression; copy feature-flags manifests/source in Admin's Dockerfile and include it in both image workflow filters. Execute the CI Docker build and shared web/worker image verification where daemon access permits.
2. Reproduce duplicate-host destination disagreement without network access. Reject ambiguous connection destinations, cover effective pg parsing, and prove dry/apply refuse before loading the DB client or staging a draft.
3. Render authored Arabic and LTR questions with the published source locale/direction. Keep code fallback, static English controls and resources explicitly English; preserve authored copy and source fallback semantics.
4. Replace superseded publication E2E assumptions with the compact home role band, external video tabs and genuine hosted-Auth Partner session. Keep public-projection/draft isolation and session-free cached HTML assertions.
5. Reproduce home prefetch/loading behavior against exact main and the pinned editor head with matched production loads. Add a minimal scoped prefetch fix only with red/green evidence; retain before/after distributions, request/chunk/write observations and mount limits.

Run focused red/green tests, then Admin/Web/Auth/shared-package strict lint, types, formatting, schema print/introspection zero drift, real disposable PostgreSQL publication/import/finder/progress suites, Admin/Web production builds, actual Admin image and matched loading checks. No importer CLI execution, live publication, external configuration/flag changes, merge, deploy or production writes. Push only the editor branch with the exact starting-head lease; prefer fast-forward commits. Record evidence and unresolved environment limits in feat-744; review remains outstanding after implementation.
