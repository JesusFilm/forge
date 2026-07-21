---
title: "Hero carousel slide silently skipped — WHATWG URL parsing strips the trailing newline a native player still chokes on"
date: "2026-07-21"
category: "integration-issues"
module: "apps/mobile — Home hero carousel (validateUrl.ts URL validate/use seam)"
problem_type: "integration_issue"
component: "tooling"
severity: "high"
symptoms:
  - "Hero carousel instantly skipped the JESUS feature-film slide on a real iPhone instead of playing it."
  - "Prod admin's jesus video English dub hls value ends with a trailing newline (1 of 2,281 dubs) — WHATWG new URL() parsing strips it before validateStreamingUrl checks the hostname, so the tainted string passes validation."
  - "iOS percent-encodes the untrimmed newline and requests the stream URL with a literal %0A suffix from Mux, which 400s and instantly errors the player."
  - "The pager's STREAM_ERROR path skipped the slide and persisted the skip as played for the month, hiding the slide entirely from users until month rollover."
root_cause: "missing_validation"
resolution_type: "code_fix"
related_components:
  - "apps/mobile/src/lib/validateUrl.ts"
  - "apps/mobile/src/lib/watchHome/heroStream.ts"
  - "apps/mobile/src/lib/normalizeVideo.ts"
  - "apps/mobile/src/components/sections/VideoHeroRenderer.tsx"
  - "apps/tv/src/components/showcaseMode/ReelPlayer.tsx"
tags:
  - "mobile"
  - "hero-carousel"
  - "url-validation"
  - "whatwg-url"
  - "mux"
  - "hls"
  - "trailing-whitespace"
  - "expo-video"
---

# Hero carousel slide silently skipped — WHATWG URL parsing strips the trailing newline a native player still chokes on

## Problem

On a real iPhone, the Home hero carousel's JESUS feature-film slide appeared for a blink, then advanced almost immediately. Because the hero pager persists any slide it departs as "played" (monthly reset, mirroring web's browser-storage behavior — `apps/mobile/src/hooks/useWatchHomeCarouselMemory.ts:38-48` with `markVideoPlayed` at `apps/mobile/src/hooks/useWatchHomeCarouselMemory.ts:107`, wired at slide-change time in `apps/mobile/src/components/home/HomeScreen.tsx:170-187`), one skip was enough to make the slide vanish from the carousel entirely on the next cold launch — it looked queue-built-out rather than actively skipped.

Root cause: prod admin's `jesus` English dub carries an `hls` value ending in a trailing `"\n"` (verified live — exactly 1 of 2,281 dubs tainted). `validateStreamingUrl` parses the URL with WHATWG's `new URL()`:

```ts
// apps/mobile/src/lib/validateUrl.ts:27-35
export function validateStreamingUrl(url: string | null | undefined): boolean {
  if (!url) return false
  try {
    const parsed = new URL(url)
    return ALLOWED_STREAMING_HOSTS.has(parsed.hostname)
  } catch {
    return false
  }
}
```

`new URL()` silently strips leading/trailing whitespace and interior tab/LF/CR before parsing, so this check **passed**. But the callers then handed the original, un-trimmed string to expo-video's `replaceAsync`/`useVideoPlayer`. iOS percent-encoded the embedded newline (`…m3u8` → `…m3u8%0A`), and Mux's HLS endpoint returned 400 for the encoded variant (verified via curl: the clean URL returns 200, the `%0A`-suffixed one returns 400). The 400 fired an instant `statusChange` error on the player, which — in the pager as it behaved at the time of the bug — the `STREAM_ERROR` action turned directly into a skip. (The same PR later softened that response: `STREAM_ERROR` now parks the failed slide in a 7-second "unavailable" poster dwell, and `UNAVAILABLE_TIMER_ELAPSED` advances past it — `apps/mobile/src/lib/watchHome/pagerReducer.ts:282-298` on the current tree — so a dead slide dwells calmly instead of jumping.)

## Symptoms

- On real iPhone hardware, the JESUS feature-film hero slide plays for a fraction of a second then advances to the next slide.
- After the first skip, the slide disappears from the carousel on subsequent cold launches — the departed slide was recorded as "played" and won't reappear until the monthly reset.
- No console/telemetry trail in dev builds — `datadogLog.warn` is a no-op locally, so the skip left nothing to grep for.

## What Didn't Work

- **Code review of `validateUrl.ts` in isolation** read as correct — the Mux hostname allowlist check looks airtight. The seam is invisible unless you already know WHATWG's `new URL()` whitespace-stripping behavior diverges from what a native HTTP client does with a raw string.
- **Simulator reproduction** was confounded by the persistence side effect: by the time anyone looked, the slide had already been marked "played" from an earlier session, so it presented as a queue-building/pool-rotation bug (the slide simply "wasn't there") rather than an active in-flight skip.
- **Waiting on local telemetry** was a dead end — `datadogLog.warn` on the skip path is a no-op in dev builds, so there was no console evidence to chase.
- The decisive evidence came from bypassing local repro entirely: querying prod GraphQL directly with `curl` to pull the raw `hls` value, then diffing Mux's response for the clean URL vs. the same URL with the newline percent-encoded (200 vs. 400).

## Solution

Before the fix, both consumers filtered on `validateStreamingUrl(variant.hls)` (or an even weaker null/empty check) and then used `variant.hls`/`v.hls` **unmodified** downstream:

```ts
// apps/mobile/src/lib/watchHome/heroStream.ts (before)
const playable = variants.filter(
  (variant): variant is HeroStreamVariantInput & { hls: string } =>
    variant.published === true &&
    typeof variant.hls === "string" &&
    validateStreamingUrl(variant.hls),
)
```

```ts
// apps/mobile/src/lib/normalizeVideo.ts (before)
function pickFirstPlayableVariant(...) {
  return (
    variants.find(
      (v) => v.published === true && v.hls != null && v.hls !== "",
    ) ?? null
  )
}
// ...
hls: v.hls ?? null,
// ...
streamingUrl: firstPlayable?.hls ?? null,
```

Neither seam trimmed the string before shipping it onward, so a validated-but-tainted URL reached the native player raw.

The fix adds a shared `cleanStreamUrl()` and runs it **before** validation at every ingestion point:

```ts
// apps/mobile/src/lib/validateUrl.ts:12-21
/**
 * Normalize a CMS-sourced stream URL before validation/playback: trim outer
 * whitespace and reject any interior whitespace. WHATWG URL parsing silently
 * strips both, so a tainted value passes validation but 400s at the player.
 */
export function cleanStreamUrl(url: string | null | undefined): string | null {
  const trimmed = url?.trim()
  if (!trimmed || /\s/.test(trimmed)) return null
  return trimmed
}
```

```ts
// apps/mobile/src/lib/watchHome/heroStream.ts:22-43 (current tree)
export function selectHeroStreamUrl(
  variants: readonly HeroStreamVariantInput[] | null | undefined,
): string | null {
  if (!variants || variants.length === 0) return null

  // Clean BEFORE validating (cleanStreamUrl): WHATWG URL strips stray
  // whitespace so a tainted "…m3u8\n" passes validation, but the native
  // player requests it raw → 400.
  const playable = variants
    .map((variant) => ({ ...variant, hls: cleanStreamUrl(variant.hls) }))
    .filter(
      (variant): variant is HeroStreamVariantInput & { hls: string } =>
        variant.published === true &&
        typeof variant.hls === "string" &&
        validateStreamingUrl(variant.hls),
    )

  const english = playable.find(
    (variant) => variant.language?.slug === ENGLISH_LANGUAGE_SLUG,
  )
  return english?.hls ?? playable[0]?.hls ?? null
}
```

`map()` replaces each candidate's `hls` with the cleaned value first, so both the `validateStreamingUrl` check and the value returned to the caller operate on the same, cleaned string.

`normalizeVideo.ts` mirrors this at ingestion for the watch page, which consumes the same raw admin data:

```ts
// apps/mobile/src/lib/normalizeVideo.ts:171-180
function pickFirstPlayableVariant(
  variants: readonly NormalizableVariant[] | undefined | null,
): NormalizableVariant | null {
  if (!variants) return null
  return (
    variants.find(
      (v) => v.published === true && cleanStreamUrl(v.hls) != null,
    ) ?? null
  )
}
```

```ts
// apps/mobile/src/lib/normalizeVideo.ts:262-266 (variants map)
hls: cleanStreamUrl(v.hls),
```

```ts
// apps/mobile/src/lib/normalizeVideo.ts:344
streamingUrl: cleanStreamUrl(firstPlayable?.hls),
```

The fix has been opened in PR #1623 (branch `fix/mobile-hero-jesus-slide-skip-crossfade`) and is unmerged as of this writing.

## Why This Works

The bug wasn't a bad regex or a missing null check — it was a seam between two parsers that disagree about whitespace. `new URL()` treats a URL string as loosely-formatted input and silently normalizes it; `replaceAsync`/the native HTTP stack treats it as an exact request target. Validating with one parser's tolerant behavior and then handing the _original_ string to a strict consumer means "valid" and "what actually gets requested" can diverge.

`cleanStreamUrl()` closes that gap by making the value that gets **validated** and the value that gets **used** the same value: trim outer whitespace, and reject (return `null`) if anything unprintable remains inside the string. Placing the call before `validateStreamingUrl`/before the played-variant scan at every seam (`selectHeroStreamUrl`, `pickFirstPlayableVariant`, the `variants` map, and `streamingUrl`) means there's no code path left where a caller can accidentally read the tainted original.

## Prevention

Regression tests cover the exact taint shapes:

- `apps/mobile/src/lib/__tests__/watchHomeQueries.test.ts:181-195` — "returns a TRIMMED url when the winning hls carries stray whitespace" (`"https://stream.mux.com/english.m3u8\n"` → trimmed).
- `apps/mobile/src/lib/__tests__/watchHomeQueries.test.ts:199-213` — "treats INTERIOR whitespace as unplayable" (`"https://stream.mux.com/eng\nlish.m3u8"` → falls through to the next candidate).
- `apps/mobile/src/lib/__tests__/watchHomeQueries.test.ts:217-231` — "treats a whitespace-only hls as unplayable" (`"  \n"` → falls through).
- `apps/mobile/src/lib/__tests__/normalizeVideo.test.ts:250-261` — "trims whitespace-tainted hls at ingestion (streamingUrl + variants)", asserting every returned `variant.hls` equals its own `.trim()`.
- `apps/mobile/src/lib/__tests__/normalizeVideo.test.ts:265-273` — "skips a whitespace-only hls when picking the first playable variant".

General law: **validate the exact value you hand to the consumer.** Either validate-and-use the parsed/normalized value, or normalize first and validate the normalized value — never validate string A and ship string B. Any `validateStreamingUrl(x)`/`validateActionUrl(x)` call followed by a downstream use of the _original_ `x` (not the value the validator actually inspected) reintroduces this seam.

The same shape exists in two places that haven't been fixed yet, because the source taint (the admin dub row itself) still exists and admin owns that cleanup:

- `apps/tv/src/components/showcaseMode/ReelPlayer.tsx:75` validates `stream.hls` via `validateStreamingUrl(stream.hls)` but keeps the original `stream` object, and `apps/tv/src/components/showcaseMode/ReelPlayer.tsx:276` later calls `player.replaceAsync(target?.hls ?? null)` with that same un-cleaned `hls`.
- `apps/mobile/src/components/sections/VideoHeroRenderer.tsx:68` calls `validateStreamingUrl(streamingUrl)` on the SDUI block's raw `streamingUrl`, and `apps/mobile/src/components/sections/VideoHeroRenderer.tsx:79` passes that same raw `streamingUrl` into `useVideoPlayer()`.

Both are candidates for the same `cleanStreamUrl()`-before-`validateStreamingUrl()` treatment applied here, once/if the same taint shape shows up on those paths.

## Related Issues

- PR #1623 — `fix(mobile): hero JESUS slide skip, play-through transitions + stream cooldown (feat-267/268)` (the fix; open as of this writing)
- `docs/solutions/ui-bugs/tv-video-hero-blank-autoplay-20260413.md` — same `validateStreamingUrl`/hero vocabulary on the TV surface; establishes the pre-existing gate `cleanStreamUrl` now runs ahead of (apps/tv still calls it without a pre-clean).
- `docs/solutions/architecture-patterns/cross-client-hero-parity-eligibility-gate.md` — the hero eligibility-gate chain `cleanStreamUrl` now slots into.
- `docs/solutions/design-patterns/lean-bulk-lazy-per-item-graphql-fetch-20260604.md` — covers `normalizeVideo.ts`, one of the two ingestion seams patched here.
- `docs/solutions/best-practices/mobile-video-detail-page-patterns-20260527.md` — expo-video source-replacement wiring; background for why an unplayable URL manifests as an instant skip rather than a visible error.
- `docs/solutions/runtime-errors/expo-video-backdrop-seamless-loop-20260609.md` — adjacent "native player rejects what the JS layer considered fine" gotcha in the same hero problem space.
- `docs/solutions/integration-issues/mobile-relative-image-url-no-base-origin-20260408.md` — same bug class: a CMS URL that passes naive validation but fails at the actual consumer.
