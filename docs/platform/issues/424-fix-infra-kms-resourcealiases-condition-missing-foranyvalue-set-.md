---
artifactType: issue
issueNumber: 424
issueTitle: "fix(infra): kms:ResourceAliases condition missing ForAnyValue set operator"
issueUrl: "https://github.com/JesusFilm/forge/issues/424"
state: "CLOSED"
closedAt: "2026-03-12T02:53:45Z"
labels: ["fix", "infra"]
linkedPrs: []
scope: "platform"
---

# Issue Artifact: #424

## Background

The `forge-dev-secrets` IAM group policy grants `kms:Decrypt` using a `StringLike` condition on `kms:ResourceAliases`. However, `kms:ResourceAliases` is a **multi-valued condition key** — AWS requires a `ForAnyValue:` or `ForAllValues:` set operator prefix. Without it, the condition silently fails to match and no allow is granted.

Previous fixes (#405, #406, #413) corrected the MFA deny policy for access-key and cross-service requests, but `pnpm fetch-secrets` still fails with `AccessDeniedException` on `kms:Decrypt` because the **allow** policy never matches.

## Expected outcome

`pnpm fetch-secrets` succeeds for dev-secrets users using long-lived access keys.

## Acceptance criteria

- [ ] `kms:ResourceAliases` condition uses `ForAnyValue:StringLike` instead of `StringLike`
- [ ] `pnpm fetch-secrets` succeeds after `terraform apply`

## Possible solution(s)

1. Change `test = "StringLike"` to `test = "ForAnyValue:StringLike"` in `infra/aws/iam/groups/dev_secrets/main.tf`

## References

- Policy: `infra/aws/iam/groups/dev_secrets/main.tf` (line 38-44)
- AWS docs: [kms:ResourceAliases](https://docs.aws.amazon.com/kms/latest/developerguide/conditions-kms.html#conditions-kms-resource-aliases)
- Related (closed): #405

## Execution summary

- No linked merged PR found.

## Key review notes

- No PR review notes found.
