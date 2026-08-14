// A leaf on purpose. The root layout mounts the playback host, so anything the
// host imports is parsed and evaluated before the first paint. Reaching into
// VideoPlayer.tsx for these six lines pulled the whole player UI — the
// controls, scrubber, caption overlay, spinner and blur, plus expo-blur,
// expo-image and expo-linear-gradient — into the cold-launch graph, on an
// audience this very setting exists because they are on low-bandwidth devices.
//
// The expo-video import is type-only, so this module adds no native package.

import type { VideoPlayer } from "expo-video"

/**
 * Favor a fast first frame over deep prebuffer. Android-only fields are
 * ignored on iOS. Losing this is invisible — nothing errors, the first frame
 * just arrives later on exactly the networks it was written for.
 */
export function applyWatchBufferOptions(player: VideoPlayer) {
  player.bufferOptions = {
    minBufferForPlayback: 1,
    preferredForwardBufferDuration: 8,
    prioritizeTimeOverSizeThreshold: true,
  }
}
