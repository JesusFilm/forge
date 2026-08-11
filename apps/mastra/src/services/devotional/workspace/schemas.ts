import path from "node:path"

import { z } from "zod"

import {
  DEVOTIONAL_AUTHORED_PATHS,
  _internal as authoredSchemas,
} from "../authored-data"
import { parseJesusFilmCatalogDocument } from "../jesus-film-catalog"
import { parseJesusFilmPassagesDocument } from "../jesus-film-passages"
import { parseReflectionDocument } from "../reflection-corpus"
import { parseWebBibleDocument } from "../web-bible"
import { DevotionalWorkspaceError } from "./errors"

export const DEVOTIONAL_INPUT_CATEGORIES = [
  "scripture",
  "reflections",
  "video",
  "prompts",
  "safety",
  "calendar",
  "voices",
  "music",
  "render",
  "brand",
  "media",
] as const

export type DevotionalInputCategory =
  (typeof DEVOTIONAL_INPUT_CATEGORIES)[number]

export const SUPPORTED_DEVOTIONAL_TEXT_EXTENSIONS = [
  ".md",
  ".txt",
  ".json",
  ".yaml",
  ".yml",
] as const

const categories = new Set<string>(DEVOTIONAL_INPUT_CATEGORIES)
const supportedExtensions = new Set<string>(
  SUPPORTED_DEVOTIONAL_TEXT_EXTENSIONS,
)

const SafetyRubricSchema = z
  .object({
    minimumConfidence: z.number().min(0.6).max(1),
  })
  .passthrough()

const singletonSchemas = new Map<string, z.ZodType>([
  [DEVOTIONAL_AUTHORED_PATHS.prompts, authoredSchemas.PromptBundleSchema],
  [DEVOTIONAL_AUTHORED_PATHS.safety, authoredSchemas.SafetyPolicySchema],
  [DEVOTIONAL_AUTHORED_PATHS.holidays, authoredSchemas.HolidaysSchema],
  [DEVOTIONAL_AUTHORED_PATHS.voices, authoredSchemas.VoicesSchema],
  [DEVOTIONAL_AUTHORED_PATHS.music, authoredSchemas.MusicSchema],
  [DEVOTIONAL_AUTHORED_PATHS.narration, authoredSchemas.NarrationSchema],
  [DEVOTIONAL_AUTHORED_PATHS.render, authoredSchemas.RenderDocumentSchema],
  [DEVOTIONAL_AUTHORED_PATHS.brand, authoredSchemas.BrandSchema],
])

export type ValidatedWorkspaceDocument = {
  value: unknown
  title: string
}

export function normalizeDevotionalWorkspacePath(input: string): string {
  if (
    input.length === 0 ||
    !input.startsWith("/") ||
    input.includes("\\") ||
    input.includes("\0")
  ) {
    throw new DevotionalWorkspaceError(
      "unsafe-path",
      `Unsafe Workspace path: ${input}`,
      { details: { path: input } },
    )
  }

  const normalized = path.posix.normalize(input)
  if (
    normalized !== input ||
    input.split("/").some((segment) => segment === ".." || segment === ".")
  ) {
    throw new DevotionalWorkspaceError(
      "unsafe-path",
      `Workspace path is not canonical: ${input}`,
      { details: { path: input, normalized } },
    )
  }
  return normalized
}

export function categoryForWorkspacePath(
  input: string,
): DevotionalInputCategory | undefined {
  const normalized = normalizeDevotionalWorkspacePath(input)
  const match = /^\/inputs\/([^/]+)\/.+/.exec(normalized)
  if (!match || !categories.has(match[1] ?? "")) return undefined
  return match[1] as DevotionalInputCategory
}

export function isSupportedDevotionalTextPath(input: string): boolean {
  return supportedExtensions.has(path.posix.extname(input).toLowerCase())
}

function parseSafeYaml(content: string): Record<string, unknown> {
  if (/^\s*(?:---\s*)?$/u.test(content)) return {}
  if (/(^|\s)[&*][\w-]+|^\s*<<\s*:/mu.test(content)) {
    throw new Error("YAML aliases, anchors, and merge keys are not supported")
  }

  const value: Record<string, unknown> = {}
  for (const rawLine of content.split(/\r?\n/u)) {
    const line = rawLine.trim()
    if (line === "" || line === "---" || line.startsWith("#")) continue
    const separator = line.indexOf(":")
    if (separator < 1) {
      // Content-only YAML may contain list/prose structure. It is still source
      // data; singleton schemas below require concrete fields.
      continue
    }
    const key = line.slice(0, separator).trim()
    const rawValue = line.slice(separator + 1).trim()
    if (!/^[A-Za-z][A-Za-z0-9_-]*$/u.test(key)) {
      throw new Error("Invalid YAML key")
    }
    if (/^(?:true|false)$/iu.test(rawValue)) {
      value[key] = rawValue.toLowerCase() === "true"
    } else if (/^-?\d+(?:\.\d+)?$/u.test(rawValue)) {
      value[key] = Number(rawValue)
    } else {
      value[key] = rawValue.replace(/^['"]|['"]$/gu, "")
    }
  }
  return value
}

export function validateWorkspaceDocument(options: {
  path: string
  category: DevotionalInputCategory
  content: string
}): ValidatedWorkspaceDocument {
  const content = options.content.trim()
  if (content.length === 0) throw new Error("File is empty")

  const extension = path.posix.extname(options.path).toLowerCase()
  let value: unknown = content
  if (extension === ".json") value = JSON.parse(content)
  if (extension === ".yaml" || extension === ".yml") {
    value = parseSafeYaml(content)
  }

  if (options.category === "safety") {
    SafetyRubricSchema.parse(value)
  }
  singletonSchemas.get(options.path)?.parse(value)
  if (options.path === DEVOTIONAL_AUTHORED_PATHS.videoCatalog) {
    parseJesusFilmCatalogDocument({ path: options.path, content })
  }
  if (options.path === DEVOTIONAL_AUTHORED_PATHS.videoPassages) {
    parseJesusFilmPassagesDocument({ path: options.path, content })
  }
  if (options.category === "scripture") {
    parseWebBibleDocument({ path: options.path, content })
  }
  if (options.category === "reflections") {
    parseReflectionDocument({ path: options.path, content })
  }

  return {
    value,
    title: path.posix.basename(options.path, path.posix.extname(options.path)),
  }
}

export const _internal = { parseSafeYaml, SafetyRubricSchema }
