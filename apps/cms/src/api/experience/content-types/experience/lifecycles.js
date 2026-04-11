"use strict"

const { errors } = require("@strapi/utils")

const TEXT_COMPONENT = "sections.text"
const VIDEO_COMPONENTS = new Set(["sections.video", "sections.video-hero"])
const TEXT_PARAGRAPH_SPLIT_RE = /\r?\n\s*\r?\n/g

const isRecord = (value) =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const componentName = (value) => {
  if (!isRecord(value)) return null
  if (typeof value.__component === "string") return value.__component
  return null
}

const hasStreamingUrl = (value) =>
  isRecord(value) &&
  typeof value.streamingUrl === "string" &&
  value.streamingUrl.trim().length > 0

const usesRouteVideo = (value) =>
  isRecord(value) && value.useRouteVideo === true

const normalizeParagraphString = (value) =>
  value
    .split(TEXT_PARAGRAPH_SPLIT_RE)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)

const normalizeParagraphArray = (value, path) => {
  const normalized = value.map((paragraph) => {
    if (typeof paragraph !== "string") {
      throw new errors.ApplicationError(
        `Text blocks require contentParagraphs to be an array of strings. Invalid value at ${path}.`,
      )
    }

    return paragraph.trim()
  })

  return normalized.filter(Boolean)
}

const normalizeTextParagraphsValue = (value, path) => {
  if (value == null) return value

  if (Array.isArray(value)) {
    return normalizeParagraphArray(value, path)
  }

  if (typeof value === "string") {
    const trimmed = value.trim()
    if (!trimmed) return []

    try {
      const parsed = JSON.parse(trimmed)

      if (Array.isArray(parsed)) {
        return normalizeParagraphArray(parsed, path)
      }

      if (typeof parsed === "string") {
        return normalizeParagraphString(parsed)
      }
    } catch {
      return normalizeParagraphString(value)
    }

    throw new errors.ApplicationError(
      `Text blocks require contentParagraphs to be plain text or a JSON array of strings. Invalid value at ${path}.`,
    )
  }

  throw new errors.ApplicationError(
    `Text blocks require contentParagraphs to be plain text or a JSON array of strings. Invalid value at ${path}.`,
  )
}

const normalizeTextBlocks = (value, path = "blocks") => {
  if (Array.isArray(value)) {
    value.forEach((entry, index) =>
      normalizeTextBlocks(entry, `${path}[${index}]`),
    )
    return
  }

  if (!isRecord(value)) return

  const name = componentName(value)

  if (name === TEXT_COMPONENT) {
    if ("contentParagraphs" in value) {
      value.contentParagraphs = normalizeTextParagraphsValue(
        value.contentParagraphs,
        `${path}.contentParagraphs`,
      )
    }

    if ("content_paragraphs" in value) {
      value.content_paragraphs = normalizeTextParagraphsValue(
        value.content_paragraphs,
        `${path}.content_paragraphs`,
      )
    }
  }

  for (const [key, child] of Object.entries(value)) {
    normalizeTextBlocks(child, `${path}.${key}`)
  }
}

const collectInvalidVideoBlocks = (value, path = "blocks") => {
  if (Array.isArray(value)) {
    return value.flatMap((entry, index) =>
      collectInvalidVideoBlocks(entry, `${path}[${index}]`),
    )
  }

  if (!isRecord(value)) return []

  const invalid = []
  const name = componentName(value)

  if (
    name &&
    VIDEO_COMPONENTS.has(name) &&
    !usesRouteVideo(value) &&
    !hasStreamingUrl(value)
  ) {
    invalid.push(path)
  }

  for (const [key, child] of Object.entries(value)) {
    invalid.push(...collectInvalidVideoBlocks(child, `${path}.${key}`))
  }

  return invalid
}

const validateAuthoredVideoBlocks = (data) => {
  if (!isRecord(data) || !Array.isArray(data.blocks)) return

  normalizeTextBlocks(data.blocks)

  const invalidBlocks = collectInvalidVideoBlocks(data.blocks)
  if (!invalidBlocks.length) return

  throw new errors.ApplicationError(
    `Authored video blocks require a streamingUrl unless useRouteVideo is enabled. Invalid blocks: ${invalidBlocks.join(", ")}`,
  )
}

module.exports = {
  beforeCreate(event) {
    validateAuthoredVideoBlocks(event?.params?.data)
  },

  beforeUpdate(event) {
    validateAuthoredVideoBlocks(event?.params?.data)
  },
}
