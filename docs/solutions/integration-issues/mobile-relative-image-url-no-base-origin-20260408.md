---
title: "Mobile carousel images blank — resolveImageUrl returns relative paths without base URL"
date: "2026-04-08"
category: integration-issues
module: "apps/mobile-v2"
problem_type: integration_issue
component: tooling
symptoms:
  - "Carousel background images blank on video bible collection items"
  - "expo-image receives relative path with no origin — silently drops the request"
  - "No network request made for carousel background images"
root_cause: wrong_api
resolution_type: code_fix
severity: medium
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

Added a platform- and environment-aware `WEB_BASE_URL` constant and prepended it to relative paths:

```typescript
import { Platform } from "react-native"

const WEB_BASE_URL = __DEV__
  ? Platform.OS === "android"
    ? "http://10.0.2.2:3000/watch"
    : "http://localhost:3000/watch"
  : "https://www.jesusfilm.org/watch"

export function resolveImageUrl(url: string | null | undefined): string | null {
  if (!url) return null

  // Relative paths — static assets served by the Next.js web app
  if (url.startsWith("/") && !url.startsWith("//")) {
    return `${WEB_BASE_URL}${url}`
  }

  // Absolute URLs validated against allowed hosts
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null
    if (!isAllowedHost(parsed.hostname)) return null
    return url
  } catch {
    return null
  }
}
```

- **Android emulator**: `10.0.2.2` routes to the host machine's loopback, so the dev web app at `localhost:3000` is reachable.
- **iOS simulator**: Shares the host network and uses `localhost` directly.
- **Production**: Prepends the deployed web app URL with the Next.js `basePath` baked in.

### Additional fixes in the same pass

**Share button alignment** (`BibleQuotesCarouselRenderer.tsx`): When heading is null, a `space-between` flex row with a single child left-aligns the share button. Fixed with `marginLeft: 'auto'` which absorbs available space regardless of sibling count. Also wrapped `Share.share()` in `async/await + try/catch` to handle the unhandled promise rejection on Android.

**Subtitle/title order** (`TextRenderer.tsx`): Swapped render order so subtitle appears above heading. Reduced subtitle `marginBottom` from 12 to 4 for tighter spacing.

## Why This Works

Root-relative URLs are a web convention: the browser's current origin supplies the scheme + host + port. React Native's networking layer has no such context — it requires a fully qualified URL. The CMS stores paths relative to the web app's static file root (`apps/web/public/`), served under the `/watch` basePath. Prepending the correct origin per environment restores the full URL that `expo-image` needs.

The deprecated `apps/mobile/` already had this pattern in its `resolveImageUrl.ts` — the fix was porting the same approach to `apps/mobile-v2/`.

## Prevention

- **Unit test for relative paths**: Add assertions to `resolveImageUrl.test.ts` that any input starting with `/` (not `//`) returns a string beginning with `http`. This catches regressions immediately.
- **Audit `resolveImageUrl` for new image fields**: When adding new `imageUrl` fields to GraphQL queries, verify they pass through `resolveImageUrl` before reaching any image component.
- **Share button pattern**: When adding share affordances to SDUI renderers, use `async handleShare` with `try/catch` and `marginLeft: 'auto'` for trailing-edge alignment without depending on sibling presence.

## Related Issues

- [docs/solutions/mobile/eas-update-stakeholder-preview-setup.md](../mobile/eas-update-stakeholder-preview-setup.md) — Documents `resolveImageUrl.ts` env validation pitfall (Pitfall #4: raw `process.env` bypass). The current fix addresses URL resolution logic, not env validation.
- [docs/solutions/mobile/video-detail-audit-ui-polish-fixes.md](../mobile/video-detail-audit-ui-polish-fixes.md) — Prior audit of the same renderers (BibleQuotesCarouselRenderer CTA fix, TextRenderer color tokens). This doc is a continuation of that audit wave.
