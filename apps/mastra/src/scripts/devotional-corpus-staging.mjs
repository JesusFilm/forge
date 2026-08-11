import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"

const CATEGORIES = new Set(["scripture", "reflections"])

export function resolveWorkspaceStagingRoot(args = process.argv.slice(2)) {
  const roots = args
    .filter((argument) => argument.startsWith("--workspace-root="))
    .map((argument) => argument.slice("--workspace-root=".length))
  if (roots.length !== 1 || roots[0].trim() === "") {
    throw new Error("exactly one non-empty --workspace-root=<path> is required")
  }
  return path.resolve(roots[0])
}

export function corpusStagingPath(workspaceRoot, category, filename) {
  if (!CATEGORIES.has(category)) {
    throw new Error(`unsupported devotional corpus category: ${category}`)
  }
  if (!/^[a-z0-9][a-z0-9-]*\.json$/u.test(filename)) {
    throw new Error(`unsafe devotional corpus filename: ${filename}`)
  }
  const root = path.resolve(workspaceRoot)
  const outputPath = path.resolve(root, "inputs", category, filename)
  const relative = path.relative(root, outputPath)
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("devotional corpus output escapes the Workspace root")
  }
  return outputPath
}

export async function writeCorpusDocument(options) {
  const outputPath = corpusStagingPath(
    options.workspaceRoot,
    options.category,
    options.filename,
  )
  await mkdir(path.dirname(outputPath), { recursive: true })
  await writeFile(
    outputPath,
    `${JSON.stringify(options.document, null, 2)}\n`,
    {
      encoding: "utf8",
      flag: "wx",
    },
  )
  return outputPath
}
