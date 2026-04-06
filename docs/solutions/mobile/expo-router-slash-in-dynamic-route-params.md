---
category: mobile
tags: [expo-router, deep-linking, sdui, navigation]
date: 2026-04-07
---

# Expo Router: Slashes in Dynamic Route Params

## Problem

Strapi CMS section keys contain forward slashes (e.g. `easter-explained/english`,
`my-last-day/english-bible-quotes`). When used in Expo Router dynamic routes like
`/video/[sectionKey]`, the slash is interpreted as a path separator, producing
`/video/easter-explained/english` which doesn't match any route — resulting in an
"Unmatched Route" error.

## Root Cause

Expo Router treats every `/` in a URL as a segment separator. There is no built-in
"catch-rest" parameter (like Next.js `[...slug]`) that captures slashes.

## Solution

**Encode at navigation time, decode on the detail screen.**

### Navigation (caller)

```tsx
router.push(`/video/${encodeURIComponent(sectionKey)}`)
// "/video/easter-explained%2Fenglish" — single segment, matches [sectionKey]
```

### Detail screen (receiver)

```tsx
const { sectionKey } = useLocalSearchParams<{ sectionKey: string }>()

let decodedKey: string | null = null
if (sectionKey != null) {
  try {
    decodedKey = decodeURIComponent(sectionKey)
  } catch {
    // Malformed percent-encoding — treat as invalid
  }
}
```

### Validation regex

Loosen the pattern to accept `/` and `%` in the decoded value:

```tsx
const SECTION_KEY_PATTERN = /^[a-zA-Z0-9_/%-]+$/
```

## Key Details

- `decodeURIComponent` can throw `URIError` on malformed input (e.g. `%ZZ`). Always
  wrap in try/catch.
- The decoded key is only used as a dictionary lookup key in `ExperienceProvider` —
  never interpolated into HTML, SQL, or external URLs.
- Deep links work correctly: `exp://host/--/video/easter-explained%2Fenglish`.

## Alternative Considered

Sanitizing section keys at the normalizer level (replacing `/` with `-` or `_`) was
considered but rejected because it would break the O(1) lookup in `ExperienceProvider`'s
section map, which is keyed by the original CMS value.

## Entry Points

- `apps/mobile-v2/src/components/sections/VideoCardRenderer.tsx` — encodes on press
- `apps/mobile-v2/src/components/sections/VideoHeroRenderer.tsx` — encodes CTA press
- `apps/mobile-v2/app/video/[sectionKey].tsx` — decodes and validates
