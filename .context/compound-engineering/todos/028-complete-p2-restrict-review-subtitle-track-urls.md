---
status: complete
priority: p2
issue_id: "028"
tags: [code-review, security, manager, subtitles]
dependencies: []
---

# Restrict Review Subtitle Track URLs

## Problem Statement

The review player copies CMS subtitle `vttSrc` values into the browser and passes them to Video.js as remote text tracks without validating scheme or host. If CMS contains an unexpected subtitle URL, a manager browser will fetch it directly.

## Findings

- `apps/manager/src/features/jobs/review-player/load-job-review-context.ts:126` reads `subtitle.vttSrc` from CMS and stores it as `ReviewTextTrack.src`.
- `packages/video-player/src/useVideoPlayerCore.ts:167` passes each track `src` to `player.addRemoteTextTrack(...)`.
- There is no allowlist for expected CMS/Mux subtitle hosts or proxying through manager.

## Proposed Solutions

### Option 1: Add an Allowlist in the Review Context Loader

**Approach:** Accept only HTTPS subtitle URLs from approved Jesus Film / Mux domains before returning them to the browser.

**Pros:**

- Small, direct hardening change.
- Keeps current player architecture.

**Cons:**

- Requires maintaining an approved host list.

**Effort:** 1-2 hours

**Risk:** Low

### Option 2: Proxy CMS Subtitle Tracks Through Manager

**Approach:** Expose CMS subtitles through an authenticated manager endpoint that fetches and validates upstream tracks server-side.

**Pros:**

- Centralizes access control and caching headers.
- Avoids exposing raw CMS subtitle URLs to the browser.

**Cons:**

- More implementation and operational surface.

**Effort:** 3-5 hours

**Risk:** Medium

## Recommended Action

Completed Option 1: added a conservative HTTPS allowlist before review subtitle tracks can reach the browser player.

## Technical Details

**Affected files:**

- `apps/manager/src/features/jobs/review-player/load-job-review-context.ts`
- `packages/video-player/src/useVideoPlayerCore.ts`

## Resources

- Review finding from security review on 2026-04-12.

## Acceptance Criteria

- [x] CMS subtitle URLs are validated before reaching the browser or proxied through manager.
- [x] Non-HTTPS and unapproved-host subtitle URLs are ignored or marked unavailable.
- [x] Tests cover accepted and rejected subtitle URL cases.

## Work Log

### 2026-04-12 - Initial Discovery

**By:** Codex

**Actions:**

- Traced CMS `vttSrc` from GraphQL loader to Video.js `addRemoteTextTrack`.
- Confirmed no URL allowlist or proxy is currently applied.

**Learnings:**

- Authenticated internal tools still need URL validation when browser clients fetch externally controlled URLs.

### 2026-04-12 - Review Fix

**By:** Codex

**Actions:**

- Added HTTPS-only subtitle host validation for JesusFilm domains and Mux text-track URLs.
- Filtered untrusted live CMS/Mux subtitle tracks before composing the review context.
- Added regression coverage proving approved tracks remain and unsafe/non-HTTPS tracks are dropped.

**Learnings:**

- Browser-delivered subtitle URLs need the same dot-boundary host checks used by server-side subtitle fetching.
