---
artifactType: issue
issueNumber: 233
issueTitle: "feat(infra): automate CMS SSM secret generation"
issueUrl: "https://github.com/JesusFilm/forge/issues/233"
state: "CLOSED"
closedAt: "2026-03-06T05:11:17Z"
labels: ["feat", "infra"]
linkedPrs: []
scope: "platform"
---

# Issue Artifact: #233

## Background

The CMS Terraform stack currently creates SSM parameters for salts and keys with placeholder values and relies on manual AWS console updates. That breaks the Terraform-only infra rule and adds manual interruption to provisioning.

## Expected outcome

Terraform generates the required CMS salts/keys and writes them to SSM automatically during apply, without requiring manual console edits.

## Acceptance criteria

- [ ] CMS secret SSM parameters are provisioned without manual AWS console steps
- [ ] Generated secret values avoid being stored in Terraform state when supported by the configured Terraform/provider versions
- [ ] The implementation is explicit and parameterized within `infra/*`
- [ ] Existing consumers of the SSM parameters continue using the same parameter names

## Possible solution(s)

1. Upgrade Terraform requirements and use ephemeral secret generation plus AWS SSM write-only arguments
2. If write-only support is unavailable, fall back to state-backed random generation only with explicit acceptance of the tradeoff

## References

- `infra/aws/modules/cms/main.tf`
- `infra/aws/providers.tf`
- Terraform write-only arguments / ephemeral values docs

## Execution summary

- No linked merged PR found.

## Key review notes

- No PR review notes found.
