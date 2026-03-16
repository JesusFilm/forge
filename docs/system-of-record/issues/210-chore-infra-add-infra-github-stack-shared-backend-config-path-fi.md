---
artifactType: issue
issueNumber: 210
issueTitle: "chore(infra): add infra/github stack, shared backend-config, path-filtered Terraform CI and comment actions"
issueUrl: "https://github.com/JesusFilm/forge/issues/210"
state: "CLOSED"
closedAt: "2026-03-05T11:20:29Z"
labels: ["chore", "infra"]
linkedPrs: []
---

# Issue Artifact: #210

## Background

1. **infra/github** remote state: The github stack should use a fixed S3 backend (prod state only; apply-github runs on main). Hardcode bucket and region instead of parsing backend-config with regex.
2. **Terraform CI**: Plan and apply workflows should run only for changed stacks (path filters: aws, vercel, github), use repo secrets for plan/apply role ARNs (from infra/github outputs), and post plan/apply results via reusable composite actions.

## Expected outcome

Not provided in source issue.

## Acceptance criteria

- [x] `infra/github/data.tf`: literal `bucket` and `region` in remote state config; no parsing of shared.hcl.
- [x] `.github/actions/terraform-plan-comment` and `.github/actions/terraform-apply-comment` exist and are used by workflows.
- [x] `terraform-plan.yml`: changes job outputs aws/vercel/github; plan-aws/plan-vercel/plan-github run only when respective paths change and PR approved; plan roles from secrets; use terraform-plan-comment action.
- [x] `terraform-apply.yml`: affected-infra uses paths-filter with github; apply-aws/apply-vercel/apply-github use env secrets and terraform-apply-comment; apply-github runs on main when infra/github changes.

## Possible solution(s)

Not provided in source issue.

## References

- `infra/github/data.tf`, `infra/backend-config/shared.hcl`
- `.github/workflows/terraform-plan.yml`, `.github/workflows/terraform-apply.yml`
- `.github/actions/terraform-plan-comment/`, `.github/actions/terraform-apply-comment/`

## Execution summary

- No linked merged PR found.

## Key review notes

- No PR review notes found.
