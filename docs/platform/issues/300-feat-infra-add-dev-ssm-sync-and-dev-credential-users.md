---
artifactType: issue
issueNumber: 300
issueTitle: "feat(infra): add dev SSM sync and dev credential users"
issueUrl: "https://github.com/JesusFilm/forge/issues/300"
state: "CLOSED"
closedAt: "2026-03-10T22:31:24Z"
labels: ["feat", "infra"]
linkedPrs: []
scope: "platform"
---

# Issue Artifact: #300

## Background

Developers and agents need a repeatable way to pull AWS SSM parameters (String and SecureString) into local dev environments. We also need IAM user provisioning for active contributors using a consistent `<github>-dev-credentials` username pattern.

## Expected outcome

A Terraform-managed dev credential access model and a local sync command that writes `.env.development.local` from SSM for development use.

## Acceptance criteria

- [ ] Existing IAM users are unchanged.
- [ ] New IAM group exists for dev credential SSM access.
- [ ] A single list-driven Terraform user file creates `<github>-dev-credentials` users.
- [ ] Contributor source is recent human contributors (last 12 months) with bots excluded.
- [ ] Sync command pulls String and SecureString values and writes `.env.development.local`.
- [ ] Docs include setup and usage.

## Possible solution(s)

1. Create a dedicated IAM group with least-privilege SSM read + KMS decrypt access for dev parameter paths.
2. Add one Terraform file that defines contributor handles and uses `for_each` to create users and group membership.
3. Add a Node script using AWS SDK or AWS CLI to fetch parameters (with decryption where required) and render env output.

## References

- `infra/aws/iam/users/`
- `infra/aws/github/ssm.tf`
- `infra/aws/vercel/ssm.tf`
- `infra/aws/README.md`

## Execution summary

- No linked merged PR found.

## Key review notes

- No PR review notes found.
