---
artifactType: issue
issueNumber: 359
issueTitle: "fix(infra): add moved blocks for IAM module count and complete force_destroy permissions"
issueUrl: "https://github.com/JesusFilm/forge/issues/359"
state: "CLOSED"
closedAt: "2026-03-11T01:31:51Z"
labels: ["fix", "infra"]
linkedPrs: []
---

# Issue Artifact: #359

## Background

Follow-up to #356. Two remaining issues block `terraform apply` on prod:

1. **Missing `moved` blocks**: `module.iam` gained `count` (line 71 of `main.tf`), changing all resource addresses from `module.iam.X` to `module.iam[0].X`. Without `moved` blocks, Terraform destroys and recreates all IAM resources. The old `tataihono.nikora@jesusfilm.org` has `force_destroy = false` in state, so Terraform can't clean up the login profile before deletion.

2. **Incomplete `force_destroy` permissions**: The AWS provider's `force_destroy` cleanup chain needs more than just `ListAccessKeys`/`DeleteAccessKey`. It also enumerates and deletes SSH public keys, signing certificates, service-specific credentials, and MFA devices. `ListSSHPublicKeys` is the immediate blocker. Additionally `DetachUserPolicy` and `DeleteUserPolicy` are still in the deny statement but needed for user cleanup.

## Expected outcome

`terraform apply` on prod succeeds — IAM resources are moved in-place (no destroy/recreate) and the role has all permissions needed for `force_destroy` user cleanup.

## Acceptance criteria

- [ ] `moved` blocks for all IAM resources (`module.iam.` → `module.iam[0].`)
- [ ] All `force_destroy` permissions added to `TerraformIamUserManagement`
- [ ] `DetachUserPolicy` and `DeleteUserPolicy` removed from deny
- [ ] CI apply succeeds

## Possible solution(s)

Not provided in source issue.

## References

- #356 (partial fix)
- CI log: `iam:ListSSHPublicKeys` AccessDenied
- CI log: `DeleteConflict: must delete login profile first` (tataihono, force_destroy=false in old state)

## Execution summary

- No linked merged PR found.

## Key review notes

- No PR review notes found.
