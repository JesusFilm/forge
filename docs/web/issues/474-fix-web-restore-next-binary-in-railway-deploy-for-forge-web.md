---
artifactType: issue
issueNumber: 474
issueTitle: "fix(web): restore next binary in Railway deploy for @forge/web"
issueUrl: "https://github.com/JesusFilm/forge/issues/474"
state: "CLOSED"
closedAt: "2026-03-15T23:24:05Z"
labels: ["fix", "web"]
linkedPrs: []
scope: "web"
---

# Issue Artifact: #474

## Background

Railway production deploy for `@forge/web` fails during `pnpm --filter @forge/web build` with `sh: 1: next: not found`. This indicates web package runtime/build dependencies are not being resolved in the deploy environment.

## Expected outcome

`pnpm --filter @forge/web build` succeeds in CI/deploy environments and Railway deploy completes without `next` missing.

## Acceptance criteria

- [ ] `@forge/web` declares required Next.js build/runtime dependencies correctly
- [ ] `pnpm --filter @forge/web build` succeeds locally/CI in a clean install context
- [ ] Railway deploy no longer fails with `next: not found`

## Possible solution(s)

1. Move required web build/runtime packages from `devDependencies` to `dependencies` in `apps/web/package.json`.
2. Ensure workspace filtering/build steps install package-level dependencies required for `next build`.

## References

- Railway deploy failure `e71149b8`
- Log excerpt: `sh: 1: next: not found`

## Execution summary

- No linked merged PR found.

## Key review notes

- No PR review notes found.
