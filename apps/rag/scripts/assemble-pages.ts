import { createHash } from "node:crypto"
import {
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  writeFile,
} from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { parse } from "yaml"
import { z } from "zod"

const producerSchema = z.object({
  name: z.string().regex(/^[a-z][a-z0-9-]*$/),
  source: z.string().min(1),
  target: z.string(),
  files: z.array(z.string().min(1)).min(1),
})

const manifestSchema = z.object({
  version: z.literal(1),
  producers: z.array(producerSchema).min(1),
})

export type PagesManifest = z.infer<typeof manifestSchema>

export type AssemblyResult = {
  files: string[]
  digest: string
}

function safeRelative(value: string, label: string, allowRoot = false): string {
  if (value.includes("\\"))
    throw new Error(`${label} must use POSIX separators`)
  if (allowRoot && value === "/") return ""
  const withoutLeadingSlash = allowRoot ? value.replace(/^\//, "") : value
  if (
    (!allowRoot && path.posix.isAbsolute(value)) ||
    (allowRoot && value.startsWith("//")) ||
    withoutLeadingSlash === ".." ||
    withoutLeadingSlash.startsWith("../") ||
    withoutLeadingSlash.split("/").includes("..") ||
    path.posix.normalize(withoutLeadingSlash) !== withoutLeadingSlash
  ) {
    throw new Error(`${label} is not a safe repository-relative path: ${value}`)
  }
  return withoutLeadingSlash
}

async function filesBelow(root: string, relative = ""): Promise<string[]> {
  const current = path.join(root, relative)
  const currentStat = await lstat(current)
  if (currentStat.isSymbolicLink()) {
    throw new Error(`symbolic links are not publishable: ${relative || root}`)
  }
  if (currentStat.isFile()) return [relative]
  if (!currentStat.isDirectory()) {
    throw new Error(`unsupported Pages entry: ${relative || root}`)
  }

  const entries = await readdir(current)
  const nested = await Promise.all(
    entries.sort().map((entry) => filesBelow(root, path.join(relative, entry))),
  )
  return nested.flat()
}

export async function readPagesManifest(
  manifestPath: string,
): Promise<PagesManifest> {
  return manifestSchema.parse(parse(await readFile(manifestPath, "utf8")))
}

export async function assemblePages(options: {
  repoRoot: string
  manifestPath: string
  outputPath: string
}): Promise<AssemblyResult> {
  const repoRoot = await realpath(options.repoRoot)
  const manifest = await readPagesManifest(options.manifestPath)
  const outputPath = path.resolve(options.outputPath)
  const temporaryPath = `${outputPath}.assembling`

  try {
    await lstat(outputPath)
    throw new Error(`output already exists: ${outputPath}`)
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
  }
  try {
    await lstat(temporaryPath)
    throw new Error(`temporary output already exists: ${temporaryPath}`)
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
  }
  await mkdir(temporaryPath, { recursive: false })

  const claimed = new Map<string, string>()
  const digest = createHash("sha256")

  try {
    for (const producer of manifest.producers) {
      const sourceRelative = safeRelative(
        producer.source,
        `${producer.name}.source`,
      )
      const targetRelative = safeRelative(
        producer.target,
        `${producer.name}.target`,
        true,
      )
      const sourceRoot = path.resolve(repoRoot, sourceRelative)
      const sourceReal = await realpath(sourceRoot)
      if (
        sourceReal !== sourceRoot ||
        !sourceReal.startsWith(`${repoRoot}${path.sep}`)
      ) {
        throw new Error(
          `${producer.name}.source escapes the repository or traverses a symlink`,
        )
      }

      const producerFiles = await filesBelow(sourceRoot)
      if (producerFiles.length === 0) {
        throw new Error(`producer ${producer.name} contains no files`)
      }
      const declaredFiles = producer.files
        .map((file) => safeRelative(file, `${producer.name}.files`))
        .sort()
      const actualFiles = producerFiles
        .map((file) => file.split(path.sep).join(path.posix.sep))
        .sort()
      if (new Set(declaredFiles).size !== declaredFiles.length) {
        throw new Error(
          `producer ${producer.name} declares a file more than once`,
        )
      }
      if (JSON.stringify(actualFiles) !== JSON.stringify(declaredFiles)) {
        throw new Error(
          `producer ${producer.name} file set differs from its manifest declaration`,
        )
      }
      for (const relativeFile of producerFiles) {
        const posixFile = relativeFile.split(path.sep).join(path.posix.sep)
        const destination = path.posix.join(targetRelative, posixFile)
        const previous = claimed.get(destination)
        if (previous) {
          throw new Error(
            `Pages path collision at ${destination}: ${previous} and ${producer.name}`,
          )
        }
        claimed.set(destination, producer.name)
        const bytes = await readFile(path.join(sourceRoot, relativeFile))
        const targetFile = path.join(temporaryPath, ...destination.split("/"))
        await mkdir(path.dirname(targetFile), { recursive: true })
        await writeFile(targetFile, bytes)
        digest.update(destination)
        digest.update("\0")
        digest.update(bytes)
      }
    }
    await rename(temporaryPath, outputPath)
  } catch (error) {
    await rm(temporaryPath, { recursive: true, force: true })
    throw error
  }

  return {
    files: [...claimed.keys()].sort(),
    digest: `sha256:${digest.digest("hex")}`,
  }
}

async function main(): Promise<void> {
  const scriptPath = fileURLToPath(import.meta.url)
  const repoRoot = path.resolve(path.dirname(scriptPath), "../../..")
  const manifestPath = path.join(repoRoot, "docs/pages/manifest.yaml")
  const outputArgument = process.argv
    .slice(2)
    .find((argument) => argument !== "--")
  if (!outputArgument) {
    throw new Error("usage: pnpm pages:assemble -- <new-output-path>")
  }
  const result = await assemblePages({
    repoRoot,
    manifestPath,
    outputPath: path.resolve(process.cwd(), outputArgument),
  })
  console.log(`assembled ${result.files.length} Pages files (${result.digest})`)
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch((error: unknown) => {
    console.error(
      `Pages assembly refused: ${error instanceof Error ? error.message : String(error)}`,
    )
    process.exit(1)
  })
}
