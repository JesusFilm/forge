// A leaf on purpose: the root layout mounts the playback host, so taking these
// six lines from VideoPlayer.tsx dragged the whole player UI plus expo-blur,
// expo-image and expo-linear-gradient into the cold-launch graph.

// Type-only, so this module still adds no native package.
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
