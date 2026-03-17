---
artifactType: plan
sourceId: 251
sourceTitle: "fix(cms-deploy): skip affected job on manual deploys"
linkedPrs: []
scope: "cms"
---

# Plan Artifact: "fix(cms-deploy): skip affected job on manual deploys"

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

## References

- Workflow: `.github/workflows/cms-deploy.yml`
- Earlier manual-dispatch issue: #243
- Current investigation PR: #250

## Source links

- PRs:
- None

## Review notes

- No PR review notes found.
