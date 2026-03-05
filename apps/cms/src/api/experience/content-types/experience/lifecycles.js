"use strict"

const MEDIA_COLLECTION_COMPONENT = "sections.media-collection"
const LINK_TARGET_XOR_MESSAGE =
  "Each carousel item may have either linkToSectionKey or linkToVideo, not both. Please clear one of them."

/**
 * Validates that no media-collection item has both linkToSectionKey and linkToVideo set (XOR).
 * @param {Array<{ __component?: string; items?: Array<{ linkToSectionKey?: string | null; linkToVideo?: unknown }> }>} sections - Experience sections dynamic zone
 * @throws {Error} When any item has both fields set
 */
function validateMediaCollectionItemLinkTargets(sections) {
  if (!Array.isArray(sections)) return
  for (const section of sections) {
    if (section?.__component !== MEDIA_COLLECTION_COMPONENT) continue
    const items = section.items
    if (!Array.isArray(items)) continue
    for (let i = 0; i < items.length; i++) {
      const item = items[i]
      const hasSectionKey =
        item?.linkToSectionKey != null &&
        String(item.linkToSectionKey).trim() !== ""
      const hasVideo = item?.linkToVideo != null && item.linkToVideo !== ""
      if (hasSectionKey && hasVideo) {
        throw new Error(
          `Media collection item at index ${i}: ${LINK_TARGET_XOR_MESSAGE}`,
        )
      }
    }
  }
}

module.exports = {
  beforeCreate(event) {
    const { data } = event.params ?? {}
    if (data?.sections) validateMediaCollectionItemLinkTargets(data.sections)
  },
  beforeUpdate(event) {
    const { data } = event.params ?? {}
    if (data?.sections) validateMediaCollectionItemLinkTargets(data.sections)
  },
}
