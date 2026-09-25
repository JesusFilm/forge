---
id: "feat-552"
title: "Keep Watch TV limited to Android TV in Google Play"
owner: "ekkasit"
priority: "P1"
status: "complete"
start_date: "2026-09-25"
duration: 1
depends_on: []
blocks: []
tags: ["tv", "android", "release"]
---

## Problem

The internal-testing preview for AAB version code 6 includes 12,335 phones and 6,751 tablets. The previous release supports TVs only. Making `android.software.leanback` required in version 8 removed phones but also reduced TV coverage from 3,049 to 7. The fresh EAS prebuild omitted `android.hardware.touchscreen` and `android.hardware.faketouch` declarations that appeared in a reused local native directory; Play reported required faketouch as the reason 3,042 TVs were excluded.

## Entry Points — Read These First

1. `apps/tv/plugins/withTVHardwareFeatures.js` — managed-prebuild manifest transform.
2. `apps/tv/scripts/androidTVHardwareFeatures.test.js` — expected feature declarations and idempotency.
3. `apps/tv/app.json` — plugin order and TV package ID.

## Grep These

- `android.software.leanback`
- `android.hardware.touchscreen`
- `withTVHardwareFeatures`

## What To Build

Set `android.software.leanback` to `android:required="true"` in the TV app's generated manifest. Explicitly set touchscreen, faketouch, portrait, and microphone to `android:required="false"` in the same plugin so a clean EAS prebuild preserves TV compatibility. Rebuild the AAB with the Google Play upload key and replace the unreleased version 8 bundle.

## Constraints

- Change only the TV app's Play device availability; do not change the separate mobile app.
- Keep the `LEANBACK_LAUNCHER` and Android TV banner.
- Do not publish to production or open testing.

## Verification

- Run the TV hardware-feature guard test and app-focused validation.
- Inspect the new AAB's signer and manifest; the signer must match Play's registered upload certificate.
- In the internal-release preview, TV devices must remain supported and phone/tablet support must return to zero before publishing.

Completed 2026-09-25: the guard tests and a clean Expo Android prebuild passed. EAS version code 9's AAB declares `android.software.leanback` required and touchscreen, faketouch, portrait, and microphone optional. Its SHA-256 signer matches the registered Play upload key. Google Play preview showed 3,049 supported TVs with zero devices lost, and zero phones/tablets. Version 1.0.0 (9) is available on the internal testing track.
