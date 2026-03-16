---
artifactType: plan
sourceIssueNumber: 233
sourceIssueTitle: "feat(infra): automate CMS SSM secret generation"
sourceIssueUrl: "https://github.com/JesusFilm/forge/issues/233"
linkedPrs: []
---

# Plan Artifact: #233

## Objective

Terraform generates the required CMS salts/keys and writes them to SSM automatically during apply, without requiring manual console edits.

## Planned approach

1. Upgrade Terraform requirements and use ephemeral secret generation plus AWS SSM write-only arguments
2. If write-only support is unavailable, fall back to state-backed random generation only with explicit acceptance of the tradeoff

## Validation

- [ ] CMS secret SSM parameters are provisioned without manual AWS console steps
- [ ] Generated secret values avoid being stored in Terraform state when supported by the configured Terraform/provider versions
- [ ] The implementation is explicit and parameterized within `infra/*`
- [ ] Existing consumers of the SSM parameters continue using the same parameter names

## Source links

- Issue: [#233](https://github.com/JesusFilm/forge/issues/233)
- PRs:
- None
