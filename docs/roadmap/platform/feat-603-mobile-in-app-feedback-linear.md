---
id: "feat-603"
title: "Mobile in-app feedback that files a Linear issue"
owner: "urim"
priority: "P1"
status: "complete"
start_date: "2026-09-14"
duration: 21
depends_on: []
blocks: []
tags:
  - "mobile"
  - "platform"
  - "graphql"
---

## Problem

The mobile app had no way to report a problem or send an idea from inside the app. The only route was "Contact Us", which opens a web page, so a tester who saw a broken video had to describe it from memory, with no video, time, or app version attached. Watch on the web already files feedback as Linear issues (feat-399); mobile had no equivalent.

## Entry Points — Read These First

1. `docs/plans/2026-09-14-1033-feat-mobile-feedback-linear-plan.md`: the plan. It carries R1-R19, AE1-AE16, KD1-KD10, and KTD1-KTD13, and its dated updates record the later changes (the More door, the `titleFromRecord` gate, the `MOBILE` setting names).
2. `apps/admin/src/graphql/mutations/feedback.ts`: the public `submitFeedback` mutation. Its outcome is data: `accepted` plus a nullable refusal.
3. `apps/admin/src/services/feedback-linear.ts`: builds the issue title and description and calls Linear's `issueCreate`.
4. `apps/admin/src/services/feedback-limits.ts` and `apps/admin/src/services/feedback-text.ts`: the three counters and the text sanitizer.
5. `apps/mobile/src/components/feedback/FeedbackSheetContent.tsx` and `feedbackFlow.ts`: the two-step sheet and its state.
6. `apps/mobile/app/feedback.tsx` (the More door, a root form sheet) and `apps/mobile/src/components/feedback/FeedbackModal.tsx` (the player door, an RN Modal over the player).
7. `apps/mobile/src/components/watch/PlayerSettingsSheet.tsx` and `apps/mobile/src/components/watch/PlaybackHost.tsx`: the "Report a problem with this video" row and the video context it attaches.
8. `apps/mobile/src/lib/feedbackSubmission.ts`, `feedbackQueries.ts`, `feedbackDeviceDetails.ts`, and `authHeaders.ts`: the send, the operation, the opt-in device details, and the fleet-bearer allowlist.

## Grep These

- `submitFeedback` / `SubmitFeedback` — the admin mutation and the mobile operation
- `ADMIN_MOBILE_FEEDBACK_` — the five admin settings
- `titleFromRecord` — the gate that keeps a deep-link seed title out of a ticket
- `FEEDBACK_SHEET_OPTIONS` — the root form-sheet declaration in `apps/mobile/app/_layout.tsx`
- `feedbackModal` — the component-state sheet id in `src/lib/miniPlayer/suppression.ts`
- `carriesFleetBearer` — the operations that carry the mobile fleet key

## What To Build

- **Admin:** a public `submitFeedback` mutation. It validates the submission, applies three limits (5 per install per 10 minutes, 20 per address per hour, a fleet-wide daily cap), and files one Linear issue before it answers. A refusal is data (`INVALID_INPUT`, `RATE_LIMITED`, `DAILY_CAP`, `UNAVAILABLE`, `NOT_CONFIGURED`), never a thrown error.
- **The ticket:** the title is `[Mobile feedback] <kind>: <start of message>`. The description quotes the message word for word, then lists the kind, the optional name and email, the tagged video and position, the platform, the opted-in device details, and the submission id. No model writes or translates it.
- **Mobile:** two doors that open one two-step sheet (pick a kind, then write):
  - "Send Feedback", first in the Support group of the More screen.
  - "Report a problem with this video" in the player settings sheet, also in fullscreen landscape. It tags the video and position as a removable "About:" tag.
- **One failure message** for every refusal ("Couldn't send that. Try again in a few minutes."). The draft is kept, and a retry reuses the submission id.

## Constraints

- Nothing is read from the account. Name and email are typed and optional.
- Device details are opt-in, with the switch off by default (KD4, R9). The platform is always sent.
- Only a title from the resolved video record may reach a ticket. A page that plays from a deep-link seed alone sends no video (`titleFromRecord`).
- Every admin setting is optional, so admin boots without Linear. A missing key or team id answers `NOT_CONFIGURED`. A daily cap of `0` refuses every report and is the kill switch.
- No log line carries the message, the name, or the email.
- The mobile change adds no native module. `expo-application` and `expo-device` were already on `main`.

## Verification

- `pnpm --filter @forge/mobile test`, `typecheck`, and `lint` pass (425 suites, 7,751 tests on 2026-10-05).
- The admin feedback suites pass: `feedback-limits.test.ts`, `feedback-linear.test.ts`, `graphql/mutations/feedback.test.ts` (74 tests).
- iPhone 17 Pro Max simulator against a fake-admin proxy (`docs/solutions/developer-experience/mobile-write-path-smoke-via-fake-admin-proxy.md`): both doors, fullscreen landscape, the failure and retry path, opt-in device details, and a crafted seed-only page that sends `video: null`.
- Production: one `submitFeedback` call answers `accepted: true`, and admin logs `[feedback] event=linear_created status=200`.

## Results

- Merged: #2285 (admin), #2286 (mobile, 2026-10-05), and #2559 (the `ADMIN_MOBILE_FEEDBACK_*` setting names, 2026-10-05).
- Provisioned 2026-10-05 in Doppler `forge-admin`/`prd`: the Linear key, team, project ("Forge - Mobile"), and the workspace "Feedback" label. A production test report created its issue in 350 ms, and the owner checked it.
- Not shipped over the air, by the owner's decision: the feature reaches testers with the next TestFlight build.
- Carried forward, all device-only:
  - Android: the hardware back button, and a drag of the sheet while a report sends. That drag can leave the route on the stack, a known defect from review.
  - The on-screen keyboard in portrait and fullscreen landscape.
  - VoiceOver on a real iPhone.
