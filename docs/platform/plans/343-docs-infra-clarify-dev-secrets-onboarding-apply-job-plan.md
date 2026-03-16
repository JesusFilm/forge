---
artifactType: plan
sourceIssueNumber: 343
sourceIssueTitle: "docs(infra): clarify dev-secrets onboarding apply job"
sourceIssueUrl: "https://github.com/JesusFilm/forge/issues/343"
linkedPrs: []
scope: "platform"
---

# Plan Artifact: #343

## Objective

Onboarding docs clearly instruct developers/admins to wait for `aws-prod` apply from `main` before attempting IAM login setup.

## Planned approach

1. Replace both `github-prod` references with `aws-prod` apply wording
2. Keep wording concise and action-oriented

## Validation

- [ ] Developer steps reference `aws-prod` apply (not `github-prod` deploy)
- [ ] Admin steps reference `aws-prod` apply (not `github-prod` deploy)
- [ ] Wording is consistent in `infra/aws/iam/users/dev_secrets/README.md`

## Source links

- Issue: [#343](https://github.com/JesusFilm/forge/issues/343)
- PRs:
- None
