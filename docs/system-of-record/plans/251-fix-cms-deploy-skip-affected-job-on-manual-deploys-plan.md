---
artifactType: plan
sourceIssueNumber: 251
sourceIssueTitle: "fix(cms-deploy): skip affected job on manual deploys"
sourceIssueUrl: "https://github.com/JesusFilm/forge/issues/251"
linkedPrs: []
---

# Plan Artifact: #251

## Objective

Manual `workflow_dispatch` runs skip the `affected` job completely, and the deploy job runs only when the dispatched branch is `main` or `stage`. Push-triggered runs continue using the existing affected-based gate.

## Planned approach

1. Add a job-level `if` to skip `affected` on `workflow_dispatch`.
2. Update the deploy job condition to allow either a supported manual dispatch or a push event with `affected == true`.
3. Use `always()` in the deploy condition so a skipped `affected` job does not block valid manual runs.

## Validation

- [ ] `affected` does not run for `workflow_dispatch` events.
- [ ] `deploy` can run for `workflow_dispatch` only when `github.ref_name` is `main` or `stage`.
- [ ] Push-triggered runs still require `needs.affected.outputs.cms == 'true'`.
- [ ] Unsupported manual branches do not deploy.

## Source links

- Issue: [#251](https://github.com/JesusFilm/forge/issues/251)
- PRs:
- None
