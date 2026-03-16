---
artifactType: issue
issueNumber: 228
issueTitle: "fix(cms-deploy): avoid turbo filter with affected detection"
issueUrl: "https://github.com/JesusFilm/forge/issues/228"
state: "CLOSED"
closedAt: "2026-03-06T04:04:24Z"
labels: []
linkedPrs: []
---

# Issue Artifact: #228

## Background

The `cms-deploy` workflow currently runs `pnpm turbo run lint --filter=@forge/cms --affected --dry-run=json` to detect whether CMS changed. Current Turbo rejects combining `--filter` with `--affected`, so affected detection fails and the workflow falls back to `cms=true`, forcing deploys on unrelated changes.

## Expected outcome

`cms-deploy` detects affected workspaces successfully and deploys only when `@forge/cms` is actually part of the affected set.

## Acceptance criteria

- [ ] `cms-deploy` no longer combines Turbo `--filter` with `--affected`.
- [ ] The workflow still sets `cms=true` when affected detection genuinely fails, to avoid false negatives.
- [ ] Validation covers the touched workflow logic.

## Possible solution(s)

1. Run Turbo with `--affected --dry-run=json` and inspect returned tasks for `@forge/cms`.
2. Keep the existing fallback path for true Turbo/jq failures.
3. Align the implementation with the existing affected detection pattern already used in `ci.yml`.

## References

- Failed/succeeded fallback run: https://github.com/JesusFilm/forge/actions/runs/22748399405/job/65977216677
- `.github/workflows/cms-deploy.yml`
- `.github/workflows/ci.yml`
- Related issue #226

## Execution summary

- No linked merged PR found.

## Key review notes

- No PR review notes found.
