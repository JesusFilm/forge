---
status: pending
priority: p3
issue_id: "027"
title: The player controls stop hiding by themselves after a return from the mini player
labels:
  - mobile
  - ios
  - mini-player
created_at: 2026-10-15
---

# Problem

Seen on 2026-10-15 on the iPhone Air simulator (iOS 26.5, dev client), during the feat-705 review. The same steps give the same result on `main` (base `0c22078df`), so feat-705 did not cause it.

1. Open `forgemobile://watch/jesus` and let the video play.
2. Tap the back button. The video moves into the mini player.
3. Tap the mini player. The full player comes back, and the video still plays.
4. Tap the video to show the controls.

The controls stay on screen for more than 12 seconds. They should hide 3 seconds after the last tap, as they do on a fresh launch (measured: hidden after 3.9 s). A tap still hides them, and the next tap shows them again with no auto-hide.

# Likely area (not verified)

`useControlsVisibility` arms the hide timer only while `shouldArmHideTimer` reports a playing, ready player. After the hand-off back from the mini player, the hook may keep a paused or loading reading, because the `playingChange` or `statusChange` event that would correct it does not fire for the moved player.

# Next step

Log `isPausedRef` and `statusRef` in `useControlsVisibility` at step 4. Then decide whether the hook must read `player.playing` and `player.status` again when the player returns from the mini player.
