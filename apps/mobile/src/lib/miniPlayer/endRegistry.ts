// The seam between the module-scope session store and the live player (U6).
//
// The store exists before any player does, so a store-driven end — a dismiss,
// a sign-out, a host error — can only reach the player through a registration
// the host makes when it creates one. Without it the store just drops the
// session and React teardown files the QoE summary as "abandoned", which is
// the misattribution R16/R17 exist to fix.

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
