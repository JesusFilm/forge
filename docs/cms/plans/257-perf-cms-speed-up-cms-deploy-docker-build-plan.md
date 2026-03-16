---
artifactType: plan
sourceIssueNumber: 257
sourceIssueTitle: "perf(cms): speed up cms-deploy Docker build"
sourceIssueUrl: "https://github.com/JesusFilm/forge/issues/257"
linkedPrs: []
scope: "cms"
---

# Plan Artifact: #257

## Objective

- Build reuses layers/cache when lockfile and app code unchanged.
- Smaller build context and faster install via cache mount where possible.

## Planned approach

1. Enable DOCKER_BUILDKIT=1 and use docker buildx with --cache-from=type=registry (or GitHub actions cache).
2. Add .dockerignore at repo root to shrink context and avoid accidental layer invalidation.
3. Optional: RUN --mount=type=cache,target=/pnpm/store for pnpm in Dockerfile.

## Validation

- [ ] Docker build uses BuildKit with cache (e.g. cache-from/cache-to or GitHub cache).
- [ ] Root .dockerignore excludes node_modules, .git, and other unneeded paths from context.
- [ ] No regression in image correctness or deploy flow.

## Source links

- Issue: [#257](https://github.com/JesusFilm/forge/issues/257)
- PRs:
- None
