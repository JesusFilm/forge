import { createHash } from "node:crypto"
import path from "node:path"

import type { WorkspaceFilesystem } from "@mastra/core/workspace"

import { DEVOTIONAL_AUTHORED_PATHS } from "../authored-data"
import { DevotionalWorkspaceError, isDevotionalWorkspaceError } from "./errors"
import {
  DEVOTIONAL_INPUT_CATEGORIES,
  categoryForWorkspacePath,
  isSupportedDevotionalTextPath,
  normalizeDevotionalWorkspacePath,
  validateWorkspaceDocument,
  type DevotionalInputCategory,
} from "./schemas"

export type InventoryFileStat = {
  size: number
  modifiedAt: Date
  etag?: string
}

export type InventoryFilesystem = {
  listFiles(root: string): Promise<string[]>
  readFile(path: string): Promise<Buffer | string>
  stat(path: string): Promise<InventoryFileStat>
}

export function toNativeWorkspaceFilesystemPath(workspacePath: string): string {
  return normalizeDevotionalWorkspacePath(workspacePath).replace(/^\//u, "")
}

export function createWorkspaceInventoryFilesystem(
  filesystem: WorkspaceFilesystem,
): InventoryFilesystem {
  return {
    async listFiles(root) {
      const files: string[] = []
      const queue = [normalizeDevotionalWorkspacePath(root)]
      while (queue.length > 0) {
        const directory = queue.shift()!
        const entries = await filesystem.readdir(
          toNativeWorkspaceFilesystemPath(directory),
        )
        for (const entry of [...entries].sort((left, right) =>
          left.name.localeCompare(right.name),
        )) {
          const entryPath = path.posix.join(directory, entry.name)
          if (entry.type === "directory") queue.push(entryPath)
          else files.push(entryPath)
        }
      }
      return files
    },
    readFile: (filePath) =>
      filesystem.readFile(toNativeWorkspaceFilesystemPath(filePath)),
    async stat(filePath) {
      const stat = await filesystem.stat(
        toNativeWorkspaceFilesystemPath(filePath),
      )
      return {
        size: stat.size,
        modifiedAt: stat.modifiedAt,
        etag:
          typeof stat === "object" && "etag" in stat
            ? String(stat.etag)
            : undefined,
      }
    },
  }
}

export type DevotionalInventoryLimits = {
  maxFiles: number
  maxFilesPerCategory: number
  maxTextFileBytes: number
  maxDecodedTextBytes: number
  deadlineMs: number
  now: () => number
}

export const DEVOTIONAL_INVENTORY_DEFAULTS: DevotionalInventoryLimits = {
  maxFiles: 10_000,
  maxFilesPerCategory: 2_500,
  maxTextFileBytes: 8 * 1024 * 1024,
  maxDecodedTextBytes: 256 * 1024 * 1024,
  deadlineMs: 30_000,
  now: Date.now,
}

export type EligibleDevotionalInput = {
  path: string
  category: DevotionalInputCategory
  digest: string
  size: number
  modifiedAt: string
  etag?: string
  title: string
  content: string
}

export type ExcludedDevotionalInput = {
  path: string
  reason:
    | "outside-inputs"
    | "unknown-category"
    | "unsupported-extension"
    | "invalid-content"
    | "unstable-read"
  message?: string
}

export type DevotionalInventory = {
  discovered: number
  decodedTextBytes: number
  eligible: EligibleDevotionalInput[]
  excluded: ExcludedDevotionalInput[]
  eligibleByCategory: Record<DevotionalInputCategory, EligibleDevotionalInput[]>
}

const requiredCategories: DevotionalInputCategory[] = [
  "scripture",
  "reflections",
  "safety",
]

function failLimit(bound: string, value: number, limit: number): never {
  throw new DevotionalWorkspaceError(
    "inventory-limit-exceeded",
    `Devotional Workspace inventory exceeded ${bound}: ${value} > ${limit}`,
    { details: { bound, value, limit } },
  )
}

async function withinInventoryDeadline<T>(options: {
  work: Promise<T>
  startedAt: number
  limits: DevotionalInventoryLimits
}): Promise<T> {
  const remaining =
    options.limits.deadlineMs - (options.limits.now() - options.startedAt)
  if (remaining <= 0) {
    throw new DevotionalWorkspaceError(
      "inventory-deadline-exceeded",
      "Devotional Workspace inventory exceeded its deadline",
      { details: { deadlineMs: options.limits.deadlineMs }, retryable: true },
    )
  }
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      options.work,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () =>
            reject(
              new DevotionalWorkspaceError(
                "inventory-deadline-exceeded",
                "Devotional Workspace inventory exceeded its deadline",
                {
                  details: { deadlineMs: options.limits.deadlineMs },
                  retryable: true,
                },
              ),
            ),
          remaining,
        )
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

function sameStat(
  before: InventoryFileStat,
  after: InventoryFileStat,
): boolean {
  return (
    before.size === after.size &&
    before.modifiedAt.getTime() === after.modifiedAt.getTime() &&
    (before.etag === undefined ||
      after.etag === undefined ||
      before.etag === after.etag)
  )
}

export async function inventoryDevotionalInputs(
  filesystem: InventoryFilesystem,
  overrides: Partial<DevotionalInventoryLimits> = {},
): Promise<DevotionalInventory> {
  const limits = { ...DEVOTIONAL_INVENTORY_DEFAULTS, ...overrides }
  const startedAt = limits.now()
  // Generated runs and editor-facing system reports share this Workspace but
  // are never source candidates. Keeping traversal rooted at /inputs prevents
  // retained media from consuming source inventory time and file-count bounds.
  const bounded = <T>(work: Promise<T>) =>
    withinInventoryDeadline({ work, startedAt, limits })
  const listed = await bounded(filesystem.listFiles("/inputs"))
  if (listed.length > limits.maxFiles) {
    failLimit("maxFiles", listed.length, limits.maxFiles)
  }

  const paths = listed.map(normalizeDevotionalWorkspacePath).sort()
  if (new Set(paths).size !== paths.length) {
    throw new DevotionalWorkspaceError(
      "unsafe-path",
      "Workspace listing contains duplicate canonical paths",
    )
  }

  const eligible: EligibleDevotionalInput[] = []
  const excluded: ExcludedDevotionalInput[] = []
  const categoryCounts = new Map<DevotionalInputCategory, number>()
  let decodedTextBytes = 0

  for (const filePath of paths) {
    if (limits.now() - startedAt > limits.deadlineMs) {
      throw new DevotionalWorkspaceError(
        "inventory-deadline-exceeded",
        "Devotional Workspace inventory exceeded its deadline",
        { details: { deadlineMs: limits.deadlineMs }, retryable: true },
      )
    }

    if (!filePath.startsWith("/inputs/")) {
      excluded.push({ path: filePath, reason: "outside-inputs" })
      continue
    }
    const category = categoryForWorkspacePath(filePath)
    if (!category) {
      excluded.push({ path: filePath, reason: "unknown-category" })
      continue
    }

    const categoryCount = (categoryCounts.get(category) ?? 0) + 1
    categoryCounts.set(category, categoryCount)
    if (categoryCount > limits.maxFilesPerCategory) {
      failLimit(
        `maxFilesPerCategory:${category}`,
        categoryCount,
        limits.maxFilesPerCategory,
      )
    }

    if (!isSupportedDevotionalTextPath(filePath)) {
      excluded.push({ path: filePath, reason: "unsupported-extension" })
      continue
    }

    try {
      const before = await bounded(filesystem.stat(filePath))
      if (before.size > limits.maxTextFileBytes) {
        failLimit("maxTextFileBytes", before.size, limits.maxTextFileBytes)
      }
      const body = await bounded(filesystem.readFile(filePath))
      const bytes = typeof body === "string" ? Buffer.from(body) : body
      if (bytes.byteLength !== before.size) {
        throw new DevotionalWorkspaceError(
          "source-changed",
          `Source changed while reading ${filePath}`,
          { details: { path: filePath }, retryable: true },
        )
      }
      const after = await bounded(filesystem.stat(filePath))
      if (!sameStat(before, after)) {
        throw new DevotionalWorkspaceError(
          "source-changed",
          `Source changed while reading ${filePath}`,
          { details: { path: filePath }, retryable: true },
        )
      }

      let content: string
      try {
        content = new TextDecoder("utf-8", { fatal: true }).decode(bytes)
      } catch (error) {
        throw new DevotionalWorkspaceError(
          "invalid-content",
          `Source is not valid UTF-8: ${filePath}`,
          { cause: error, details: { path: filePath } },
        )
      }
      decodedTextBytes += bytes.byteLength
      if (decodedTextBytes > limits.maxDecodedTextBytes) {
        failLimit(
          "maxDecodedTextBytes",
          decodedTextBytes,
          limits.maxDecodedTextBytes,
        )
      }

      const validated = validateWorkspaceDocument({
        path: filePath,
        category,
        content,
      })
      eligible.push({
        path: filePath,
        category,
        digest: createHash("sha256").update(bytes).digest("hex"),
        size: bytes.byteLength,
        modifiedAt: after.modifiedAt.toISOString(),
        etag: after.etag,
        title: validated.title,
        content,
      })
    } catch (error) {
      if (
        isDevotionalWorkspaceError(error) &&
        (error.code === "inventory-limit-exceeded" ||
          error.code === "inventory-deadline-exceeded" ||
          error.code === "source-changed")
      ) {
        if (
          error.code === "inventory-limit-exceeded" ||
          error.code === "inventory-deadline-exceeded"
        ) {
          throw error
        }
        excluded.push({
          path: filePath,
          reason: "unstable-read",
          message: error.message,
        })
      } else {
        excluded.push({
          path: filePath,
          reason: "invalid-content",
          message: error instanceof Error ? error.message : "Invalid content",
        })
      }

      if (category === "safety") {
        throw new DevotionalWorkspaceError(
          "required-input-invalid",
          `Required safety configuration is invalid: ${filePath}`,
          { cause: error, details: { path: filePath } },
        )
      }
    }
  }

  const eligibleByCategory = Object.fromEntries(
    DEVOTIONAL_INPUT_CATEGORIES.map((category) => [
      category,
      eligible.filter((entry) => entry.category === category),
    ]),
  ) as Record<DevotionalInputCategory, EligibleDevotionalInput[]>

  for (const category of requiredCategories) {
    if (eligibleByCategory[category].length === 0) {
      throw new DevotionalWorkspaceError(
        "required-category-empty",
        `Required devotional input category is empty: ${category}`,
        { details: { category } },
      )
    }
  }
  if (eligibleByCategory.safety.length !== 1) {
    throw new DevotionalWorkspaceError(
      "required-input-invalid",
      "Exactly one safety rubric is required",
      { details: { count: eligibleByCategory.safety.length } },
    )
  }
  for (const requiredPath of Object.values(DEVOTIONAL_AUTHORED_PATHS)) {
    if (!eligible.some((entry) => entry.path === requiredPath)) {
      throw new DevotionalWorkspaceError(
        "required-input-invalid",
        `Required devotional Workspace input is unavailable: ${requiredPath}`,
        { details: { path: requiredPath } },
      )
    }
  }

  return {
    discovered: paths.length,
    decodedTextBytes,
    eligible,
    excluded,
    eligibleByCategory,
  }
}
