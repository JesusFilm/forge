---
artifactType: issue
issueNumber: 449
issueTitle: "fix(tooling): fetch-secrets writes CMS env to .env instead of .env.development.local"
issueUrl: "https://github.com/JesusFilm/forge/issues/449"
state: "CLOSED"
closedAt: "2026-03-13T02:27:48Z"
labels: ["tooling", "fix"]
linkedPrs: []
---

# Issue Artifact: #449

## Background

Strapi does not support `.env.development.local` — it only loads `.env`. The `scripts/fetch-secrets.ts` script currently writes all project secrets to `.env.development.local`, which means CMS secrets are never picked up by Strapi.

## Expected outcome

`fetch-secrets --project cms` writes to `.env` and `fetch-secrets --project web` continues writing to `.env.development.local` (Next.js convention).

## Acceptance criteria

- [ ] CMS secrets output to `.env`
- [ ] Web secrets still output to `.env.development.local`
- [ ] Log message reflects actual output filename

## Possible solution(s)

Add `envFile` to `ProjectConfig` and use it per-project.

## References

- Related: #447

## Execution summary

- No linked merged PR found.

## Key review notes

- No PR review notes found.
