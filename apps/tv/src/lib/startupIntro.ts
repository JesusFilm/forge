import { STARTUP_ANIMATION_ENABLED } from "./logoAnimations"

export const STARTUP_INTRO_TIMEOUT_MS = 7500

export function createStartupIntroSession(enabled = STARTUP_ANIMATION_ENABLED) {
  let completed = !enabled
  return {
    isActive: () => !completed,
    finish(stopAudio: () => void): boolean {
      if (completed) return false
      stopAudio()
      completed = true
      return true
    },
  }
}
