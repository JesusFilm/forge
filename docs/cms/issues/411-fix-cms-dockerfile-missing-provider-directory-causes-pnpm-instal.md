---
artifactType: issue
issueNumber: 411
issueTitle: "fix(cms): Dockerfile missing provider directory causes pnpm install ENOENT"
issueUrl: "https://github.com/JesusFilm/forge/issues/411"
state: "CLOSED"
closedAt: "2026-03-12T02:14:54Z"
labels: ["fix", "cms"]
linkedPrs: []
scope: "cms"
---

# Issue Artifact: #411

## Background

The CMS Dockerfile copies only `apps/cms/package.json` before running `pnpm install`. The package.json has a `file:` dependency on `providers/strapi-provider-email-ses`, but that directory isn't copied until later — causing `ENOENT: no such file or directory, scandir '/workspace/apps/cms/providers/strapi-provider-email-ses'`.

## Expected outcome

Docker build completes `pnpm install` step successfully by having the provider's `package.json` available before install.

## Acceptance criteria

- [x] Provider package.json is copied before `pnpm install` in Dockerfile
- [x] Docker build passes the install step without ENOENT

## Possible solution(s)

1. Add `COPY apps/cms/providers/strapi-provider-email-ses/package.json apps/cms/providers/strapi-provider-email-ses/package.json` before the `pnpm install` RUN step.

## References

- `apps/cms/Dockerfile`
- `apps/cms/package.json` line 24: `\"strapi-provider-email-ses\": \"file:providers/strapi-provider-email-ses\"`

## Execution summary

- No linked merged PR found.

## Key review notes

- No PR review notes found.
