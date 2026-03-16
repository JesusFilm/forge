---
artifactType: plan
sourceIssueNumber: 215
sourceIssueTitle: "feat(infra): move Vercel and GitHub secrets to scoped SSM reads"
sourceIssueUrl: "https://github.com/JesusFilm/forge/issues/215"
linkedPrs: []
scope: "platform"
---

# Plan Artifact: #215

## Objective

Vercel and GitHub infrastructure should stop depending on secret values flowing through Terraform state where possible, and instead read only the credentials they need from scoped SSM paths such as `/forge/vercel` and `/forge/github`.

## Planned approach

1. Replace current secret pass-through with SSM parameter lookups under `/forge/vercel` and `/forge/github`
2. Narrow IAM permissions for plan/apply principals to only the required SSM paths
3. Update Terraform modules, variables, and workflow wiring to remove unnecessary secret outputs/inputs

## Validation

- [ ] Vercel-related infra no longer depends on secret values being passed through Terraform state when a direct SSM read is available
- [ ] GitHub-related infra no longer depends on secret values being passed through Terraform state when a direct SSM read is available
- [ ] Access is restricted so each integration can read only its required scoped SSM path(s)
- [ ] Terraform config and CI assumptions are updated to match the new secret flow
- [ ] The resulting approach is documented in the PR description and validation steps

## Source links

- Issue: [#215](https://github.com/JesusFilm/forge/issues/215)
- PRs:
- None
