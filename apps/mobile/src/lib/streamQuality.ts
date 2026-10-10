import { MUX_STREAM_HOST, cleanStreamUrl } from "./validateUrl"

export const QUALITY_TIERS = ["auto", "low", "high", "highest"] as const

export type QualityTier = (typeof QUALITY_TIERS)[number]

/** R6: Auto is the default — no constraint, fully adaptive. */
export const DEFAULT_QUALITY_TIER: QualityTier = "auto"

export type ConstrainedQualityTier = Exclude<QualityTier, "auto">

/** R7: low and high cap the resolution; highest sets a FLOOR, so within a
 *  tier the stream still adapts and Highest stays a real choice. */
const TIER_MODIFIERS: Record<
  ConstrainedQualityTier,
  { name: "max_resolution" | "min_resolution"; value: string }
> = {
  low: { name: "max_resolution", value: "480p" },
  high: { name: "max_resolution", value: "720p" },
  highest: { name: "min_resolution", value: "1080p" },
}

const MODIFIER_NAMES = ["max_resolution", "min_resolution"] as const

function parseMuxStreamUrl(url: string): URL | null {
  const cleaned = cleanStreamUrl(url)
  if (!cleaned) return null
  try {
    const parsed = new URL(cleaned)
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null
    return parsed.hostname === MUX_STREAM_HOST ? parsed : null
  } catch {
    return null
  }
}

/**
 * Apply the tier's Mux playback modifier to a stream URL. Auto and every
 * non-Mux URL (offline file://, non-Mux stream, unparseable) pass through
 * untouched. A previous constraint is replaced, never stacked.
 */
export function applyQualityConstraint(url: string, tier: QualityTier): string {
  if (tier === "auto") return url
  const parsed = parseMuxStreamUrl(url)
  if (!parsed) return url
  for (const name of MODIFIER_NAMES) parsed.searchParams.delete(name)
  const modifier = TIER_MODIFIERS[tier]
  parsed.searchParams.set(modifier.name, modifier.value)
  return parsed.toString()
}

/**
 * R9, checked at the point of use: quality options exist only where the
 * constraint can act — a Mux http(s) stream. Offline file:// and non-Mux
 * URLs (which applyQualityConstraint passes through) answer false.
 */
export function supportsQualityConstraint(url: string | null): boolean {
  return url != null && parseMuxStreamUrl(url) != null
}

type QualityConstraint = {
  maxResolution: string | null
  minResolution: string | null
}

const NO_CONSTRAINT: QualityConstraint = {
  maxResolution: null,
  minResolution: null,
}

function readQualityConstraint(url: string): QualityConstraint {
  const cleaned = cleanStreamUrl(url)
  if (!cleaned) return NO_CONSTRAINT
  try {
    const parsed = new URL(cleaned)
    return {
      maxResolution: parsed.searchParams.get("max_resolution"),
      minResolution: parsed.searchParams.get("min_resolution"),
    }
  } catch {
    return NO_CONSTRAINT
  }
}

/**
 * Compare ONLY the constraint-relevant params of two URLs. The swap-admission
 * guard uses this: unrelated params never affect equality.
 */
export function sameQualityConstraint(a: string, b: string): boolean {
  const left = readQualityConstraint(a)
  const right = readQualityConstraint(b)
  return (
    left.maxResolution === right.maxResolution &&
    left.minResolution === right.minResolution
  )
}
