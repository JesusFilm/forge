---
artifactType: plan
sourceId: 257
sourceTitle: "perf(cms): speed up cms-deploy Docker build"
linkedPrs: []
scope: "cms"
---

# Plan Artifact: "perf(cms): speed up cms-deploy Docker build"

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

## References

- `.github/workflows/cms-deploy.yml`
- `apps/cms/Dockerfile`

## Source links

- PRs:
- None

## Review notes

- No PR review notes found.
