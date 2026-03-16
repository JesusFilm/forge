---
artifactType: issue
issueNumber: 343
issueTitle: "docs(infra): clarify dev-secrets onboarding apply job"
issueUrl: "https://github.com/JesusFilm/forge/issues/343"
state: "CLOSED"
closedAt: "2026-03-10T22:35:42Z"
labels: ["docs", "infra"]
linkedPrs: []
scope: "platform"
---

# Issue Artifact: #343

## Background

The dev-secrets onboarding guide says to wait for `github-prod` deployment, but IAM user creation only depends on the `aws-prod` apply job.

## Expected outcome

Onboarding docs clearly instruct developers/admins to wait for `aws-prod` apply from `main` before attempting IAM login setup.

## Acceptance criteria

- [ ] Developer steps reference `aws-prod` apply (not `github-prod` deploy)
- [ ] Admin steps reference `aws-prod` apply (not `github-prod` deploy)
- [ ] Wording is consistent in `infra/aws/iam/users/dev_secrets/README.md`

## Possible solution(s)

1. Replace both `github-prod` references with `aws-prod` apply wording
2. Keep wording concise and action-oriented

## References

- Follow-up from merged PR #303

## Execution summary

- No linked merged PR found.

## Key review notes

- No PR review notes found.
