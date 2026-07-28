---
title: "Offline poster cached a 400 error body — expo-file-system downloadAsync writes the body for any HTTP status"
date: "2026-07-27"
category: "integration-issues"
module: "apps/mobile — offline downloads (offlineFileSystem.ts sidecar downloader)"
problem_type: "integration_issue"
component: "tooling"
severity: "medium"
symptoms:
  - "Library (offline downloads) thumbnail for 'Life of Jesus (Gospel of John)' renders blank (dark placeholder) while sibling downloads show real posters"
  - "poster.jpg on disk is a 13-byte Cloudflare error body (the text 'malformed URL') instead of JPEG bytes, so expo-image cannot decode it"
  - "the record's posterPath is set, so the corrupt file silently masquerades as a valid cached poster"
  - "downloadAsync's non-2xx HTTP status was discarded, so no error surfaced at download time"
root_cause: "wrong_api"
resolution_type: "code_fix"
related_components:
  - "apps/mobile/src/lib/offlineFileSystem.ts"
  - "apps/mobile/src/lib/downloadLifecycle.ts"
  - "apps/mobile/src/lib/cardImage.ts"
  - "expo-file-system/legacy downloadAsync"
  - "Cloudflare Images CDN"
  - "expo-image"
tags:
  - "mobile"
  - "offline-downloads"
  - "expo-file-system"
  - "cloudflare-images"
  - "http-status-validation"
  - "sidecar-download"
  - "poster-image"
  - "variant-less-url"
---

# Offline poster cached a 400 error body — `downloadAsync` writes the body for any HTTP status

## Problem

A downloaded video's Library thumbnail rendered as a blank dark placeholder while its siblings showed real posters. The offline record's `posterPath` WAS set and the file existed on disk — but the file was a 13-byte text body (`malformed URL`), not a JPEG. `expo-file-system/legacy`'s `downloadAsync(url, dest)` writes the HTTP response body to `dest` for ANY status code, and `downloadToFile()` discarded the returned status. When the poster URL was a bare, variant-less Cloudflare Images delivery URL (no `/f=jpg,…` transform), Cloudflare returned `400` with a short error body — which got saved as `poster.jpg`. Because `posterPath` was still populated, the garbage file masqueraded as a valid cached poster; `expo-image` could not decode it, so the thumbnail went blank.

## Symptoms

- One downloaded video shows a dark/blank Library thumbnail while sibling downloads show real posters.
- The offline record has a non-null `posterPath` and the file exists — so it does not look like a "missing poster" at the record level.
- The file at `posterPath` is a tiny (~13-byte) text body containing `malformed URL`, not JPEG bytes.
- `expo-image` silently fails to decode the file (no crash, no obvious error) — it just renders nothing.

## What Didn't Work

- **A content-type / magic-byte "is this actually an image?" check inside `downloadToFile`.** This is the intuitive fix, but it is wrong here because `downloadToFile` is a SHARED sidecar downloader — the same function fetches both the poster image (`downloadLifecycle.ts` ~L276-284) AND the subtitle VTT, which is plain text (`downloadLifecycle.ts` ~L258-270). An image/magic-byte assertion would reject every legitimate VTT. The only signal universal to both payload types is the HTTP status, so the guard has to key on status, not on body shape.

## Solution

Capture `downloadAsync`'s result, validate the status with an ALLOW-LIST (so a missing/`NaN` native status fails CLOSED rather than open), delete the garbage file, log, then throw. Callers already wrap the call in try/catch and degrade gracefully, so no caller change was needed.

**Before** (`apps/mobile/src/lib/offlineFileSystem.ts`, `downloadToFile`):

```ts
export async function downloadToFile(url: string, dest: string): Promise<void> {
  await downloadAsync(url, dest)
  // result (incl. status) discarded — a 400 error body is now saved at `dest`
}
```

**After** (`apps/mobile/src/lib/offlineFileSystem.ts`, `downloadToFile`, with the pre-existing 30s deadline race elided):

```ts
const result = await Promise.race([
  downloadAsync(url, dest),
  /* 30s timeout reject */
])
// downloadAsync writes the body to `dest` for ANY status, so a CDN error page
// (a variant-less Cloudflare 400 "malformed URL") would masquerade as a poster.
// Allow-list real 2xx (missing/NaN status fails closed); reject + delete else.
if (!(result.status >= 200 && result.status < 300)) {
  datadogLog.warn("sidecar.download_bad_status", { status: result.status })
  await deleteAsync(dest, { idempotent: true }).catch(() => {})
  throw new Error(`downloadToFile status ${result.status}`)
}
```

The two callers already degrade on a throw and needed no change:

- **Poster** (`downloadLifecycle.ts` ~L276-284): `try { await deps.fs.downloadToFile(...); posterPath = target } catch { posterPath = null }` -> a bad status leaves `posterPath = null`, and the Library renders its gradient placeholder instead of a broken image.
- **Subtitle** (`downloadLifecycle.ts` ~L258-270): `try { await deps.fs.downloadToFile(...); subtitleVerified = true } catch { subtitleTerminallyFailed = true }` -> the media still commits; only the subtitle degrades.

Tests (`apps/mobile/src/lib/__tests__/offlineFileSystem.test.ts`) pin the contract:

- 2xx (`status: 200`) resolves and does NOT call `deleteAsync` — the good file survives.
- non-2xx (`status: 400`) rejects, calls `deleteAsync(DEST, { idempotent: true })`, and logs `sidecar.download_bad_status` with `{ status: 400 }`.
- `status: 300` rejects — pins the lower boundary of the 2xx allow-list so a 3xx body is never treated as valid.
- cleanup-failure: when `deleteAsync` itself rejects, `downloadToFile` still rejects (the throw is not swallowed by a failed cleanup).

Committed in PR #1637 (`feat(mobile): rebuild Library tab as an offline downloads manager`).

## Why This Works

`downloadAsync` is status-blind by design: it is a "fetch these bytes to this path" primitive that treats a 400 error page exactly like a 200 image — both are just a response body it writes to disk. The old code trusted "the file exists" as a proxy for "the download succeeded," but those are different facts. Adding the explicit `result.status` gate restores the missing success check at the one place the status is actually available.

The check is written as an ALLOW-LIST (`status >= 200 && status < 300`) rather than a deny-list (`status >= 400`) on purpose: if a native layer ever returns `undefined`/`NaN` for `status`, the comparison is false and the download is rejected — it fails CLOSED (no poster) rather than open (garbage cached). A deny-list would let an unknown status through.

Keying on status rather than body content is what lets ONE function correctly serve both the binary poster path and the text VTT path — HTTP status is the only success signal both payloads share.

## Prevention

- **Any code that writes response bytes to disk must validate the HTTP status BEFORE treating the file as valid.** This applies to `expo-file-system` `downloadAsync`, buffered `fetch -> write file`, and any similar primitive. These APIs persist the body regardless of status; "the file exists" is not "the request succeeded." Discarding the returned status is the bug.
- **Prefer an allow-list (`2xx`) over a deny-list** so an absent / malformed / `NaN` status fails closed, not open.
- **A shared downloader used for multiple content types can only validate at the transport layer** (status), never the content layer (magic bytes / content-type) — a content check belongs at the type-specific caller, not the shared function.
- **This is the transport half of a two-part fix; the other half is URL selection.** `apps/mobile/src/lib/cardImage.ts`'s `pickCardImage` ranks the bare variant-less Cloudflare `url` LAST (it 400s), so a good URL is usually chosen in the first place. The pair is: _pick a good URL_ AND _don't cache a bad response._ Either alone is insufficient — a mis-ranked URL slips a 400 through, and without the status guard even a correctly-deprioritized-but-still-selected bad URL poisons the cache.

## Residual Risk / Known Gaps

- **A status-only check cannot catch a `200`-with-error-body or an empty `204`.** If an upstream returns HTTP 200 with a non-image body (or an empty 2xx), the file still passes the transport gate and caches as garbage. This residual can only be closed at the POSTER caller (the image path), e.g. a decode/magic-byte check there — it structurally cannot live in the shared `downloadToFile`. Left as a documented residual.
- **The code fix does not repair already-cached garbage.** Existing offline records whose `posterPath` points at a saved 400 body still render blank; those files predate the guard and need a re-download (or a one-time cleanup pass) to recover. The fix prevents NEW poisoned caches; it does not heal old ones.

## Related

- PR #1637 — `feat(mobile): rebuild Library tab as an offline downloads manager`
- `apps/mobile/src/lib/cardImage.ts` `pickCardImage` — the URL-selection half (bare `url` ranked last); the two fixes are a pair.
- `docs/solutions/architecture-patterns/tv-sdui-mediacollection-card-image-title-resolution.md` — the SELECT-side of the same variant-less-Cloudflare-400 root cause (never pick the 400ing `url`); this doc is its download-layer counterpart.
- `docs/solutions/integration-issues/mobile-hero-stream-url-trailing-whitespace-validation-gap.md` — sibling theme: untrusted prod/CDN data survives a validate/use seam and 400s at a native layer.
