/* global AbortController, clearTimeout, setTimeout */
import { mkdir, realpath, writeFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

const CATEGORIES = new Set(["scripture", "reflections"])
export const CORPUS_FETCH_TIMEOUT_MS = 30_000
const REPOSITORY_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../..",
)

export class DevotionalCorpusStagingError extends Error {
  constructor(code, message, options) {
    super(message, options)
    this.name = "DevotionalCorpusStagingError"
    this.code = code
  }
}

function isWithin(root, candidate) {
  const relative = path.relative(root, candidate)
  return (
    relative === "" ||
    (!relative.startsWith("..") && !path.isAbsolute(relative))
  )
}

async function fetchCorpusSource(url, consume, options = {}) {
  const controller = new AbortController()
  const timeoutMs = options.timeoutMs ?? CORPUS_FETCH_TIMEOUT_MS
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  const abortFromCaller = () => controller.abort(options.signal?.reason)
  options.signal?.addEventListener("abort", abortFromCaller, { once: true })
  try {
    const response = await (options.fetchImpl ?? globalThis.fetch)(url, {
      signal: controller.signal,
    })
    if (!response.ok) {
      throw new DevotionalCorpusStagingError(
        "upstream-request-failed",
        `fetch ${url} failed: HTTP ${response.status}`,
      )
    }
    return await consume(response)
  } catch (cause) {
    if (cause instanceof DevotionalCorpusStagingError) throw cause
    const code = options.signal?.aborted
      ? "upstream-request-aborted"
      : controller.signal.aborted
        ? "upstream-request-timeout"
        : "upstream-request-failed"
    throw new DevotionalCorpusStagingError(
      code,
      `fetch ${url} failed: ${
        cause instanceof Error ? cause.message : String(cause)
      }`,
      { cause },
    )
  } finally {
    clearTimeout(timeout)
    options.signal?.removeEventListener("abort", abortFromCaller)
  }
}

export function fetchCorpusText(url, options) {
  return fetchCorpusSource(url, (response) => response.text(), options)
}

export function fetchCorpusJson(url, options) {
  return fetchCorpusSource(url, (response) => response.json(), options)
}

export function resolveWorkspaceStagingRoot(args = process.argv.slice(2)) {
  const roots = args
    .filter((argument) => argument.startsWith("--workspace-root="))
    .map((argument) => argument.slice("--workspace-root=".length))
  if (roots.length !== 1 || roots[0].trim() === "") {
    throw new DevotionalCorpusStagingError(
      "invalid-workspace-root",
      "exactly one non-empty --workspace-root=<path> is required",
    )
  }
  return path.resolve(roots[0])
}

export function corpusStagingPath(workspaceRoot, category, filename) {
  if (!CATEGORIES.has(category)) {
    throw new DevotionalCorpusStagingError(
      "unsupported-category",
      `unsupported devotional corpus category: ${category}`,
    )
  }
  if (!/^[a-z0-9][a-z0-9-]*\.json$/u.test(filename)) {
    throw new DevotionalCorpusStagingError(
      "unsafe-filename",
      `unsafe devotional corpus filename: ${filename}`,
    )
  }
  const root = path.resolve(workspaceRoot)
  const outputPath = path.resolve(root, "inputs", category, filename)
  const relative = path.relative(root, outputPath)
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new DevotionalCorpusStagingError(
      "unsafe-output-path",
      "devotional corpus output escapes the Workspace root",
    )
  }
  return outputPath
}

export async function writeCorpusDocument(options) {
  const requestedOutputPath = corpusStagingPath(
    options.workspaceRoot,
    options.category,
    options.filename,
  )
  const requestedRoot = path.resolve(options.workspaceRoot)
  await mkdir(path.dirname(requestedOutputPath), { recursive: true })
  const [resolvedRoot, resolvedParent, resolvedRepositoryRoot] =
    await Promise.all([
      realpath(requestedRoot),
      realpath(path.dirname(requestedOutputPath)),
      realpath(REPOSITORY_ROOT),
    ])
  if (isWithin(resolvedRepositoryRoot, resolvedRoot)) {
    throw new DevotionalCorpusStagingError(
      "repository-workspace-root",
      "devotional corpus staging root must be outside the repository",
    )
  }
  if (!isWithin(resolvedRoot, resolvedParent)) {
    throw new DevotionalCorpusStagingError(
      "unsafe-output-path",
      "devotional corpus output escapes the resolved Workspace root",
    )
  }
  const outputPath = path.join(resolvedParent, options.filename)
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
