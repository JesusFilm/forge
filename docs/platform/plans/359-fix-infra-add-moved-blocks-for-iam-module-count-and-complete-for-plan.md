---
artifactType: plan
sourceIssueNumber: 359
sourceIssueTitle: "fix(infra): add moved blocks for IAM module count and complete force_destroy permissions"
sourceIssueUrl: "https://github.com/JesusFilm/forge/issues/359"
linkedPrs: []
scope: "platform"
---

# Plan Artifact: #359

## Objective

`terraform apply` on prod succeeds — IAM resources are moved in-place (no destroy/recreate) and the role has all permissions needed for `force_destroy` user cleanup.

## Planned approach

Not provided in source issue.

## Validation

- [ ] `moved` blocks for all IAM resources (`module.iam.` → `module.iam[0].`)
- [ ] All `force_destroy` permissions added to `TerraformIamUserManagement`
- [ ] `DetachUserPolicy` and `DeleteUserPolicy` removed from deny
- [ ] CI apply succeeds

## Source links

- Issue: [#359](https://github.com/JesusFilm/forge/issues/359)
- PRs:
- None
