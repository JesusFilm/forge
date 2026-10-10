export type AudioFade = {
  inputRange: number[]
  outputRange: number[]
}

/**
 * Builds a valid Remotion interpolation range for clip audio. Short cards may
 * be briefer than the requested fade-in plus fade-out, so their fades meet in
 * the middle instead of crossing into a non-monotonic input range.
 */
export function audioFade(
  durationFrames: number,
  fadeInFrames: number,
  fadeOutFrames: number,
): AudioFade {
  const end = Math.max(1, Math.round(durationFrames))
  if (end === 1) {
    return { inputRange: [0, 1], outputRange: [0, 0] }
  }
  if (end === 2) {
    return { inputRange: [0, 1, 2], outputRange: [0, 1, 0] }
  }

  const fadeIn = Math.max(1, Math.round(fadeInFrames))
  const fadeOut = Math.max(1, Math.round(fadeOutFrames))
  if (fadeIn + fadeOut < end) {
    return {
      inputRange: [0, fadeIn, end - fadeOut, end],
      outputRange: [0, 1, 1, 0],
    }
  }

  const fadeInEnd = Math.min(
    end - 2,
    Math.max(1, Math.round(((end - 1) * fadeIn) / (fadeIn + fadeOut))),
  )
  return {
    inputRange: [0, fadeInEnd, fadeInEnd + 1, end],
    outputRange: [0, 1, 1, 0],
  }
}
