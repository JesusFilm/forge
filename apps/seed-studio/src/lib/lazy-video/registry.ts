/**
 * LRU registry for live HLS player instances in the seed-studio preview.
 *
 * HLS.js players hold ~25MB each (MediaSource buffers, parsed segments,
 * decryption workers). With 20 video blocks on a preview page this adds
 * up to ~500MB, enough to get us OOM-killed by Railway and enough to
 * make the studio unusable on lower-spec laptops.
 *
 * The registry enforces a cap of `MAX_ACTIVE` concurrent players. When
 * a new player registers and the cap is already reached, the oldest
 * (least-recently-touched) entry is destroyed first. Players must call
 * `touchPlayer` on user interaction (play/pause/seek) to stay recent.
 *
 * On viewport-exit or unmount the player calls `unregisterPlayer` and
 * owns its own cleanup; the registry only calls `destroy` when evicting.
 */

const MAX_ACTIVE = 2

type Entry = {
  id: string
  destroy: () => void
  lastActive: number
}

// Module-level state; the registry is a singleton per window.
let entries: Entry[] = []

/**
 * Register a new active player. If the registry is at cap, the oldest
 * entry is evicted (its `destroy()` is called) before the new entry is
 * added.
 *
 * Callers should use a stable, unique `id` (e.g. sectionKey + src) so
 * that the registry never holds two entries for the same DOM node.
 */
export function registerPlayer(id: string, destroy: () => void): void {
  // Defensive: if an entry with this id already exists (hot reload,
  // re-render race), drop the stale one without calling destroy —
  // the caller is replacing it.
  entries = entries.filter((entry) => entry.id !== id)

  if (entries.length >= MAX_ACTIVE) {
    // Find the oldest lastActive and evict it.
    let oldestIndex = 0
    for (let i = 1; i < entries.length; i++) {
      if (entries[i].lastActive < entries[oldestIndex].lastActive) {
        oldestIndex = i
      }
    }
    const evicted = entries[oldestIndex]
    entries.splice(oldestIndex, 1)
    try {
      evicted.destroy()
    } catch {
      // Player already torn down; swallow.
    }
  }

  entries.push({ id, destroy, lastActive: Date.now() })
}

/**
 * Mark a player as most-recently-active. Called on play/pause/seek.
 */
export function touchPlayer(id: string): void {
  const entry = entries.find((candidate) => candidate.id === id)
  if (!entry) return
  entry.lastActive = Date.now()
}

/**
 * Remove a player from the registry without calling destroy. The
 * caller is expected to own the teardown (e.g. the React cleanup
 * effect already disposed HLS).
 */
export function unregisterPlayer(id: string): void {
  entries = entries.filter((entry) => entry.id !== id)
}

/**
 * Test/debug helper: how many players are currently registered.
 */
export function getActivePlayerCount(): number {
  return entries.length
}
