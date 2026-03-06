"use strict"

/* global module */

const MEDIA_COLLECTION_COMPONENT = "sections.media-collection"

/**
 * Normalize and count sectionKey values from sections. Only non-empty trimmed strings are counted.
 * @param {Array<{ __component?: string; sectionKey?: string | null }>} sections - Experience sections dynamic zone
 * @returns {Map<string, number>} key -> count of sections with that sectionKey
 */
function buildSectionKeyCount(sections) {
  const count = new Map()
  if (!Array.isArray(sections)) return count
  for (const section of sections) {
    const key =
      section?.sectionKey != null && typeof section.sectionKey === "string"
        ? section.sectionKey.trim()
        : ""
    if (key === "") continue
    count.set(key, (count.get(key) ?? 0) + 1)
  }
  return count
}

/**
 * Validate that every linkToSectionKey on media-collection items resolves to exactly one sectionKey in this Experience.
 * @param {Array} sections - Experience sections dynamic zone
 * @throws {Error} When a link target is missing (dead link) or ambiguous (duplicate sectionKey)
 */
function validateLinkToSectionKeys(sections) {
  const sectionKeyCount = buildSectionKeyCount(sections)
  if (!Array.isArray(sections)) return
  for (const section of sections) {
    if (section?.__component !== MEDIA_COLLECTION_COMPONENT) continue
    const items = section.items
    if (!Array.isArray(items)) continue
    for (const item of items) {
      const linkKey =
        item?.linkToSectionKey != null &&
        typeof item.linkToSectionKey === "string"
          ? item.linkToSectionKey.trim()
          : ""
      if (linkKey === "") continue
      const count = sectionKeyCount.get(linkKey) ?? 0
      if (count === 0) {
        throw new Error(
          `linkToSectionKey '${linkKey}' does not match any sectionKey in this Experience. Add a section with that sectionKey or clear the link.`,
        )
      }
      if (count > 1) {
        throw new Error(
          `More than one section has sectionKey '${linkKey}'. Use unique sectionKeys so linkToSectionKey can point to a single section.`,
        )
      }
    }
  }
}

module.exports = {
  beforeCreate(event) {
    const { data } = event.params ?? {}
    if (data?.sections) validateLinkToSectionKeys(data.sections)
  },
  beforeUpdate(event) {
    const { data } = event.params ?? {}
    if (data?.sections) validateLinkToSectionKeys(data.sections)
  },
}
