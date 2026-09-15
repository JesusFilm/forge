/**
 * Which backdrop a Bible quote card draws between its still and its text. Its
 * own module so the choice is one line, and so each path can be rendered under
 * test — a treatment the suite cannot reach is a treatment with no contrast guard.
 */

/** `none` is deliberately absent: 8 of 10 measured stills fail 4.5:1 bare. */
export type BibleCardTreatment = "scrim" | "frosted"

export const CARD_TREATMENT: BibleCardTreatment = "frosted"

/**
 * 0.54 is the FLOOR, not a preference: the least tint clearing 4.5:1 for opaque
 * white over a pure-white still. Blur cannot help — it removes DETAIL, not
 * luminance. Black rather than the card colour, which reaches the floor sooner.
 */
export const FROSTED_TINT = "rgba(0, 0, 0, 0.54)"

/** iOS only, and purely aesthetic — the tint above is what the floor rests on. */
export const FROSTED_BLUR_INTENSITY = 22
