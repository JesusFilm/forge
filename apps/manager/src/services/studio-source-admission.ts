import type { StudioDocument } from "@forge/studio-contracts"

/** Source admission resolves media identity and eligibility, not audio gain.
 * Keep presentation-only audio fields out of this request so media loading does
 * not depend on the hosted author's audio-envelope schema revision. The actual
 * preview/render/save document must retain its full audio settings. */
export function sourceAdmissionDocument(
  document: StudioDocument,
): StudioDocument {
  return {
    ...document,
    items: document.items.map((item) => {
      if (item.kind !== "video" && item.kind !== "audio") return item
      const sourceItem = { ...item }
      delete sourceItem.audioFade
      // Older source validators accept linear gain up to 2; it does not affect
      // source eligibility, ranges or the admitted media bytes.
      sourceItem.volume = Math.min(2, item.volume)
      return sourceItem
    }),
  }
}
