---
status: pending
priority: p2
issue_id: "026"
title: The video player stays drawn over a root route that a deep link pushes on top of a watch page
labels:
  - mobile
  - ios
  - mini-player
created_at: 2026-10-15
---

# Problem

Seen on 2026-10-15 on the iPhone Air simulator (iOS 26.5, dev client), during the feat-699 brainstorm.

1. Open `forgemobile://watch/the-birth-of-jesus` and let the video play.
2. Open `forgemobile://downloads` while the watch page is still on screen.

The Downloads screen pushes on top of the watch page, but `PlaybackHost` keeps drawing the full-size player, with its chrome, at the watch page's slot. The player covers the top of the Downloads list. It does not move into the floating window. A screenshot two seconds later shows the same state, so this is not a transition frame.

A cold launch straight into `forgemobile://downloads` shows the Downloads screen correctly.

# Likely area (not verified)

The watch page stays mounted under the pushed route, so its `PlayerSlot` keeps its rect. The covered-slot handling in `apps/mobile/src/lib/miniPlayer/presentation.ts` (`isReaderCovering`) names only the Bible reader routes. So a different root route pushed over a watch page may never cover the slot.

# Next step

Reproduce it through an in-app path, not only a deep link: for example, a push or announcement tap that opens a root route while a video plays. Then decide whether every root route pushed over a watch slot should cover it, as the reader routes do.
