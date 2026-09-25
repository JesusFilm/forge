---
id: "feat-552"
title: "Keep Watch TV limited to Android TV in Google Play"
owner: "ekkasit"
priority: "P1"
status: "in-progress"
start_date: "2026-09-25"
duration: 1
depends_on: []
blocks: []
tags: ["tv", "android", "release"]
---

## Problem

The internal-testing preview for AAB version code 6 includes 12,335 phones and 6,751 tablets. The previous release supports TVs only. The managed prebuild currently emits `android.software.leanback` with `android:required="false"`, allowing Play to distribute the TV interface to non-TV devices.

## Entry Points — Read These First

1. `apps/tv/plugins/withTVHardwareFeatures.js` — managed-prebuild manifest transform.
2. `apps/tv/scripts/androidTVHardwareFeatures.test.js` — expected feature declarations and idempotency.
3. `apps/tv/app.json` — plugin order and TV package ID.

## Grep These

- `android.software.leanback`
- `android.hardware.touchscreen`
- `withTVHardwareFeatures`

## What To Build

Set `android.software.leanback` to `android:required="true"` in the TV app's generated manifest. Keep touchscreen, portrait, and microphone optional. Rebuild the AAB with the Google Play upload key and replace the unreleased version 6 bundle.

## Constraints

- Change only the TV app's Play device availability; do not change the separate mobile app.
- Keep the `LEANBACK_LAUNCHER` and Android TV banner.
- Do not publish to production or open testing.

## Verification

- Run the TV hardware-feature guard test and app-focused validation.
- Inspect the new AAB's signer and manifest; the signer must match Play's registered upload certificate.
- In the internal-release preview, TV devices must remain supported and phone/tablet support must return to zero before publishing.
