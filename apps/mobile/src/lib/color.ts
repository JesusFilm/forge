/**
 * Convert a hex color (3 or 6 digit) to an rgba string with the given alpha.
 *
 * Use this instead of the CSS keyword "transparent" in LinearGradient color
 * arrays to avoid dark banding artifacts on non-black backgrounds.
 * See: docs/solutions/mobile/linear-gradient-dark-banding-transparent-keyword.md
 */
export function hexToRgba(hex: string, alpha: number): string {
  const stripped = hex.replace("#", "")
  const expanded =
    stripped.length === 3
      ? stripped[0] +
        stripped[0] +
        stripped[1] +
        stripped[1] +
        stripped[2] +
        stripped[2]
      : stripped

  if (expanded.length !== 6 || !/^[0-9a-fA-F]{6}$/.test(expanded)) {
    return `rgba(26,24,21,${alpha})` // #1A1815 as safe default
  }

  const r = parseInt(expanded.substring(0, 2), 16)
  const g = parseInt(expanded.substring(2, 4), 16)
  const b = parseInt(expanded.substring(4, 6), 16)
  return `rgba(${r},${g},${b},${alpha})`
}
