---
id: "feat-581"
title: "Mobile My Watch tab: downloads rail, More, and Account screens"
owner: "urim"
priority: "P1"
status: "complete"
start_date: "2026-09-29"
duration: 2
depends_on: []
blocks: []
tags:
  - "mobile"
  - "platform"
---

## Problem

The mobile Profile tab is one scroll that mixes three unrelated things: an account card, the full downloads list with a pinned Select row, and one Privacy Policy button. About ten information links (Give, Contact Us, About, Newsletter, four socials, Terms of Use, Legal Statement) and the app version also need a home, and on that scroll they would sink under a growing list. The sign-in gate (feat-543) is closed in production, so for most viewers the tab is mainly a way back to their downloads.

The tab is renamed "My Watch" (route name stays `profile`) and becomes a content page: a top bar with a menu control, an identity header, and a Downloads rail. Three root-stack screens open over it: Downloads, More, and Account.

## Entry Points — Read These First

1. `docs/plans/2026-09-29-1134-feat-mobile-my-watch-tab-layout-plan.md`: the plan. It carries R1-R21, AE1-AE8, KD1-KD10, and KTD1-KTD12, and it is the authority for every decision.
2. `apps/mobile/app/(tabs)/profile.tsx` and `apps/mobile/src/components/profile/MyWatchScreen.tsx`: the page.
3. `apps/mobile/src/lib/myWatchRail.ts`: the rail selector (at most 10 tiles, one merged order, a one-episode series becomes a video tile).
4. `apps/mobile/src/components/profile/MyWatchHeader.tsx` and `apps/mobile/src/lib/accountDeletedNotice.ts`: the identity header, its three notices, and the sign-in gate states.
5. `apps/mobile/app/downloads.tsx`, `apps/mobile/app/more.tsx`, `apps/mobile/app/account.tsx`: the three root screens, registered in `apps/mobile/app/_layout.tsx`.
6. `apps/mobile/src/components/library/LibraryDownloads.tsx`: the full list, now hosted only by the Downloads screen, with no tab-bar logic.

## Grep These

- `buildMyWatchRail` — the rail selector and its one consumer
- `ScreenTopBar` — the shared top bar of the page and the three screens
- `noteAccountDeleted` — where the "Your account was deleted" notice rises (`deleteAccount()`)
- `openExternalUrl` — every More row leaves the app through it (App Store 3.2.2(iv) for Give)
- `nativeBuildVersion` — the build number on the More screen (`expo-application`)

## What To Build

- The page, the rail, and the whole-page empty state ("No Downloads Yet").
- The Downloads screen with today's list, selection mode, deletion, and a `series` route parameter that opens a series card.
- The More screen with the Support, About, and Legal groups and "Version <version> (<build>)".
- The Account screen with the viewer's identity, Sign out, and Delete account. It closes only on a signed-in-to-signed-out change.

## Constraints

- `apps/mobile` only. Web and TV do not change.
- New strings stay in English; interface localization is separate work.
- No placeholder rails for playlists or continue watching (KD7).
- The replay-mask, sign-in gate wiring, tab-bar clearance, and mini-player route-table guards must name the new files and routes.
- `expo-application` was already autolinked through `expo-notifications`: adding it to `apps/mobile/package.json` did not move the fingerprint (iOS `fb10f65f…`, Android `82c70de8…`, before and after, 2026-09-29).

## Verification

- `pnpm --filter @forge/mobile test`, `pnpm --filter @forge/mobile typecheck`, and `pnpm --filter @forge/mobile lint` pass.
- Every AE in the plan has a named test.
- iOS simulator and Android emulator: the page, the empty state, More, Account, and Downloads in selection mode; the last Downloads row clears the Android system navigation bar.
- A release-mode bundle (`EXPO_NO_DOTENV=1 npx expo start --no-dev --minify`) shows the gate-closed header.
