---
artifactType: issue
issueNumber: 257
issueTitle: "perf(cms): speed up cms-deploy Docker build"
issueUrl: "https://github.com/JesusFilm/forge/issues/257"
state: "CLOSED"
closedAt: "2026-03-06T09:37:48Z"
labels: []
linkedPrs: []
---

# Issue Artifact: #257

## Background

cms-deploy Docker build is slow: pnpm install ~16s, strapi build (admin panel) ~26s. No BuildKit cache or .dockerignore; every run is cold.

## Expected outcome

- Build reuses layers/cache when lockfile and app code unchanged.
- Smaller build context and faster install via cache mount where possible.

## Acceptance criteria

- [ ] Docker build uses BuildKit with cache (e.g. cache-from/cache-to or GitHub cache).
- [ ] Root .dockerignore excludes node_modules, .git, and other unneeded paths from context.
- [ ] No regression in image correctness or deploy flow.

## Possible solution(s)

1. Enable DOCKER_BUILDKIT=1 and use docker buildx with --cache-from=type=registry (or GitHub actions cache).
2. Add .dockerignore at repo root to shrink context and avoid accidental layer invalidation.
3. Optional: RUN --mount=type=cache,target=/pnpm/store for pnpm in Dockerfile.

## References

- `.github/workflows/cms-deploy.yml`
- `apps/cms/Dockerfile`

## Execution summary

- No linked merged PR found.

## Key review notes

- No PR review notes found.
