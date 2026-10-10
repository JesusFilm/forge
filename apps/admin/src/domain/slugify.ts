/**
 * Base slug for a generated-Experience topic: lowercased, non-alphanumerics
 * collapsed to "-", edge dashes trimmed. Non-Latin topics collapse to the
 * literal "experience" — callers targeting non-Latin locales should pass an
 * explicit slug instead of deriving one.
 *
 * Single-sourced here so the operator CLI (`variantSlug` in
 * generate-persona-variants.ts) and the MCP generate tool derive IDENTICAL
 * slugs for the same topic — their slug-collision idempotency checks depend
 * on it.
 */
export function topicBaseSlug(topic: string): string {
  const base = topic
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
  return base || "experience"
}
