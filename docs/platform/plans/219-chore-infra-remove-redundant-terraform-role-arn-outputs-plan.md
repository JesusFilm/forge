---
artifactType: plan
sourceId: 219
sourceTitle: "chore(infra): remove redundant terraform role arn outputs"
linkedPrs: []
scope: "platform"
---

# Plan Artifact: "chore(infra): remove redundant terraform role arn outputs"

## Objective

Those redundant outputs are removed anywhere they are still declared or surfaced in Terraform, so infra state reflects the current SSM-based flow.

## Planned approach

1. Remove the obsolete output blocks from the relevant Terraform modules/stacks.
2. Update any nearby references or comments that still imply consumers should read the values from Terraform outputs.

## Validation

- [ ] Terraform no longer defines those four role ARN outputs.
- [ ] Any references/docs tied to those outputs are updated if needed.
- [ ] Validation is run for touched Terraform files.

## References

- User request in Cursor chat on 2026-03-06

## Source links

- PRs:
- None

## Review notes

- No PR review notes found.
