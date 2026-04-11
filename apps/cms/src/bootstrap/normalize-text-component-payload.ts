import type { Core } from "@strapi/strapi"
import path from "node:path"
import { createRequire } from "node:module"

const require = createRequire(import.meta.url)

const strapiPackagePath = require.resolve("@strapi/strapi", {
  paths: [process.cwd(), __dirname],
})

const strapiUtilsPath = require.resolve("@strapi/utils", {
  paths: [path.dirname(strapiPackagePath)],
})

const { errors } = require(strapiUtilsPath) as {
  errors: {
    ApplicationError: new (message: string) => Error
  }
}

const TEXT_COMPONENT_UID = "sections.text"
const TEXT_PARAGRAPH_SPLIT_RE = /\r?\n\s*\r?\n/g

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function normalizeParagraphString(value: string): string[] {
  return value
    .split(TEXT_PARAGRAPH_SPLIT_RE)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
}

function normalizeParagraphArray(value: unknown[], path: string): string[] {
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

function normalizeParagraphValue(value: unknown, path: string): unknown {
  if (value == null) return value

  if (Array.isArray(value)) {
    return normalizeParagraphArray(value, path)
  }

  if (typeof value === "string") {
    const trimmed = value.trim()
    if (!trimmed) return []

    try {
      const parsed = JSON.parse(trimmed) as unknown

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

function normalizeTextComponentData(data: unknown): void {
  if (!isRecord(data)) return

  if ("contentParagraphs" in data) {
    data.contentParagraphs = normalizeParagraphValue(
      data.contentParagraphs,
      "contentParagraphs",
    )
  }

  if ("content_paragraphs" in data) {
    data.content_paragraphs = normalizeParagraphValue(
      data.content_paragraphs,
      "content_paragraphs",
    )
  }
}

export function registerTextComponentPayloadNormalization(
  strapi: Core.Strapi,
): void {
  strapi.db.lifecycles.subscribe({
    models: [TEXT_COMPONENT_UID],

    beforeCreate(event) {
      normalizeTextComponentData(event.params?.data)
    },

    beforeUpdate(event) {
      normalizeTextComponentData(event.params?.data)
    },
  })
}
