import { createHash } from "node:crypto"

import type { WorkspaceFilesystem } from "@mastra/core/workspace"
import { z } from "zod"

import { DevotionalSourceRefSchema } from "./state-schema"
import { toNativeWorkspaceFilesystemPath } from "./inventory"

const SAFE_RUN_ID = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,199}$/u

export const InputsUsedSchema = z
  .object({
    schemaVersion: z.literal(1),
    runId: z.string().regex(SAFE_RUN_ID),
    attemptId: z.string().min(1).optional(),
    catalogGeneration: z.number().int().positive(),
    reconciledAt: z.string().datetime(),
    sources: z.array(DevotionalSourceRefSchema).max(500),
  })
  .strict()

export function devotionalRunPath(runId: string): string {
  if (!SAFE_RUN_ID.test(runId)) throw new Error("Unsafe devotional run id")
  return `/runs/${runId}`
}

function stableJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`
}

async function writeImmutableJson(
  filesystem: WorkspaceFilesystem,
  path: string,
  value: unknown,
): Promise<void> {
  const content = stableJson(value)
  const nativePath = toNativeWorkspaceFilesystemPath(path)
  if (await filesystem.exists(nativePath)) {
    const current = await filesystem.readFile(nativePath)
    const currentBytes =
      typeof current === "string" ? Buffer.from(current) : current
    if (
      createHash("sha256").update(currentBytes).digest("hex") ===
      createHash("sha256").update(content).digest("hex")
    ) {
      return
    }
    throw new Error(`Immutable devotional artifact conflict: ${path}`)
  }
  await filesystem.writeFile(nativePath, content, {
    recursive: true,
    overwrite: false,
    mimeType: "application/json",
  })
}

export async function writeInputsUsed(options: {
  filesystem: WorkspaceFilesystem
  runId: string
  attemptId?: string
  catalogGeneration: number
  reconciledAt?: string
  sources: z.infer<typeof DevotionalSourceRefSchema>[]
}): Promise<string> {
  const value = InputsUsedSchema.parse({
    schemaVersion: 1,
    runId: options.runId,
    ...(options.attemptId ? { attemptId: options.attemptId } : {}),
    catalogGeneration: options.catalogGeneration,
    reconciledAt: options.reconciledAt ?? new Date().toISOString(),
    sources: options.sources,
  })
  const path = `${devotionalRunPath(options.runId)}/inputs-used.json`
  await writeImmutableJson(options.filesystem, path, value)
  return path
}

export async function writeAttemptJsonArtifact(options: {
  filesystem: WorkspaceFilesystem
  runId: string
  name: string
  value: unknown
}): Promise<string> {
  if (!/^[a-z][a-z0-9-]{0,63}$/u.test(options.name)) {
    throw new Error("Unsafe devotional artifact name")
  }
  const path = `${devotionalRunPath(options.runId)}/${options.name}.json`
  await writeImmutableJson(options.filesystem, path, options.value)
  return path
}
