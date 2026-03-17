---
artifactType: plan
sourceId: 481
sourceTitle: "docs(cms): document shared key generation in env example"
linkedPrs: []
scope: "cms"
---

# Plan Artifact: "docs(cms): document shared key generation in env example"

## Objective

`apps/cms/.env.example` includes clear inline guidance for generating each shared key.

## Planned approach

1. Add per-variable comments with `openssl rand` commands for secrets and salts.
2. Add a short note for keys sourced externally (e.g. internal API token).

## Validation

- [ ] Each shared key in `apps/cms/.env.example` has a generation command or source note.
- [ ] Notes are concise and safe for local/dev setup.

## References

- Existing `apps/cms/.env.example`

## Source links

- PRs:
- None

## Review notes

- No PR review notes found.
