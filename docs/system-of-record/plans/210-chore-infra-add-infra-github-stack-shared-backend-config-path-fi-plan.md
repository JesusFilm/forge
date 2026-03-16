---
artifactType: plan
sourceIssueNumber: 210
sourceIssueTitle: "chore(infra): add infra/github stack, shared backend-config, path-filtered Terraform CI and comment actions"
sourceIssueUrl: "https://github.com/JesusFilm/forge/issues/210"
linkedPrs: []
---

# Plan Artifact: #210

## Objective

Not provided in source issue.

## Planned approach

Not provided in source issue.

## Validation

- [x] `infra/github/data.tf`: literal `bucket` and `region` in remote state config; no parsing of shared.hcl.
- [x] `.github/actions/terraform-plan-comment` and `.github/actions/terraform-apply-comment` exist and are used by workflows.
- [x] `terraform-plan.yml`: changes job outputs aws/vercel/github; plan-aws/plan-vercel/plan-github run only when respective paths change and PR approved; plan roles from secrets; use terraform-plan-comment action.
- [x] `terraform-apply.yml`: affected-infra uses paths-filter with github; apply-aws/apply-vercel/apply-github use env secrets and terraform-apply-comment; apply-github runs on main when infra/github changes.

## Source links

- Issue: [#210](https://github.com/JesusFilm/forge/issues/210)
- PRs:
- None
