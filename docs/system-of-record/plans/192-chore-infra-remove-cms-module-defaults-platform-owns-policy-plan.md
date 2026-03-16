---
artifactType: plan
sourceIssueNumber: 192
sourceIssueTitle: "chore(infra): remove CMS module defaults; platform owns policy"
sourceIssueUrl: "https://github.com/JesusFilm/forge/issues/192"
linkedPrs: []
---

# Plan Artifact: #192

## Objective

CMS module has no defaults for variables that platform supplies. Caller must pass all such values explicitly.

## Planned approach

Not provided in source issue.

## Validation

- [ ] CMS variables for db\_\*, tags, and other platform-supplied inputs have no `default` (except optional e.g. `db_master_user_secret_kms_key_id = null`).
- [ ] Platform continues to pass all values; terraform plan/apply unchanged behaviour.

## Source links

- Issue: [#192](https://github.com/JesusFilm/forge/issues/192)
- PRs:
- None
