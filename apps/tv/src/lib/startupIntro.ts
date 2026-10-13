export const STARTUP_INTRO_TIMEOUT_MS = 7500

export function createStartupIntroSession() {
  let completed = false
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
