---
title: "Carry watch-page feature flags through Next.js route migrations"
date: "2026-05-28"
category: "workflow-issues"
module: "apps/web watch routing"
problem_type: "workflow_issue"
component: "development_workflow"
severity: "medium"
applies_when:
  - "A feature branch touches a Next.js App Router route file that main deleted, renamed, or replaced with a catch-all route"
  - "A watch-page feature flag is evaluated in a server route and the URL contract changed on main"
  - "Typecheck fails from stale .next/dev/types entries after resolving route conflicts"
symptoms:
  - "git merge reports modify/delete conflicts on an old App Router route and its route tests"
  - "Route tests still target a deleted [slug]/[locale] path after main moved behavior into [slug]/[...rest]"
  - "Typecheck references a deleted route from .next/dev/types/validator.ts after next typegen"
root_cause: "missing_workflow_step"
resolution_type: "workflow_improvement"
related_components:
  - "apps/web/src/app/[slug]/[...rest]/page.tsx"
  - "apps/web/src/app/[slug]/[...rest]/__tests__/page-routing.test.tsx"
  - "@forge/feature-flags"
tags:
  - "launchdarkly"
  - "watch-route"
  - "nextjs"
  - "merge-conflicts"
  - "feature-flags"
  - "browser-smoke"
  - "generated-types"
---

# Carry watch-page feature flags through Next.js route migrations

## Context

PR #1045 added a temporary LaunchDarkly-backed watch CTA smoke flag,
`forge.watch.ctaTextCopy`, that changes the visible download button copy from
`Download` to `Save Video`. The first implementation landed the route-level
flag read in `apps/web/src/app/[slug]/[locale]/page.tsx`.

While that PR was open, `main` merged the /watch URL restructure and replaced
the old `[slug]/[locale]` route with the catch-all dispatcher at
`apps/web/src/app/[slug]/[...rest]/page.tsx`. Merging `origin/main` produced
modify/delete conflicts on both the old route and the old route test. The fix
was not to keep the deleted files; it was to port the flag seam into the new
route owner and cover both dispatch branches.

Codex session history also showed the follow-on local validation trap: after the
merge was resolved, `pnpm --filter @forge/web typecheck` still read stale
generated route validators from `.next/dev/types/validator.ts`, even after
`pnpm --filter @forge/web exec next typegen` refreshed `.next/types`.
(session history)

## Guidance

Treat a modify/delete conflict on a Next.js route as an ownership change until
proven otherwise. Read the route that replaced it, identify the new dispatcher
and prop handoff, then move the behavior to the new owner instead of restoring a
deleted path.

For the LaunchDarkly CTA flag, the catch-all route became the correct server
boundary:

```ts
async function getDownloadButtonLabel(route: string): Promise<string> {
  const useUpdatedCtaCopy = await isWatchCtaTextCopyEnabled({
    custom: { route },
  })
  return useUpdatedCtaCopy ? "Save Video" : "Download"
}
```

Thread the label at the point each route branch has resolved the playable video
and is about to render `WatchPageClient`:

```ts
const downloadButtonLabel = await getDownloadButtonLabel(
  `/watch/${slug}.html/${rawLocale}.html`,
)

return (
  <WatchPageClient
    downloadButtonLabel={downloadButtonLabel}
    mergedBlocks={mergedBlocks}
    variant={watchVideo.selectedVariant}
    video={watchVideo.video}
    languageSlug={watchVideo.selectedVariant.language?.slug ?? rawLocale}
    locale={locale}
  />
)
```

For the episode branch, pass the full three-segment canonical route:

```ts
const downloadButtonLabel = await getDownloadButtonLabel(
  `/watch/${seriesSlug}.html/${episodeSlug}/${rawLocale}.html`,
)
```

Tests should follow the new dispatcher shape, not the deleted route shape. Add
coverage for every branch that renders `WatchPageClient`:

```ts
isWatchCtaTextCopyEnabledMock.mockResolvedValue(true)

await render3Seg(
  "lumo-the-gospel-of-john.html",
  "wedding-in-cana",
  "english.html",
)

expect(isWatchCtaTextCopyEnabledMock).toHaveBeenCalledWith({
  custom: {
    route: "/watch/lumo-the-gospel-of-john.html/wedding-in-cana/english.html",
  },
})
expect(watchPageClientMock.mock.calls[0]?.[0]).toEqual(
  expect.objectContaining({
    downloadButtonLabel: "Save Video",
  }),
)
```

When typecheck keeps referencing deleted route files after a route move, inspect
the generated paths before touching source. In this case the source conflicts
were gone, but `apps/web/tsconfig.json` includes both `.next/types/**/*.ts` and
`.next/dev/types/**/*.ts`. `next typegen` refreshed the former; the stale error
was in the latter. Removing only the ignored generated cache directory
`.next/dev/types` let the next typecheck rebuild against the current route tree.
(session history)

## Why This Matters

Feature flags are often wired at route boundaries because the server route has
request context, URL shape, and access to server-only SDK keys. That also makes
them vulnerable to concurrent route migrations. Keeping the old file during a
modify/delete conflict can make the branch compile against a route that `main`
no longer owns, and worse, it can leave tests proving behavior on a path that is
no longer executable.

The generated-type issue is similarly subtle. Source control can be conflict
free while local typecheck still fails on stale Next output. The useful rule is
to delete generated caches only after confirming the failing path is under
`.next/`, not to paper over the source route or loosen TypeScript includes.

## When to Apply

- A branch added route-level behavior and `main` changed the App Router file
  tree underneath it.
- A `/watch` route change introduces or consumes feature flag context based on
  canonical route strings.
- Focused route tests still name `[slug]/[locale]` while current `main` routes
  through `[slug]/[...rest]`.
- Typecheck reports deleted App Router files from `.next/dev/types` after
  conflicts are resolved.

## Examples

The resolved PR used this sequence:

1. Merge `origin/main` and inspect the modify/delete conflicts.
2. Keep the route migration from `main` and remove the deleted
   `[slug]/[locale]` route files from the index.
3. Re-apply the LaunchDarkly CTA flag read in
   `apps/web/src/app/[slug]/[...rest]/page.tsx`.
4. Add catch-all route tests for two-segment video URLs and three-segment
   episode URLs.
5. Run focused tests, lint, typecheck, Prettier, and `git diff --check`.
6. If typecheck fails from `.next/dev/types/validator.ts`, clear only
   `.next/dev/types` and rerun typecheck.
7. Browser-smoke both visible states:
   - flag off/default route shows `DOWNLOAD`
   - local override `FORGE_WATCH_CTA_TEXT_COPY_DEFAULT=true` shows
     `SAVE VIDEO`
8. Restore the local dev server to flag-off/default behavior before handoff.

The conflict-resolution validation set was:

```bash
pnpm --filter @forge/web test -- 'src/app/[slug]/[...rest]/__tests__/page-routing.test.tsx' src/lib/feature-flags.test.ts src/components/watch/__tests__/WatchBody.test.tsx
pnpm --filter @forge/feature-flags test
pnpm --filter @forge/web lint
pnpm --filter @forge/web typecheck
pnpm --filter @forge/feature-flags lint
pnpm --filter @forge/feature-flags typecheck
pnpm exec prettier --check --ignore-unknown 'apps/web/src/app/[slug]/[...rest]/page.tsx' 'apps/web/src/app/[slug]/[...rest]/__tests__/page-routing.test.tsx' apps/web/src/lib/feature-flags.ts packages/feature-flags/src/registry.ts
git diff --check
```

Browser proof for the resolved branch was captured at:

- `.tmp/browser-proof/launchdarkly-cta-conflict-off-download.png`
- `.tmp/browser-proof/launchdarkly-cta-conflict-on-save-video.png`

## Related

- `docs/solutions/platform/launchdarkly-feature-flag-foundation-20260527.md`
  documents the Forge runtime LaunchDarkly pattern and local/Railway fallback
  env vars.
- `docs/solutions/tooling-decisions/codex-launchdarkly-hosted-mcp-install-20260527.md`
  documents the operator-side LaunchDarkly MCP setup for creating and
  inspecting flags.
- `docs/solutions/best-practices/watch-single-video-template-pages-strapi-nextjs-2026-04-11.md`
  documents the older watch-route resolver discipline that this newer
  catch-all route continues to protect.
- `docs/plans/2026-05-27-002-feat-watch-url-html-shape-i18n-restructure-plan.md`
  describes the route restructure that moved this work from `[slug]/[locale]`
  into `[slug]/[...rest]`.
