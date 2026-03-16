---
artifactType: plan
sourceIssueNumber: 424
sourceIssueTitle: "fix(infra): kms:ResourceAliases condition missing ForAnyValue set operator"
sourceIssueUrl: "https://github.com/JesusFilm/forge/issues/424"
linkedPrs: []
scope: "platform"
---

# Plan Artifact: #424

## Objective

`pnpm fetch-secrets` succeeds for dev-secrets users using long-lived access keys.

## Planned approach

1. Change `test = "StringLike"` to `test = "ForAnyValue:StringLike"` in `infra/aws/iam/groups/dev_secrets/main.tf`

## Validation

- [ ] `kms:ResourceAliases` condition uses `ForAnyValue:StringLike` instead of `StringLike`
- [ ] `pnpm fetch-secrets` succeeds after `terraform apply`

## Source links

- Issue: [#424](https://github.com/JesusFilm/forge/issues/424)
- PRs:
- None
