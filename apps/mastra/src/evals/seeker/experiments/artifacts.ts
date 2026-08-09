import { createHash } from "node:crypto"
import {
  link,
  mkdir,
  readdir,
  readFile,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises"
import { dirname, join, resolve, sep } from "node:path"
import { z } from "zod"

import { AttemptCompletionSchema, SafeIdSchema } from "./types"

const SECRET_KEY =
  /(?:authorization|api[-_]?key|credential|secret|password|langfuse(?:public|secret)?key|prompt(?:text|body)|instructions|trace(?:payload|body|content))/i
const SECRET_VALUE =
  /(?:bearer\s+[a-z0-9._~+/=-]{8,}|(?:sk|pk)_[a-z0-9_-]{12,}|(?:sk|pk)-lf-[a-z0-9_-]{8,})/i
const MAX_DIAGNOSTIC_CHARS = 500

export const ComparisonArtifactSchema = z
  .object({
    schemaVersion: z.literal("seeker-experiment-comparison/v1"),
    candidates: z.record(z.string(), z.unknown()),
  })
  .strict()
export const GateArtifactSchema = z
  .object({
    schemaVersion: z.literal("seeker-experiment-gates/v1"),
    candidates: z.record(z.string(), z.unknown()),
  })
  .strict()
export {
  ArtifactInventorySchema,
  AttemptCompletionSchema,
  VerdictRecordSchema,
} from "./types"

/** Provider-neutral recursive projection used at the repository write boundary. */
export function sanitizeEvidence(
  value: unknown,
  sensitiveValues: readonly string[] = [],
): unknown {
  const sentinels = sensitiveValues.filter((item) => item.length > 0)
  return sanitizeEvidenceValue(value, sentinels)
}

function sanitizeEvidenceValue(
  value: unknown,
  sentinels: readonly string[],
): unknown {
  if (typeof value === "string") {
    if (
      SECRET_VALUE.test(value) ||
      sentinels.some((sentinel) => value.includes(sentinel))
    )
      return "[REDACTED]"
    return value.length > 20_000
      ? `${value.slice(0, 20_000)}[TRUNCATED]`
      : value
  }
  if (Array.isArray(value))
    return value.map((item) => sanitizeEvidenceValue(item, sentinels))
  if (value != null && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [
        key,
        SECRET_KEY.test(key) && key !== "traceId"
          ? "[REDACTED]"
          : sanitizeEvidenceValue(child, sentinels),
      ]),
    )
  return value
}

export function boundedDiagnostic(cause: unknown): string {
  const message = cause instanceof Error ? cause.message : String(cause)
  return String(sanitizeEvidence(message)).slice(0, MAX_DIAGNOSTIC_CHARS)
}

export async function writeLocalDebugPrompt(
  mastraRoot: string,
  experimentId: string,
  attemptId: string,
  prompt: string,
): Promise<string> {
  SafeIdSchema.parse(experimentId)
  SafeIdSchema.parse(attemptId)
  const scratchRoot = resolve(mastraRoot, ".seeker-eval-debug")
  const path = resolve(scratchRoot, experimentId, `${attemptId}.prompt.txt`)
  if (!inside(scratchRoot, path))
    throw new Error("debug path escapes scratch root")
  await mkdir(dirname(path), { recursive: true })
  await atomicExclusiveWrite(path, prompt)
  return path
}

function safeRelative(path: string): string {
  if (
    path.length === 0 ||
    path.startsWith("/") ||
    path.includes("\\") ||
    path.split("/").some((part) => part === "" || part === "." || part === "..")
  )
    throw new Error(`artifact path must be attempt-relative: ${path}`)
  return path
}

function inside(parent: string, child: string): boolean {
  const normalized = resolve(parent)
  return child === normalized || child.startsWith(`${normalized}${sep}`)
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === "ENOENT") return false
    throw cause
  }
}

async function atomicExclusiveWrite(
  path: string,
  content: string,
): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const temporary = `${path}.tmp-${process.pid}-${crypto.randomUUID()}`
  await writeFile(temporary, content, { encoding: "utf8", flag: "wx" })
  try {
    // Hard-link creation is exclusive: unlike rename(), it cannot replace a
    // concurrently-created immutable artifact during publication.
    await link(temporary, path)
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === "EEXIST") {
      throw new Error(`artifact already exists: ${path}`)
    }
    throw cause
  } finally {
    await unlink(temporary).catch(() => undefined)
  }
}

export type AttemptWriter = {
  attemptDir: string
  writeJson(path: string, value: unknown): Promise<void>
  writeText(path: string, value: string): Promise<void>
  complete(requiredPaths: readonly string[]): Promise<void>
  registerSensitiveValues(values: readonly string[]): void
}

export async function createAttemptWriter(
  experimentsRoot: string,
  experimentId: string,
  attemptId: string,
): Promise<AttemptWriter> {
  SafeIdSchema.parse(experimentId)
  SafeIdSchema.parse(attemptId)
  const packageDir = resolve(experimentsRoot, experimentId)
  const attemptsDir = join(packageDir, "attempts")
  const attemptDir = join(attemptsDir, attemptId)
  if (!inside(resolve(experimentsRoot), attemptDir))
    throw new Error("attempt escapes experiments root")
  await mkdir(attemptsDir, { recursive: true })
  await mkdir(attemptDir)

  const target = (relativePath: string): string => {
    const path = resolve(attemptDir, safeRelative(relativePath))
    if (!inside(attemptDir, path))
      throw new Error(`artifact path must be attempt-relative: ${relativePath}`)
    return path
  }
  const assertOpen = async (): Promise<void> => {
    if (await exists(join(attemptDir, "completion.json")))
      throw new Error(`attempt ${attemptId} is already complete`)
  }
  const writeTextArtifact = async (
    relativePath: string,
    value: string,
  ): Promise<void> => {
    await assertOpen()
    await atomicExclusiveWrite(target(relativePath), value)
  }
  const sensitiveValues = new Set<string>()

  return {
    attemptDir,
    writeJson: (path, value) =>
      writeTextArtifact(
        path,
        `${JSON.stringify(sanitizeEvidence(value, [...sensitiveValues]), null, 2)}\n`,
      ),
    writeText: writeTextArtifact,
    registerSensitiveValues(values) {
      for (const value of values)
        if (value.length > 0) sensitiveValues.add(value)
    },
    async complete(requiredPaths) {
      await assertOpen()
      const unique = [...new Set(requiredPaths.map(safeRelative))]
      const artifacts = []
      for (const relativePath of unique) {
        const path = target(relativePath)
        if (!(await exists(path)))
          throw new Error(`missing required artifact: ${relativePath}`)
        const content = await readFile(path)
        const source = content.toString("utf8")
        if (
          SECRET_VALUE.test(source) ||
          [...sensitiveValues].some((sentinel) => source.includes(sentinel))
        )
          throw new Error(`unsafe content in artifact: ${relativePath}`)
        artifacts.push({
          kind:
            relativePath === "resolved-identity.json"
              ? ("resolved-identity" as const)
              : relativePath === "answers.json"
                ? ("answers" as const)
                : relativePath === "transcripts.json"
                  ? ("transcripts" as const)
                  : relativePath === "judged.json"
                    ? ("judged" as const)
                    : relativePath === "score.json"
                      ? ("score" as const)
                      : relativePath === "comparison.md"
                        ? ("comparison" as const)
                        : relativePath === "gate-report.json"
                          ? ("gate-report" as const)
                          : ("diagnostic" as const),
          path: `attempts/${attemptId}/${relativePath}`,
          sha256: createHash("sha256").update(content).digest("hex"),
        })
      }
      const requiredKinds = new Set([
        "resolved-identity",
        "answers",
        "transcripts",
        "judged",
        "score",
        "comparison",
        "gate-report",
      ])
      for (const artifact of artifacts) requiredKinds.delete(artifact.kind)
      if (requiredKinds.size > 0)
        throw new Error(
          `incomplete artifact inventory: ${[...requiredKinds].join(", ")}`,
        )
      const completion = AttemptCompletionSchema.parse({
        schemaVersion: "seeker-attempt/v1",
        experimentId,
        attemptId,
        completedAt: new Date().toISOString(),
        inventory: { experimentId, attemptId, artifacts },
      })
      await atomicExclusiveWrite(
        join(attemptDir, "completion.json"),
        `${JSON.stringify(completion, null, 2)}\n`,
      )
      await validateCompletedAttempt(experimentsRoot, experimentId, attemptId)
    },
  }
}

export async function validateCompletedAttempt(
  experimentsRoot: string,
  experimentId: string,
  attemptId: string,
): Promise<void> {
  SafeIdSchema.parse(experimentId)
  SafeIdSchema.parse(attemptId)
  const attemptDir = resolve(
    experimentsRoot,
    experimentId,
    "attempts",
    attemptId,
  )
  const completion = AttemptCompletionSchema.parse(
    JSON.parse(await readFile(join(attemptDir, "completion.json"), "utf8")),
  )
  const required = new Set([
    "resolved-identity",
    "answers",
    "transcripts",
    "judged",
    "score",
    "comparison",
    "gate-report",
  ])
  for (const artifact of completion.inventory.artifacts) {
    required.delete(artifact.kind)
    const prefix = `attempts/${attemptId}/`
    const relative = artifact.path.slice(prefix.length)
    const content = await readFile(resolve(attemptDir, safeRelative(relative)))
    if (createHash("sha256").update(content).digest("hex") !== artifact.sha256)
      throw new Error(`artifact checksum mismatch: ${relative}`)
  }
  if (required.size > 0)
    throw new Error(
      `incomplete artifact inventory: ${[...required].join(", ")}`,
    )
}

export async function scanExperimentPackage(
  experimentsRoot: string,
  experimentId: string,
  attemptId: string,
  forbiddenValues: readonly string[] = [],
): Promise<void> {
  await validateCompletedAttempt(experimentsRoot, experimentId, attemptId)
  const attemptDir = resolve(
    experimentsRoot,
    experimentId,
    "attempts",
    attemptId,
  )
  const completion = AttemptCompletionSchema.parse(
    JSON.parse(await readFile(join(attemptDir, "completion.json"), "utf8")),
  )
  const inventoryPaths = new Set(
    completion.inventory.artifacts.map((artifact) =>
      artifact.path.slice(`attempts/${attemptId}/`.length),
    ),
  )
  const pending = [""]
  while (pending.length > 0) {
    const relativeDir = pending.pop()!
    const entries = await readdir(resolve(attemptDir, relativeDir), {
      withFileTypes: true,
    })
    for (const entry of entries) {
      const relative = relativeDir ? `${relativeDir}/${entry.name}` : entry.name
      if (entry.isDirectory()) pending.push(relative)
      else if (
        relative !== "completion.json" &&
        (!inventoryPaths.has(relative) ||
          /\.tmp-|\.partial$|\.env(?:\.|$)/i.test(relative))
      )
        throw new Error(`forbidden or untracked package artifact: ${relative}`)
    }
  }
  for (const artifact of completion.inventory.artifacts) {
    if (/\.tmp-|\.partial$|\.env(?:\.|$)/i.test(artifact.path))
      throw new Error(`forbidden package artifact: ${artifact.path}`)
    const relative = artifact.path.slice(`attempts/${attemptId}/`.length)
    const source = await readFile(
      resolve(attemptDir, safeRelative(relative)),
      "utf8",
    )
    if (
      SECRET_VALUE.test(source) ||
      forbiddenValues.some(
        (value) => value.length > 0 && source.includes(value),
      )
    )
      throw new Error(`sensitive content in package artifact: ${artifact.path}`)
    const parsed = artifact.path.endsWith(".json") ? JSON.parse(source) : null
    if (
      parsed != null &&
      JSON.stringify(sanitizeEvidence(parsed)) !== JSON.stringify(parsed)
    )
      throw new Error(`sensitive key in package artifact: ${artifact.path}`)
  }
}

export async function readAttemptArtifact(
  experimentsRoot: string,
  experimentId: string,
  attemptId: string,
  relativePath: string,
): Promise<string> {
  SafeIdSchema.parse(experimentId)
  SafeIdSchema.parse(attemptId)
  const attemptDir = resolve(
    experimentsRoot,
    experimentId,
    "attempts",
    attemptId,
  )
  const path = resolve(attemptDir, safeRelative(relativePath))
  if (!inside(attemptDir, path))
    throw new Error(`artifact path must be attempt-relative: ${relativePath}`)
  return readFile(path, "utf8")
}
