// Deterministic gradient placeholder for Experience search cards with no
// thumbnail — ports apps/web's VideoCard fallback (djb2 slug hash → 1 of 8
// palettes) so an experience is the same color on web, TV, and mobile.

/** Gradient colors accepted by expo-linear-gradient (needs >= 2 stops). */
export type GradientColors = readonly [string, string, ...string[]]
/** Gradient stop locations — same >= 2-length tuple shape as the colors. */
export type GradientLocations = readonly [number, number, ...number[]]

// 8 palettes ported from apps/web's EXPERIENCE_PLACEHOLDER_GRADIENTS. Tailwind v4
// class names resolved to sRGB hex (oklch → sRGB). Order MUST match web so the
// slug hash lands on the same palette cross-platform.
export const EXPERIENCE_GRADIENTS = [
  ["#7008e7", "#59168b", "#1e1a4d"], // violet-700 → purple-900 → indigo-950
  ["#f54900", "#973c00", "#0c0a09"], // orange-600 → amber-800 → stone-950
  ["#009966", "#005f5a", "#0c0a09"], // emerald-600 → teal-800 → stone-950
  ["#ec003f", "#a3004c", "#3c0366"], // rose-600 → pink-800 → purple-950
  ["#0084d1", "#193cb8", "#1e1a4d"], // sky-600 → blue-800 → indigo-950
  ["#c10007", "#8b0836", "#0c0a09"], // red-700 → rose-900 → stone-950
  ["#5ea500", "#016630", "#002c22"], // lime-600 → green-800 → emerald-950
  ["#c800de", "#6e11b0", "#1e1a4d"], // fuchsia-600 → purple-800 → indigo-950
] as const satisfies readonly (readonly [string, string, string])[]

/**
 * Pick a palette from the slug — identical djb2 to web's gradientForSlug (seed
 * 5381, `((hash * 33) ^ charCode) | 0`), so the same experience is the same
 * color on every platform.
 */
export function experienceGradientForSlug(
  slug: string,
): readonly [string, string, string] {
  let hash = 5381
  for (let i = 0; i < slug.length; i++) {
    hash = ((hash * 33) ^ slug.charCodeAt(i)) | 0
  }
  return EXPERIENCE_GRADIENTS[Math.abs(hash) % EXPERIENCE_GRADIENTS.length]
}

const STRIPE_ON = "rgba(255,255,255,0.05)"
const STRIPE_OFF = "rgba(255,255,255,0)"

/**
 * Diagonal stripe bands for the fallback — expo-linear-gradient can't do a
 * repeating gradient, so emit `count` hard-stop bands (14:18 on:off duty) as one
 * gradient's colors + locations. Fractional stops, so build once regardless of size.
 */
export function buildStripeGradient(count = 14): {
  colors: GradientColors
  locations: GradientLocations
} {
  const colors: string[] = []
  const locations: number[] = []
  const period = 1 / count
  const duty = 14 / 32 // web's 14px stripe within a 32px period
  for (let i = 0; i < count; i++) {
    const start = i * period
    const mid = start + period * duty
    // (i + 1) * period, not start + period — bit-identical to the next band's
    // start so float drift can't make locations tick backwards (gradient needs
    // them non-decreasing).
    const end = (i + 1) * period
    colors.push(STRIPE_ON, STRIPE_ON, STRIPE_OFF, STRIPE_OFF)
    locations.push(start, mid, mid, end)
  }
  // 4*count entries (>= 4) always satisfies the >=2-stop tuple the gradient needs.
  return {
    colors: colors as unknown as GradientColors,
    locations: locations as unknown as GradientLocations,
  }
}
