/**
 * Playback-session settings (R13): speed + quality tier survive chrome
 * hide/show, fullscreen, backgrounding and the mini player, and reset when a
 * different video takes over. Factory + lazy singleton, matching `store.ts`.
 */

import { DEFAULT_QUALITY_TIER, type QualityTier } from "../streamQuality"

export { DEFAULT_QUALITY_TIER }

/** R4: YouTube's seven steps. */
export const PLAYBACK_SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2] as const

export type PlaybackSpeed = (typeof PLAYBACK_SPEEDS)[number]

export const DEFAULT_PLAYBACK_SPEED: PlaybackSpeed = 1

export type PlayerSettingsSnapshot = {
  speed: PlaybackSpeed
  qualityTier: QualityTier
  /** The content the settings belong to — the host's slug-stable `videoKey`,
   *  never id-shaped: the seed path flips videoId mid-playback. */
  contentKey: string | null
}

export type EffectivePlayerSettings = {
  speed: PlaybackSpeed
  qualityTier: QualityTier
}

export type PlayerSettingsStore = ReturnType<typeof createPlayerSettingsStore>

const DEFAULT_SNAPSHOT: PlayerSettingsSnapshot = {
  speed: DEFAULT_PLAYBACK_SPEED,
  qualityTier: DEFAULT_QUALITY_TIER,
  contentKey: null,
}

const DEFAULT_EFFECTIVE: EffectivePlayerSettings = {
  speed: DEFAULT_PLAYBACK_SPEED,
  qualityTier: DEFAULT_QUALITY_TIER,
}

function isPlaybackSpeed(value: number): value is PlaybackSpeed {
  return (PLAYBACK_SPEEDS as readonly number[]).includes(value)
}

/**
 * The stale-tier guard: stored settings apply ONLY to the content they were
 * set for, so a leftover tier never constrains a different video's first
 * load. `resetFor` remains cleanup; this is the read-side derivation.
 */
export function effectivePlayerSettings(
  snapshot: PlayerSettingsSnapshot,
  contentKey: string | null,
): EffectivePlayerSettings {
  const matches =
    snapshot.contentKey != null && snapshot.contentKey === contentKey
  if (!matches) return DEFAULT_EFFECTIVE
  return { speed: snapshot.speed, qualityTier: snapshot.qualityTier }
}

export function createPlayerSettingsStore() {
  let snapshot: PlayerSettingsSnapshot = DEFAULT_SNAPSHOT
  const listeners = new Set<() => void>()

  function commit(next: PlayerSettingsSnapshot) {
    snapshot = next
    for (const listener of listeners) listener()
  }

  return {
    getSnapshot(): PlayerSettingsSnapshot {
      return snapshot
    },

    subscribe(listener: () => void): () => void {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },

    /** R4: only the seven allowed values land; anything else is rejected. */
    setSpeed(speed: number): void {
      if (!isPlaybackSpeed(speed) || snapshot.speed === speed) return
      commit({ ...snapshot, speed })
    },

    setQualityTier(qualityTier: QualityTier): void {
      if (snapshot.qualityTier === qualityTier) return
      commit({ ...snapshot, qualityTier })
    },

    setContentKey(contentKey: string | null): void {
      if (snapshot.contentKey === contentKey) return
      commit({ ...snapshot, contentKey })
    },

    /**
     * R13: a different video taking over resets both settings; re-entering
     * the same content (fullscreen, mini player, replay) preserves them.
     */
    resetFor(contentKey: string): void {
      if (snapshot.contentKey === contentKey) return
      commit({ ...DEFAULT_SNAPSHOT, contentKey })
    },
  }
}

let store: PlayerSettingsStore | null = null

/** The app-wide playback-settings store. */
export function getPlayerSettingsStore(): PlayerSettingsStore {
  if (!store) store = createPlayerSettingsStore()
  return store
}
