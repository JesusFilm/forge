---
artifactType: plan
sourceIssueNumber: 415
sourceIssueTitle: "fix(cms): runtime Cannot find module strapi-provider-email-ses/dist/index.js"
sourceIssueUrl: "https://github.com/JesusFilm/forge/issues/415"
linkedPrs: []
---

# Plan Artifact: #415

## Objective

Strapi loads the SES email provider successfully at runtime in the Docker container.

## Planned approach

1. Change `"strapi-provider-email-ses": "file:providers/strapi-provider-email-ses"` to `"strapi-provider-email-ses": "link:providers/strapi-provider-email-ses"` in `apps/cms/package.json`. With `link:`, pnpm creates a symlink instead of copying, so `dist/index.js` built during `pnpm run build` is accessible at runtime.

## Validation

- [ ] Change `file:` to `link:` protocol for strapi-provider-email-ses dependency
- [ ] Regenerate lockfile
- [ ] Provider resolves correctly at runtime (symlink points to source directory where `dist/` is built)

## Source links

- Issue: [#415](https://github.com/JesusFilm/forge/issues/415)
- PRs:
- None
