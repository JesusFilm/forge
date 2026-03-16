---
artifactType: plan
sourceIssueNumber: 449
sourceIssueTitle: "fix(tooling): fetch-secrets writes CMS env to .env instead of .env.development.local"
sourceIssueUrl: "https://github.com/JesusFilm/forge/issues/449"
linkedPrs: []
scope: "platform"
---

# Plan Artifact: #449

## Objective

`fetch-secrets --project cms` writes to `.env` and `fetch-secrets --project web` continues writing to `.env.development.local` (Next.js convention).

## Planned approach

Add `envFile` to `ProjectConfig` and use it per-project.

## Validation

- [ ] CMS secrets output to `.env`
- [ ] Web secrets still output to `.env.development.local`
- [ ] Log message reflects actual output filename

## Source links

- Issue: [#449](https://github.com/JesusFilm/forge/issues/449)
- PRs:
- None
