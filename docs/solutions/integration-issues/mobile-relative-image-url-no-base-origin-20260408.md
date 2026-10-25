---
title: "Mobile carousel images blank — resolveImageUrl returns relative paths without base URL"
date: "2026-04-08"
last_updated: "2026-04-10"
category: integration-issues
module: "apps/mobile-v2"
problem_type: integration_issue
component: tooling
symptoms:
  - "Carousel background images blank on video bible collection items"
  - "expo-image receives relative path with no origin — silently drops the request"
  - "No network request made for carousel background images"
  - "Production EAS Update: images return 307 redirect to HTML when fetched from www.jesusfilm.org/watch"
root_cause: wrong_api
resolution_type: config_change
severity: high
related_components:
  - "apps/web"
tags:
  - expo-image
  - react-native
  - image-url
  - relative-path
  - cms-assets
  - mobile-v2
  - carousel
  - sdui
  - cloudflare
  - github-raw
  - eas-update
---

# Mobile carousel images blank — resolveImageUrl returns relative paths without base URL

## Problem

The mobile app (`apps/mobile-v2`) displayed blank backgrounds on Bible collection carousel items because `resolveImageUrl.ts` returned CMS-sourced relative paths (e.g., `/images/thumbnails/1_jf-0-0-vertical.png`) as-is, but `expo-image` in React Native has no HTTP server context to resolve root-relative URLs.

## Symptoms

- Carousel card backgrounds are blank/empty on device and simulator for Bible collection items
- No network request is made for carousel background images — the relative path is passed directly to `expo-image` and silently dropped
- The web app renders the same images correctly because Next.js resolves relative paths against its own origin with `basePath: "/watch"`

## What Didn't Work

The existing `resolveImageUrl.ts` guard returned relative paths unchanged:

```typescript
// BEFORE — broken for React Native
if (url.startsWith("/") && !url.startsWith("//")) {
  return url // returns "/images/thumbnails/..." with no host
}
```

This was correct for the web app (where the browser supplies the origin), but meaningless in a native app where `expo-image` requires a fully qualified URL. Bundling the images as local assets was considered but ruled out — the thumbnails are CMS-managed and change without an app release.

## Solution

### Phase 1 (2026-04-08): Add base URL for relative paths

Added a platform- and environment-aware base URL constant and prepended it to relative paths. Initially used `https://www.jesusfilm.org/watch` for production:

```typescript
const WEB_BASE_URL = __DEV__
  ? Platform.OS === "android"
    ? "http://10.0.2.2:3000/watch"
    : "http://localhost:3000/watch"
  : "https://www.jesusfilm.org/watch"
```

This fixed local dev but **failed in production EAS Update builds** — see Phase 2.

### Phase 2 (2026-04-10): Fix production base URL (Cloudflare blocks external static file access)

The `www.jesusfilm.org/watch` URL works within the web app (same-origin, Next.js serves `public/` internally) but fails for external requests. Cloudflare routing intercepts paths like `/watch/images/thumbnails/*.png` and returns 307 redirects to HTML pages. Confirmed via `curl -sI`:

```
HTTP/2 307
location: /watch/images.html/thumbnails/1_jf-0-0-vertical.html
x-matched-path: /en/watch/[part1]/[part2]/[part3]
```

**Fix:** Changed the production base URL to serve static files from the git repo via GitHub raw content, which is externally accessible:

```typescript
import { Platform } from "react-native"

const STATIC_BASE_URL = __DEV__
  ? Platform.OS === "android"
    ? "http://10.0.2.2:3000/watch"
    : "http://localhost:3000/watch"
  : "https://raw.githubusercontent.com/JesusFilm/forge/main/apps/web/public"

export function resolveImageUrl(url: string | null | undefined): string | null {
  if (!url) return null

  // Relative paths — static assets from apps/web/public/
  if (url.startsWith("/") && !url.startsWith("//")) {
    return `${STATIC_BASE_URL}${url}`
  }

  // Absolute URLs — protocol validation only (CMS is admin-controlled)
  try {
    const parsed = new URL(url)
    if (parsed.protocol === "http:" && !__DEV__) return null
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null
    return url
  } catch {
    return null
  }
}
```

Additional changes in Phase 2:

- **Removed `ALLOWED_IMAGE_HOSTS` allowlist** — the web app trusts all CMS-sourced https URLs without host validation; the mobile app now matches this posture. CMS is admin-controlled, not user input.
- **Blocked `http://` in production** — only `https://` absolute URLs pass through in non-dev builds, matching `validateActionUrl` behavior.

**Verification:** `curl -sI https://raw.githubusercontent.com/JesusFilm/forge/main/apps/web/public/images/thumbnails/1_jf-0-0-vertical.png` returns `HTTP/2 200` with `content-type: image/png`.

- **Android emulator**: `10.0.2.2` routes to the host machine's loopback, so the dev web app at `localhost:3000` is reachable.
- **iOS simulator**: Shares the host network and uses `localhost` directly.
- **Production**: Uses GitHub raw content URL for static assets (bypasses Cloudflare routing).

### Additional fixes in the same pass

**Share button alignment** (`BibleQuotesCarouselRenderer.tsx`): When heading is null, a `space-between` flex row with a single child left-aligns the share button. Fixed with `marginLeft: 'auto'` which absorbs available space regardless of sibling count. Also wrapped `Share.share()` in `async/await + try/catch` to handle the unhandled promise rejection on Android.

**Subtitle/title order** (`TextRenderer.tsx`): Swapped render order so subtitle appears above heading. Reduced subtitle `marginBottom` from 12 to 4 for tighter spacing.

## Why This Works

Root-relative URLs are a web convention: the browser's current origin supplies the scheme + host + port. React Native's networking layer has no such context — it requires a fully qualified URL. The CMS stores paths relative to the web app's static file root (`apps/web/public/`), served under the `/watch` basePath.

**Why `www.jesusfilm.org/watch` fails externally:** The web app is deployed on Vercel behind Cloudflare. When the browser (on the same origin) requests `/watch/images/...`, Next.js serves the file from its `public/` directory before any routing rules apply. But external requests (from curl, expo-image, or any non-browser client) hit Cloudflare first, which applies routing/transform rules that match the path to a dynamic catch-all route instead of the static file.

**Why GitHub raw works:** `raw.githubusercontent.com` serves files directly from the repository with correct content-type headers and no routing interception. The static files in `apps/web/public/` are committed to the repo and accessible at a deterministic URL.

**Known trade-off:** The GitHub raw URL is coupled to the repo name, branch, and directory structure. If any of these change, production images break silently. Long-term, serve static assets from an owned CDN or a dedicated subdomain (e.g., `static.jesusfilm.org`).

## Prevention

- **Never use the public-facing web URL as a base for static assets in mobile.** The web app's URL passes through Cloudflare, which may apply routing rules that redirect static paths to HTML pages. Mobile apps make external cross-origin requests and hit those rewrites.
- **Verify asset URLs with `curl -sI` before assuming they are reachable from mobile.** A 200 in the browser does not guarantee a 200 for an external request if Cloudflare WAF or transform rules are active.
- **Test image loading in an EAS preview build against production config before shipping.** Local dev bypasses Cloudflare entirely and will not surface this class of routing failure.
- **Unit test for relative paths**: Add assertions to `resolveImageUrl.test.ts` that any input starting with `/` (not `//`) returns a string beginning with `http`. This catches regressions immediately.
- **Audit `resolveImageUrl` for new image fields**: When adding new `imageUrl` fields to GraphQL queries, verify they pass through `resolveImageUrl` before reaching any image component.
- **Long-term: serve static assets from an owned CDN.** The GitHub raw URL is a workaround. Migrate to a dedicated static asset host (e.g., `static.jesusfilm.org`, S3 + CloudFront, or Cloudflare R2) to remove the coupling to the git repo structure.

## Related Issues

- [docs/solutions/mobile/eas-update-stakeholder-preview-setup.md](../mobile/eas-update-stakeholder-preview-setup.md) — Documents `resolveImageUrl.ts` env validation pitfall (Pitfall #4: raw `process.env` bypass). The current fix addresses URL resolution logic, not env validation.
- [docs/solutions/mobile/video-detail-audit-ui-polish-fixes.md](../mobile/video-detail-audit-ui-polish-fixes.md) — Prior audit of the same renderers (BibleQuotesCarouselRenderer CTA fix, TextRenderer color tokens). This doc is a continuation of that audit wave.
