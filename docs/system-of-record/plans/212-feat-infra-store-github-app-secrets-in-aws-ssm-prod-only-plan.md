---
artifactType: plan
sourceIssueNumber: 212
sourceIssueTitle: "feat(infra): store GitHub App secrets in AWS SSM (prod only)"
sourceIssueUrl: "https://github.com/JesusFilm/forge/issues/212"
linkedPrs: []
---

# Plan Artifact: #212

## Objective

- SSM parameters in AWS prod: app id, installation id, app private key (SecureString).
- Created only when `environment == "prod"`; values supplied at apply time via variables.
- Terraform state role can read these parameters so infra/github apply (github-prod env) can use them for GitHub provider app_auth.

## Planned approach

1. infra/aws/github: new file (e.g. ssm.tf) with variables, aws_ssm_parameter (count = prod), lifecycle ignore_changes on value. Extend github_actions_terraform_state policy with SSM statement.
2. infra/github: required_providers aws, provider aws (region from var), data aws_ssm_parameter x3, provider github app_auth from data.

## Validation

- [ ] infra/aws creates 3 SSM parameters (prod only) with paths e.g. `/forge/github/app_id`, `/forge/github/installation_id`, `/forge/github/app_private_key`.
- [ ] Variables for values (sensitive); lifecycle so value not overwritten when vars omitted on later runs.
- [ ] State role IAM policy allows `ssm:GetParameter` on `/forge/github/*`.
- [ ] infra/github uses AWS provider + data sources for the 3 params and configures GitHub provider with app_auth (app_id, installation_id, pem content).

## Source links

- Issue: [#212](https://github.com/JesusFilm/forge/issues/212)
- PRs:
- None
