// The seam between the module-scope store and the live player (U6). The store
// outlives every player, so a dismiss, sign-out or host error reaches one
// only through this registration — else teardown files it "abandoned" (R16).

import type { SessionEndReason } from "./types"

export type SessionEndListener = (reason: SessionEndReason) => void

export function createSessionEndRegistry() {
  let active: SessionEndListener | null = null

  return {
    /**
     * Register the live player's named end. The release is identity-checked:
     * a departing session whose cleanup runs after its successor registered
     * must not clear the successor's listener.
     */
    register(listener: SessionEndListener): () => void {
      active = listener
      return () => {
        if (active === listener) active = null
      }
    },

    /**
     * Never throws. The store calls this while clearing its session, so a
     * failing flush must not leave a dead session on screen.
     */
    end(reason: SessionEndReason) {
      try {
        active?.(reason)
      } catch {
        // Telemetry and progress are best-effort; the session still ends.
      }
    },
  }
}

export type SessionEndRegistry = ReturnType<typeof createSessionEndRegistry>
