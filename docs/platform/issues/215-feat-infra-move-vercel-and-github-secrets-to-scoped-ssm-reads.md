---
artifactType: issue
issueNumber: 215
issueTitle: "feat(infra): move Vercel and GitHub secrets to scoped SSM reads"
issueUrl: "https://github.com/JesusFilm/forge/issues/215"
state: "CLOSED"
closedAt: "2026-03-05T23:23:35Z"
labels: ["feat", "infra"]
linkedPrs: []
scope: "platform"
---

# Issue Artifact: #215

## Background

Terraform currently appears to pass secrets through state into Vercel and GitHub-related configuration. That increases state sensitivity and broadens who can read secrets via plan/apply access.

## Expected outcome

Vercel and GitHub infrastructure should stop depending on secret values flowing through Terraform state where possible, and instead read only the credentials they need from scoped SSM paths such as `/forge/vercel` and `/forge/github`.

## Acceptance criteria

- [ ] Vercel-related infra no longer depends on secret values being passed through Terraform state when a direct SSM read is available
- [ ] GitHub-related infra no longer depends on secret values being passed through Terraform state when a direct SSM read is available
- [ ] Access is restricted so each integration can read only its required scoped SSM path(s)
- [ ] Terraform config and CI assumptions are updated to match the new secret flow
- [ ] The resulting approach is documented in the PR description and validation steps

## Possible solution(s)

1. Replace current secret pass-through with SSM parameter lookups under `/forge/vercel` and `/forge/github`
2. Narrow IAM permissions for plan/apply principals to only the required SSM paths
3. Update Terraform modules, variables, and workflow wiring to remove unnecessary secret outputs/inputs

## References

- User request to stop passing secrets via state and use scoped SSM access instead
- Relevant areas: `infra/aws`, `infra/vercel`, `.github/workflows/terraform-plan.yml`

## Execution summary

- No linked merged PR found.

## Key review notes

- No PR review notes found.
