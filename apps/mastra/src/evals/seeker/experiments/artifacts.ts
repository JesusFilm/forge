import { createHash } from "node:crypto"
import {
  link,
  mkdir,
  readFile,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises"
import { dirname, join, resolve, sep } from "node:path"

import { AttemptCompletionSchema, SafeIdSchema } from "./types"

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
  if (await exists(path)) throw new Error(`artifact already exists: ${path}`)
  await mkdir(dirname(path), { recursive: true })
  const temporary = `${path}.tmp-${process.pid}-${crypto.randomUUID()}`
  await writeFile(temporary, content, { encoding: "utf8", flag: "wx" })
  try {
    // Hard-link creation is exclusive: unlike rename(), it cannot replace a
    // concurrently-created immutable artifact between the existence check
    // and publication.
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

  return {
    attemptDir,
    writeJson: (path, value) =>
      writeTextArtifact(path, `${JSON.stringify(value, null, 2)}\n`),
    writeText: writeTextArtifact,
    async complete(requiredPaths) {
      await assertOpen()
      const unique = [...new Set(requiredPaths.map(safeRelative))]
      const artifacts = []
      for (const relativePath of unique) {
        const path = target(relativePath)
        if (!(await exists(path)))
          throw new Error(`missing required artifact: ${relativePath}`)
        const content = await readFile(path)
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
    },
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
