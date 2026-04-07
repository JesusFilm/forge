/** App base background color (warm dark). */
export const BG_COLOR = "#1c1917"

/**
 * Convert a hex color to rgba string.
 * Use this instead of "transparent" in LinearGradient to avoid dark banding.
 * "transparent" is rgba(0,0,0,0) — interpolating from it to non-black colors
 * passes through dark intermediate tones.
 */
export function hexToRgba(hex: string, alpha: number): string {
  const cleaned = hex.replace("#", "")
  const r = parseInt(cleaned.substring(0, 2), 16)
  const g = parseInt(cleaned.substring(2, 4), 16)
  const b = parseInt(cleaned.substring(4, 6), 16)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}
