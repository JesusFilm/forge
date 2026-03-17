---
artifactType: plan
sourceId: 449
sourceTitle: "fix(tooling): fetch-secrets writes CMS env to .env instead of .env.development.local"
linkedPrs: []
scope: "platform"
---

# Plan Artifact: "fix(tooling): fetch-secrets writes CMS env to .env instead of .env.development.local"

## Objective

`fetch-secrets --project cms` writes to `.env` and `fetch-secrets --project web` continues writing to `.env.development.local` (Next.js convention).

## Planned approach

Add `envFile` to `ProjectConfig` and use it per-project.

## Validation

- [ ] CMS secrets output to `.env`
- [ ] Web secrets still output to `.env.development.local`
- [ ] Log message reflects actual output filename

## References

- Related: #447

## Source links

- PRs:
- None

## Review notes

- No PR review notes found.
