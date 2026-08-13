---
title: "Long-lived Android emulator sessions degrade layered video compositing — cold-boot before diagnosing a black hero"
date: "2026-08-13"
category: "developer-experience"
module: "apps/mobile"
problem_type: developer_experience
component: development_workflow
severity: medium
applies_when:
  - "Diagnosing Android rendering (especially video surfaces under layered stacks) on an emulator"
  - "A previously verified rendering fix appears to have regressed on the emulator"
  - "The emulator has been running for hours or has logged gfxstream errors"
tags:
  - android-emulator
  - gfxstream
  - textureview
  - black-video
  - triage
  - hero
---

# Long-lived Android emulator sessions degrade layered video compositing — cold-boot before diagnosing a black hero

## Context

During the SDK 57 merge-compatibility pass (2026-08-13), the apps/mobile Android home hero rendered black on an emulator session with roughly 6 hours of uptime — with the verified compositing fixes in place and the identical bundle painting the watch page normally in the same session. The observation looked exactly like a code regression and cost about 40 minutes of re-diagnosis. A cold emulator boot restored full hero rendering with no code change. The same emulator's gfxstream had crashed earlier that day (`DisplaySurfaceGl.cpp: Failed to restore previous context`).

## Guidance

Treat emulator uptime as a suspect before treating a black video surface as a regression:

1. Check whether some other video surface still paints in the same session (in this app: the watch page). A globally wedged compositor blackens everything; session degradation can blacken only the layered TextureView path while direct surfaces keep painting.
2. Check emulator logs for gfxstream context loss:

   ```bash
   grep -iE "DisplaySurfaceGl|gfxstream" <emulator log>
   ```

3. Cold-boot the emulator (`-no-snapshot-load`) and re-test before touching code:

   ```bash
   emulator -avd Pixel_9a_API_35 -memory 4096 -no-snapshot-load
   ```

Only a black surface that survives a fresh emulator boot is evidence about the app.

## Why This Matters

The failure signature of emulator-session degradation is byte-identical to a real compositing regression: decode advances in logcat while the window stays black. On a day when real compositing fixes are in flight, the false signal points directly at the freshest code and invites reverting a correct fix. The triage cost is asymmetric: a cold boot takes two minutes; re-diagnosing a phantom regression took 40.

## When to Apply

- Any black-video or black-layer report from an Android emulator, before code archaeology.
- Especially when the emulator session is hours old, has slept, or has logged graphics-stack errors earlier in the session.

## Examples

The discriminating sequence from the incident: hero black + watch page painting (same session, same bundle) -> emulator suspected -> cold boot -> hero paints. Recorded as a triage comment on GitHub issue #1928.

## Related

- `docs/solutions/ui-bugs/android-home-hero-black-refreshcontrol-surfaceview-compositing.md` — the real compositing bug this artifact mimics; its logcat discriminator (decoding-while-black) cannot distinguish the two, only a cold boot can.
- Snapshot clock skew on the Android TV emulator (a cold boot fixes CertificateNotYetValid HLS failures) is the same cold-boot-first tool applied to a different emulator artifact.
