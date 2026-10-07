import { FIRST_STRONG_ISOLATE, POP_DIRECTIONAL_ISOLATE } from "./translator"

// A private-use character marks where an inline element (a link, an accent)
// sits in a translated sentence, so a language can put it anywhere.
export const INLINE_MARK = ""

const ISOLATE_MARKS = new RegExp(
  `[${FIRST_STRONG_ISOLATE}${POP_DIRECTIONAL_ISOLATE}]`,
  "g",
)

/** The text before and after `marker`; all of it is "before" when absent. */
export function splitAtMarker(
  sentence: string,
  marker: string,
): [string, string] {
  const at = sentence.indexOf(marker)
  if (at < 0) return [sentence, ""]
  // The translator isolates the value in a right-to-left catalog (KTD13).
  return [
    sentence.slice(0, at).replace(ISOLATE_MARKS, ""),
    sentence.slice(at + marker.length).replace(ISOLATE_MARKS, ""),
  ]
}
