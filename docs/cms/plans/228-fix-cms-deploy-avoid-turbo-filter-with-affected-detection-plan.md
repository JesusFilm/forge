---
artifactType: plan
sourceId: 228
sourceTitle: "fix(cms-deploy): avoid turbo filter with affected detection"
linkedPrs: []
scope: "cms"
---

# Plan Artifact: "fix(cms-deploy): avoid turbo filter with affected detection"

## Objective

`cms-deploy` detects affected workspaces successfully and deploys only when `@forge/cms` is actually part of the affected set.

## Planned approach

1. Run Turbo with `--affected --dry-run=json` and inspect returned tasks for `@forge/cms`.
2. Keep the existing fallback path for true Turbo/jq failures.
3. Align the implementation with the existing affected detection pattern already used in `ci.yml`.

## Validation

- [ ] `cms-deploy` no longer combines Turbo `--filter` with `--affected`.
- [ ] The workflow still sets `cms=true` when affected detection genuinely fails, to avoid false negatives.
- [ ] Validation covers the touched workflow logic.

## References

- Failed/succeeded fallback run: https://github.com/JesusFilm/forge/actions/runs/22748399405/job/65977216677
- `.github/workflows/cms-deploy.yml`
- `.github/workflows/ci.yml`
- Related issue #226

## Source links

- PRs:
- None

## Review notes

- No PR review notes found.
