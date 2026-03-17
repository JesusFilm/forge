---
artifactType: plan
sourceId: 474
sourceTitle: "fix(web): restore next binary in Railway deploy for @forge/web"
linkedPrs: []
scope: "web"
---

# Plan Artifact: "fix(web): restore next binary in Railway deploy for @forge/web"

## Objective

`pnpm --filter @forge/web build` succeeds in CI/deploy environments and Railway deploy completes without `next` missing.

## Planned approach

1. Move required web build/runtime packages from `devDependencies` to `dependencies` in `apps/web/package.json`.
2. Ensure workspace filtering/build steps install package-level dependencies required for `next build`.

## Validation

- [ ] `@forge/web` declares required Next.js build/runtime dependencies correctly
- [ ] `pnpm --filter @forge/web build` succeeds locally/CI in a clean install context
- [ ] Railway deploy no longer fails with `next: not found`

## References

- Railway deploy failure `e71149b8`
- Log excerpt: `sh: 1: next: not found`

## Source links

- PRs:
- None

## Review notes

- No PR review notes found.
