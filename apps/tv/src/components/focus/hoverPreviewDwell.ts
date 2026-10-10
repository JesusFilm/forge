// Pure dwell state machine for the Mux animated hover-preview (R1, R2). React-free
// .ts so it's unit-testable under jest-expo, mirroring showcaseState's
// createShowcaseFocusDebouncer. useHoverPreview holds one instance in a ref.

// Focus must rest this long before a preview loads — long enough that a D-pad
// sweeping a rail doesn't fetch a preview per card (Mux bills per image).
export const HOVER_PREVIEW_DWELL_MS = 400

// Eligibility gate (R3, R4): focused + surface-enabled (not series) + a playback
// id + reduce-motion off. Centralized so every surface shares one rule.
export function computeHoverPreviewActive(args: {
  focused: boolean
  enabled: boolean
  playbackId: string | null | undefined
  reduceMotion: boolean
}): boolean {
  return args.focused && args.enabled && !!args.playbackId && !args.reduceMotion
}

export type HoverPreviewDwell = {
  // Feed the composed active flag; a trailing timer fires onDwell after it settles true.
  setActive: (active: boolean) => void
  // Unmount cleanup: clear a pending timer WITHOUT firing onLeave (no setState post-unmount).
  cancel: () => void
}

// Trailing dwell: active settling true for delayMs fires onDwell once; active
// going false tears down via onLeave. Never latches (the web inversion), so
// leaving a card frees its preview and only the focused card ever decodes.
export function createHoverPreviewDwell(
  onDwell: () => void,
  onLeave: () => void,
  delayMs: number = HOVER_PREVIEW_DWELL_MS,
): HoverPreviewDwell {
  let timer: ReturnType<typeof setTimeout> | null = null
  let previewing = false
  return {
    setActive(active) {
      if (active) {
        if (timer != null || previewing) return
        timer = setTimeout(() => {
          timer = null
          previewing = true
          onDwell()
        }, delayMs)
      } else {
        if (timer != null) {
          clearTimeout(timer)
          timer = null
        }
        if (previewing) {
          previewing = false
          onLeave()
        }
      }
    },
    cancel() {
      if (timer != null) {
        clearTimeout(timer)
        timer = null
      }
      previewing = false
    },
  }
}
