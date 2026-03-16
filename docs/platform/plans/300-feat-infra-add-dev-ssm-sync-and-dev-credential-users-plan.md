---
artifactType: plan
sourceIssueNumber: 300
sourceIssueTitle: "feat(infra): add dev SSM sync and dev credential users"
sourceIssueUrl: "https://github.com/JesusFilm/forge/issues/300"
linkedPrs: []
scope: "platform"
---

# Plan Artifact: #300

## Objective

A Terraform-managed dev credential access model and a local sync command that writes `.env.development.local` from SSM for development use.

## Planned approach

1. Create a dedicated IAM group with least-privilege SSM read + KMS decrypt access for dev parameter paths.
2. Add one Terraform file that defines contributor handles and uses `for_each` to create users and group membership.
3. Add a Node script using AWS SDK or AWS CLI to fetch parameters (with decryption where required) and render env output.

## Validation

- [ ] Existing IAM users are unchanged.
- [ ] New IAM group exists for dev credential SSM access.
- [ ] A single list-driven Terraform user file creates `<github>-dev-credentials` users.
- [ ] Contributor source is recent human contributors (last 12 months) with bots excluded.
- [ ] Sync command pulls String and SecureString values and writes `.env.development.local`.
- [ ] Docs include setup and usage.

## Source links

- Issue: [#300](https://github.com/JesusFilm/forge/issues/300)
- PRs:
- None
