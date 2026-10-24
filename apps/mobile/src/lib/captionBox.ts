/**
 * A box in the frame of a caption's parent: `left` and `right` from the
 * parent's left edge, and `bottom` and `top` measured UP from the parent's
 * bottom edge, where a caption anchors. So `top` is larger than `bottom`.
 */
export type CaptionBox = {
  left: number
  right: number
  bottom: number
  top: number
}

/** Whether the caption covers part of any box. Edges that only touch do not. */
export function captionMeetsBox(
  caption: CaptionBox,
  boxes: readonly CaptionBox[],
): boolean {
  return boxes.some(
    (box) =>
      caption.left < box.right &&
      box.left < caption.right &&
      caption.bottom < box.top &&
      box.bottom < caption.top,
  )
}
