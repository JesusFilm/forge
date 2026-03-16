---
artifactType: issue
issueNumber: 251
issueTitle: "fix(cms-deploy): skip affected job on manual deploys"
issueUrl: "https://github.com/JesusFilm/forge/issues/251"
state: "CLOSED"
closedAt: "2026-03-06T07:36:18Z"
labels: []
linkedPrs: []
scope: "cms"
---

# Issue Artifact: #251

## Background

`cms-deploy` now supports `workflow_dispatch`, but the current behavior still routes through the `affected` path instead of cleanly bypassing it for manual runs. We want manual deploys to avoid the `affected` job entirely and only allow the deploy path when the dispatched ref is `main` or `stage`.

## Expected outcome

Manual `workflow_dispatch` runs skip the `affected` job completely, and the deploy job runs only when the dispatched branch is `main` or `stage`. Push-triggered runs continue using the existing affected-based gate.

## Acceptance criteria

- [ ] `affected` does not run for `workflow_dispatch` events.
- [ ] `deploy` can run for `workflow_dispatch` only when `github.ref_name` is `main` or `stage`.
- [ ] Push-triggered runs still require `needs.affected.outputs.cms == 'true'`.
- [ ] Unsupported manual branches do not deploy.

## Possible solution(s)

1. Add a job-level `if` to skip `affected` on `workflow_dispatch`.
2. Update the deploy job condition to allow either a supported manual dispatch or a push event with `affected == true`.
3. Use `always()` in the deploy condition so a skipped `affected` job does not block valid manual runs.

## References

- Workflow: `.github/workflows/cms-deploy.yml`
- Earlier manual-dispatch issue: #243
- Current investigation PR: #250

## Execution summary

- No linked merged PR found.

## Key review notes

- No PR review notes found.
