---
date: 2026-03-31
topic: experiments-mobile-preview
---

# Mobile App Preview on Experiments Page

## Problem Frame

The Mobile App card on the experiments page currently shows a "Coming Soon" badge. An EAS Update preview has been published, and non-technical stakeholders need a simple way to try the app on their phones directly from this page. They need clear, jargon-free instructions since most won't know what Expo Go is.

## Requirements

- R1. Replace the "Coming Soon" badge on the Mobile App card with a "View Demo" button styled consistently with other experiment cards (amber theme).
- R2. Clicking "View Demo" expands the card inline to reveal a preview panel with:
  - Step-by-step instructions for downloading Expo Go (with App Store and Play Store links)
  - A dynamically generated QR code from the stable EAS Update channel URL
  - Brief explanation that scanning the QR code opens the app preview
- R3. Instructions must be written in plain, non-technical language — no developer jargon. Audience is ministry stakeholders, not engineers.
- R4. The QR code is generated at render time from the stable channel URL (`exp://u.expo.dev/<project-id>?channel-name=<channel>`), so it always points to the latest published update without code changes.
- R5. Works for both mobile and desktop viewers:
  - Mobile: user sees instructions and QR code on screen, scans with their camera app
  - Desktop: user sees the QR code, takes out their phone to scan it

## Success Criteria

- A non-technical person can go from the experiments page to running the app on their phone by following the on-screen instructions alone.
- The QR code stays valid across future `eas update` publishes (no image files to regenerate).

## Scope Boundaries

- No app install flow beyond Expo Go — no TestFlight, no APK sideloading.
- No deep linking to specific screens within the app.
- No analytics on QR code scans.

## Key Decisions

- **Inline expand, not modal**: Keeps the user in context of the card. Simpler to implement, no overlay management.
- **Generated QR code, not static image**: Uses a JS QR code library with the stable channel URL. No maintenance when updates are published.
- **Channel-based URL**: The QR code encodes a channel URL so `eas update --channel <name>` automatically delivers the latest version without changing the QR code.

## Outstanding Questions

### Deferred to Planning

- [Affects R4][Needs research] Confirm the exact EAS Update channel name used for stakeholder previews (likely `preview` based on eas.json profiles).
- [Affects R4][Needs research] Confirm the correct Expo URL format for channel-based QR codes (e.g., `exp://u.expo.dev/<project-id>?channel-name=preview`).
- [Affects R2][Technical] Choose a lightweight QR code library compatible with Next.js server/client components (e.g., `qrcode.react`).

## Next Steps

-> `/ce:plan` for structured implementation planning
