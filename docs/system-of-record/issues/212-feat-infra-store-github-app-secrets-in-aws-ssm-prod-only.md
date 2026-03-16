---
artifactType: issue
issueNumber: 212
issueTitle: "feat(infra): store GitHub App secrets in AWS SSM (prod only)"
issueUrl: "https://github.com/JesusFilm/forge/issues/212"
state: "CLOSED"
closedAt: "2026-03-05T09:44:07Z"
labels: ["feat", "infra"]
linkedPrs: []
---

# Issue Artifact: #212

## Background

GitHub provider for infra/github should use GitHub App auth (app id, installation id, PEM). Store these in AWS SSM Parameter Store in prod only so infra/github Terraform (run from CI with prod state role) can read them and configure the provider without passing tokens in env.

## Expected outcome

- SSM parameters in AWS prod: app id, installation id, app private key (SecureString).
- Created only when `environment == "prod"`; values supplied at apply time via variables.
- Terraform state role can read these parameters so infra/github apply (github-prod env) can use them for GitHub provider app_auth.

## Acceptance criteria

- [ ] infra/aws creates 3 SSM parameters (prod only) with paths e.g. `/forge/github/app_id`, `/forge/github/installation_id`, `/forge/github/app_private_key`.
- [ ] Variables for values (sensitive); lifecycle so value not overwritten when vars omitted on later runs.
- [ ] State role IAM policy allows `ssm:GetParameter` on `/forge/github/*`.
- [ ] infra/github uses AWS provider + data sources for the 3 params and configures GitHub provider with app_auth (app_id, installation_id, pem content).

## Possible solution(s)

1. infra/aws/github: new file (e.g. ssm.tf) with variables, aws_ssm_parameter (count = prod), lifecycle ignore_changes on value. Extend github_actions_terraform_state policy with SSM statement.
2. infra/github: required_providers aws, provider aws (region from var), data aws_ssm_parameter x3, provider github app_auth from data.

## References

- Existing: infra/github/providers.tf already references data.aws_ssm_parameter.github_pem (not yet defined).
- Apply job: .github/workflows/terraform-apply.yml apply-github uses TERRAFORM_STATE_ROLE_ARN (github-prod).

## Execution summary

- No linked merged PR found.

## Key review notes

- No PR review notes found.
