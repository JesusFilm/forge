---
artifactType: issue
issueNumber: 192
issueTitle: "chore(infra): remove CMS module defaults; platform owns policy"
issueUrl: "https://github.com/JesusFilm/forge/issues/192"
state: "CLOSED"
closedAt: "2026-03-04T09:24:36Z"
labels: ["chore", "infra"]
linkedPrs: []
---

# Issue Artifact: #192

## Background

CMS module is only consumed by platform; platform passes all DB/config. Duplicate defaults in CMS caused drift (e.g. 16.4 vs 16.8). Single source of truth for policy should be the consumer (platform).

## Expected outcome

CMS module has no defaults for variables that platform supplies. Caller must pass all such values explicitly.

## Acceptance criteria

- [ ] CMS variables for db\_\*, tags, and other platform-supplied inputs have no `default` (except optional e.g. `db_master_user_secret_kms_key_id = null`).
- [ ] Platform continues to pass all values; terraform plan/apply unchanged behaviour.

## Possible solution(s)

Not provided in source issue.

## References

- Follow-up from #184 (RDS 16.8 fix); same branch had this refactor.

## Execution summary

- No linked merged PR found.

## Key review notes

- No PR review notes found.
