/**
 * Labels a Media Collection CTA may not carry on their own.
 *
 * A bare "Watch" names no destination: on the Watch home it reads as a link to
 * the page the viewer is already on, and audits (W-096, Linear FGE-232) found
 * five rails whose identical "Watch" buttons led to different places. A CTA
 * label must say where it goes ("Watch the full story", "See all NUA
 * episodes").
 *
 * Shared by the admin write boundary, which rejects the label, and the web
 * renderer, which treats a stored one as absent and names the destination
 * itself — persisted block JSON outlives any one validator.
 */
const VAGUE_CTA_LABELS: ReadonlySet<string> = new Set([
  "watch",
  "see all",
  "view all",
  "read more",
  "more",
])

/**
 * Whether `value` is a bare, destination-less CTA label. Case, surrounding
 * whitespace, and punctuation are ignored, so "WATCH", " Watch " and
 * "Watch!" all count; "Watch the full story" does not.
 */
export function isVagueMediaCollectionCtaLabel(value: unknown): boolean {
  if (typeof value !== "string") return false
  const words = value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .trim()
    .split(/\s+/)
    .join(" ")
  return VAGUE_CTA_LABELS.has(words)
}
