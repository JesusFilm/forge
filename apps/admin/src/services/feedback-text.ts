/**
 * Sanitizers for the client-supplied text that reaches a Linear feedback
 * ticket (U1, KTD2). A person writes this text on a phone, so it is
 * untrusted: it must not render as markup and it must not hide characters.
 *
 * The invisible-character strip is ported from the Datadog triage sweep
 * (`apps/mastra/src/services/datadog-triage/ticket-draft.ts`). The markdown
 * escape is ported from web (`apps/web/src/lib/feedback-linear.ts`), with one
 * change: `@` takes a backslash instead of web's zero-width insertion, because
 * the strip below deletes a zero-width character.
 *
 * The DESCRIPTION path never collapses whitespace: R17 quotes the message
 * verbatim, so line breaks and runs of spaces must survive. The TITLE path
 * does collapse, because a Linear title is one line.
 */

/** Characters that render as nothing. `Cf | Cc` alone misses it: ~4000
 * default-ignorable code points sit outside it, and one inside a scheme
 * (`https:<U+FE0F>//host`) leaves a link that still LOOKS ordinary. */
const INVISIBLE_RUN = /[\p{Cf}\p{Cc}\p{Default_Ignorable_Code_Point}]+/gu

/** The only invisibles that carry meaning: real separators. Deliberately not
 * regex `\s`, which also matches U+FEFF — a kept BOM could split a URL
 * scheme and reach the ticket as a space. */
const SEPARATORS = new Set(["\t", "\n", "\v", "\f", "\r"])

/** Drops every invisible character in a run except those separators. */
function deleteInvisible(value: string): string {
  return value.replace(INVISIBLE_RUN, (run) =>
    [...run].filter((ch) => SEPARATORS.has(ch)).join(""),
  )
}

/** Web's set plus `<`, which web omits and could open a tag-shaped run in
 * Linear's markdown rendering; escaped, it renders as itself, verbatim. */
const MARKDOWN_METACHARACTERS = /[\\`*_{}()#+\-.!|<>@[\]]/gu

/** Neutralizes one client-supplied string for the ticket DESCRIPTION. Strips
 * invisible characters FIRST — escaping first would leave a zero-width
 * character free to re-form a live URL once the strip removes it. */
export function safeFeedbackText(value: string): string {
  return deleteInvisible(value).replace(MARKDOWN_METACHARACTERS, "\\$&")
}

/** Line terminators `\p{Cc}` misses: U+2028/U+2029 are Zl/Zp, not controls. */
const TITLE_LINE_BREAK = /[\n\r\u2028\u2029]/u

/** Replaced with a space, not escaped: a Linear title is plain text, so
 * nothing renders, and no `\` is left dangling across the 120-char cut. */
const TITLE_STRUCTURAL_CHARS = /[\\`<>|@[\]]/gu

/** Ticket TITLE: keeps the first visible line, judged AFTER the strip so a
 * leading zero-width line can't swallow the real message below it. */
export function safeFeedbackTitleText(value: string): string {
  const source = deleteInvisible(value)
  const firstLine =
    source.split(TITLE_LINE_BREAK).find((line) => line.trim() !== "") ?? ""
  return firstLine
    .replace(TITLE_STRUCTURAL_CHARS, " ")
    .replace(/\s+/gu, " ")
    .trim()
}

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff
}

/** Cuts to `max` UTF-16 units. A cut landing inside a surrogate pair would
 * encode as U+FFFD on the wire, so the orphaned high surrogate is dropped. */
export function truncateWithoutSurrogateSplit(
  value: string,
  max: number,
): string {
  if (max <= 0) return ""
  if (value.length <= max) return value
  const cut = value.slice(0, max)
  return isHighSurrogate(cut.charCodeAt(cut.length - 1))
    ? cut.slice(0, -1)
    : cut
}
