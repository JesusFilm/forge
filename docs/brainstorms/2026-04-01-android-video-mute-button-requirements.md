---
date: 2026-04-01
topic: android-video-mute-button
---

# Android Video Mute Button for Inline Videos

## Problem Frame

On Android, `VideoRenderer` (inline video sections) starts muted and relies on `expo-video`'s `nativeControls` for unmuting. However, Android's native video controls do not include a mute/unmute toggle — only play/pause, seek, and fullscreen. Users have no way to hear inline videos on Android. iOS native controls handle volume correctly and need no change.

## Requirements

- R1. **Android-only mute button.** Render a custom mute/unmute toggle on `VideoRenderer` when `Platform.OS === "android"`. iOS continues using native controls for volume.
- R2. **Match iOS behavior.** The mute button should toggle audio on/off and update its icon to reflect the current state (VolumeOffIcon when muted, VolumeOnIcon when unmuted), mirroring how the iOS native player's volume control behaves.
- R3. **Reuse existing patterns.** Follow the same mute toggle pattern already used in `VideoHeroRenderer` (icon components, state management, `player.muted` sync).

## Success Criteria

- On Android, inline videos display a visible mute/unmute button.
- Tapping the button toggles audio and the icon reflects the current state.
- On iOS, no custom mute button appears — native controls remain unchanged.

## Scope Boundaries

- Out of scope: changing the debounced re-mute on scroll-away behavior (lines 63-71 of VideoRenderer).
- Out of scope: any changes to VideoHeroRenderer or iOS behavior.

## Next Steps

→ `/ce:plan` for structured implementation planning, or proceed directly to fix.
