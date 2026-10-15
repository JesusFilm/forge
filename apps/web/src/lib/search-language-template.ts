/**
 * Splits a plain search template (for example `"ب{language}"`) around its
 * `{token}` placeholders so a caller can substitute a rich element for a token,
 * and reports on which sides each placeholder is glued to neighbouring copy.
 *
 * Many catalogs attach a clitic, particle, or punctuation directly to the
 * placeholder (Arabic `ب{language}`, Hebrew `ב־{language}`, Amharic
 * `በ{language}`, Japanese `{language}で`, Maltese `bil-{language}`, a trailing
 * `{language}:`). The substituted element is an inline chip with its own outer
 * spacing; that spacing must collapse on any side where the template has no
 * whitespace, or the glued copy reads as a detached word ("ب العربية").
 *
 * Sides are LOGICAL (inline-start / inline-end), not physical: a template is
 * authored in reading order, so the character before a placeholder is on its
 * inline-start side in both LTR and RTL.
 */

export type SearchLanguageTemplateSegment =
  | { kind: "text"; text: string }
  | {
      kind: "placeholder"
      /** The matched token including braces, e.g. `{language}`. */
      token: string
      /** Non-whitespace copy, or another placeholder, touches the inline-start edge. */
      attachedStart: boolean
      /** Non-whitespace copy, or another placeholder, touches the inline-end edge. */
      attachedEnd: boolean
    }

// Invisible bidi controls (LRM, RLM, ALM, embeddings/overrides/isolates) are
// layout hints, not copy: "foo ‏{language}" still has a real space before
// the placeholder.
const IGNORABLE_BIDI_CONTROL = /[؜‎‏‪-‮⁦-⁩]/u
const WHITESPACE = /\s/u

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

/**
 * Whether the nearest visible character of `text`, scanned from the edge that
 * faces the placeholder, is non-whitespace. `null` means the text holds only
 * bidi controls, so the caller should look at the next neighbour.
 */
function textTouchesPlaceholder(
  text: string,
  scan: "from-start" | "from-end",
): boolean | null {
  const chars = Array.from(text)
  if (scan === "from-end") chars.reverse()
  for (const char of chars) {
    if (IGNORABLE_BIDI_CONTROL.test(char)) continue
    return !WHITESPACE.test(char)
  }
  return null
}

export function splitSearchLanguageTemplate(
  template: string,
  tokens: readonly string[],
): SearchLanguageTemplateSegment[] {
  const placeholders = new Set(tokens)
  const pattern = new RegExp(`(${tokens.map(escapeRegExp).join("|")})`, "u")
  const parts = template.split(pattern).filter((part) => part !== "")

  const attachedAcross = (
    neighbours: readonly string[],
    scan: "from-start" | "from-end",
  ): boolean => {
    for (const neighbour of neighbours) {
      // Two placeholders with nothing between them are glued together.
      if (placeholders.has(neighbour)) return true
      const touches = textTouchesPlaceholder(neighbour, scan)
      if (touches !== null) return touches
    }
    // Template edge: nothing to be glued to.
    return false
  }

  return parts.map((part, index): SearchLanguageTemplateSegment => {
    if (!placeholders.has(part)) return { kind: "text", text: part }
    return {
      kind: "placeholder",
      token: part,
      attachedStart: attachedAcross(
        parts.slice(0, index).reverse(),
        "from-end",
      ),
      attachedEnd: attachedAcross(parts.slice(index + 1), "from-start"),
    }
  })
}
