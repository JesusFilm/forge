---
artifactType: issue
issueNumber: 415
issueTitle: "fix(cms): runtime Cannot find module strapi-provider-email-ses/dist/index.js"
issueUrl: "https://github.com/JesusFilm/forge/issues/415"
state: "CLOSED"
closedAt: "2026-03-12T02:30:28Z"
labels: ["fix", "cms"]
linkedPrs: []
scope: "cms"
---

# Issue Artifact: #415

## Background

After #411/#412 fixed the ENOENT during `pnpm install`, a runtime error occurs:

```
Error: Cannot find module '/workspace/node_modules/.pnpm/node_modules/strapi-provider-email-ses/dist/index.js'
```

Root cause: pnpm's `file:` protocol **copies** the package into the content-addressable store at install time. At that point only `package.json` exists — `dist/` is built later by `pnpm run build`. The store copy never gets `dist/index.js`, so Strapi can't load the provider at runtime.

## Expected outcome

Strapi loads the SES email provider successfully at runtime in the Docker container.

## Acceptance criteria

- [ ] Change `file:` to `link:` protocol for strapi-provider-email-ses dependency
- [ ] Regenerate lockfile
- [ ] Provider resolves correctly at runtime (symlink points to source directory where `dist/` is built)

## Possible solution(s)

1. Change `"strapi-provider-email-ses": "file:providers/strapi-provider-email-ses"` to `"strapi-provider-email-ses": "link:providers/strapi-provider-email-ses"` in `apps/cms/package.json`. With `link:`, pnpm creates a symlink instead of copying, so `dist/index.js` built during `pnpm run build` is accessible at runtime.

## References

- Follow-up from #411
- `apps/cms/package.json` line 24
- `apps/cms/providers/strapi-provider-email-ses/package.json` — `"main": "dist/index.js"`

## Execution summary

- No linked merged PR found.

## Key review notes

- No PR review notes found.
