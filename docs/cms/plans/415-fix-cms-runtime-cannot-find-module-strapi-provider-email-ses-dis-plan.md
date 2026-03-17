---
artifactType: plan
sourceId: 415
sourceTitle: "fix(cms): runtime Cannot find module strapi-provider-email-ses/dist/index.js"
linkedPrs: []
scope: "cms"
---

# Plan Artifact: "fix(cms): runtime Cannot find module strapi-provider-email-ses/dist/index.js"

## Objective

Strapi loads the SES email provider successfully at runtime in the Docker container.

## Planned approach

1. Change `"strapi-provider-email-ses": "file:providers/strapi-provider-email-ses"` to `"strapi-provider-email-ses": "link:providers/strapi-provider-email-ses"` in `apps/cms/package.json`. With `link:`, pnpm creates a symlink instead of copying, so `dist/index.js` built during `pnpm run build` is accessible at runtime.

## Validation

- [ ] Change `file:` to `link:` protocol for strapi-provider-email-ses dependency
- [ ] Regenerate lockfile
- [ ] Provider resolves correctly at runtime (symlink points to source directory where `dist/` is built)

## References

- Follow-up from #411
- `apps/cms/package.json` line 24
- `apps/cms/providers/strapi-provider-email-ses/package.json` — `"main": "dist/index.js"`

## Source links

- PRs:
- None

## Review notes

- No PR review notes found.
