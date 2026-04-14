"use strict"

/* global require, module, strapi */
/* eslint-disable @typescript-eslint/no-require-imports */
const { errors } = require("@strapi/utils")

const EXPERIENCE_UID = "api::experience.experience"
const WATCH_SETTING_UID = "api::watch-setting.watch-setting"
const TEXT_COMPONENT = "sections.text"
const VIDEO_COMPONENTS = new Set(["sections.video", "sections.video-hero"])
const TEXT_PARAGRAPH_SPLIT_RE = /\r?\n\s*\r?\n/g
const ROUTE_VIDEO_COMPONENTS = new Set([
  "sections.video",
  "sections.video-hero",
])

const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value, key)

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

const usesRouteVideoChildren = (value) =>
  isRecord(value) && value.itemsSource === "routeVideoChildren"

const normalizeIdentifier = (value) => {
  if (typeof value === "number") {
    return { key: "id", value }
  }

  if (typeof value !== "string") return null

  if (/^\d+$/.test(value)) {
    return { key: "id", value: Number(value) }
  }

  return { key: "documentId", value }
}

const loadExperienceByWhere = async (where) => {
  if (!isRecord(where)) return null

  const reference = normalizeIdentifier(where.id ?? where.documentId)
  if (!reference) return null

  return strapi.db.query(EXPERIENCE_UID).findOne({
    where: { [reference.key]: reference.value },
    select: ["id", "documentId", "isTemplate", "blocks"],
  })
}

const loadBlockingWatchSettings = async (experience, relationName) => {
  if (!experience?.id) return []

  return strapi.db.query(WATCH_SETTING_UID).findMany({
    where: {
      [relationName]: {
        id: experience.id,
      },
    },
    select: ["id", "documentId"],
  })
}

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

const collectRouteBoundBlocks = (value, path = "blocks") => {
  if (Array.isArray(value)) {
    return value.flatMap((entry, index) =>
      collectRouteBoundBlocks(entry, `${path}[${index}]`),
    )
  }

  if (!isRecord(value)) return []

  const invalid = []
  const name = componentName(value)

  if (name && ROUTE_VIDEO_COMPONENTS.has(name) && usesRouteVideo(value)) {
    invalid.push(path)
  }

  if (name === "sections.media-collection" && usesRouteVideoChildren(value)) {
    invalid.push(path)
  }

  for (const [key, child] of Object.entries(value)) {
    invalid.push(...collectRouteBoundBlocks(child, `${path}.${key}`))
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

const validateRouteBoundBlocksRequireTemplate = (data, currentExperience) => {
  if (!isRecord(data)) return

  const templateExperience =
    typeof data.isTemplate === "boolean"
      ? data.isTemplate === true
      : currentExperience?.isTemplate === true

  const blocks = Array.isArray(data.blocks)
    ? data.blocks
    : Array.isArray(currentExperience?.blocks)
      ? currentExperience.blocks
      : null

  if (!blocks) return

  const invalidBlocks = collectRouteBoundBlocks(blocks)
  if (!invalidBlocks.length || templateExperience) return

  throw new errors.ApplicationError(
    `Route-bound video blocks require Experience.isTemplate to be enabled. Invalid blocks: ${invalidBlocks.join(", ")}`,
  )
}

const validateWatchSettingDependencies = async (data, currentExperience) => {
  if (!isRecord(data) || !hasOwn(data, "isTemplate")) return
  if (!currentExperience) return
  if (data.isTemplate === currentExperience.isTemplate) return

  const relationName =
    data.isTemplate === true
      ? "homepageExperience"
      : "defaultTemplateExperience"

  const blockingWatchSettings = await loadBlockingWatchSettings(
    currentExperience,
    relationName,
  )

  if (!blockingWatchSettings.length) return

  throw new errors.ApplicationError(
    data.isTemplate === true
      ? "Experience cannot be marked as template while it is selected as the homepage experience."
      : "Experience cannot be unmarked as template while it is selected as the default template experience.",
  )
}

// Dynamic import() for the TypeScript embedder — works with both vitest
// transforms and Strapi's production runtime (Node 18+).
const fireAndForgetIndex = (experienceId, locale) => {
  if (!process.env.OPENROUTER_API_KEY) return

  import("../../services/experience-embedder")
    .then(({ indexExperience }) =>
      indexExperience(strapi, experienceId, locale),
    )
    .catch((err) => {
      strapi.log.error(
        `[experience-embedding] Failed to index experience ${experienceId} (locale=${locale}): ${
          err instanceof Error ? err.message : String(err)
        }`,
      )
    })
}

const fireAndForgetDelete = (experienceId, locale) => {
  import("../../services/experience-embedder")
    .then(({ deleteExperienceEmbedding }) =>
      deleteExperienceEmbedding(strapi, experienceId, locale),
    )
    .catch((err) => {
      strapi.log.error(
        `[experience-embedding] Failed to delete embedding for experience ${experienceId} (locale=${locale}): ${
          err instanceof Error ? err.message : String(err)
        }`,
      )
    })
}

module.exports = {
  beforeCreate(event) {
    validateAuthoredVideoBlocks(event?.params?.data)
    validateRouteBoundBlocksRequireTemplate(event?.params?.data)
  },

  async beforeUpdate(event) {
    const currentExperience = await loadExperienceByWhere(event?.params?.where)

    validateAuthoredVideoBlocks(event?.params?.data)
    await validateRouteBoundBlocksRequireTemplate(
      event?.params?.data,
      currentExperience,
    )
    await validateWatchSettingDependencies(
      event?.params?.data,
      currentExperience,
    )
  },

  afterCreate(event) {
    const result = event?.result
    if (!result?.id || !result?.locale) return
    if (result.publishedAt == null && result.published_at == null) return

    fireAndForgetIndex(result.id, result.locale)
  },

  afterUpdate(event) {
    const result = event?.result
    if (!result?.id || !result?.locale) return

    const isPublished =
      result.publishedAt != null || result.published_at != null
    if (!isPublished) {
      fireAndForgetDelete(result.id, result.locale)
      return
    }

    fireAndForgetIndex(result.id, result.locale)
  },

  // Note: no beforeDelete hook for embeddings — the experience_embeddings
  // table has ON DELETE CASCADE on experience_id, so the DB handles cleanup
  // automatically when an experience is deleted.
}
