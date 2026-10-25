import { getPlayerSettingsStore } from "../lib/miniPlayer/playerSettings"

// Idempotent field-wise reset: `resetFor` early-returns on a matching key, so
// it cannot serve as a full reset on its own.
export function resetPlayerSettings() {
  const settings = getPlayerSettingsStore()
  settings.setSpeed(1)
  settings.setQualityTier("auto")
  settings.setContentKey(null)
}
