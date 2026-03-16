---
artifactType: plan
sourceIssueNumber: 474
sourceIssueTitle: "fix(web): restore next binary in Railway deploy for @forge/web"
sourceIssueUrl: "https://github.com/JesusFilm/forge/issues/474"
linkedPrs: []
scope: "web"
---

# Plan Artifact: #474

## Objective

`pnpm --filter @forge/web build` succeeds in CI/deploy environments and Railway deploy completes without `next` missing.

## Planned approach

1. Move required web build/runtime packages from `devDependencies` to `dependencies` in `apps/web/package.json`.
2. Ensure workspace filtering/build steps install package-level dependencies required for `next build`.

## Validation

- [ ] `@forge/web` declares required Next.js build/runtime dependencies correctly
- [ ] `pnpm --filter @forge/web build` succeeds locally/CI in a clean install context
- [ ] Railway deploy no longer fails with `next: not found`

## Source links

- Issue: [#474](https://github.com/JesusFilm/forge/issues/474)
- PRs:
- None
