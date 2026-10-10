import { existsSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

/**
 * Resolve the monorepo root robustly in EVERY runtime we run under:
 * - tsx/vitest from apps/mastra (cwd inside the repo) → walk up to the
 *   workspace marker;
 * - the `mastra dev`/`mastra build` BUNDLE (.mastra/output), where
 *   import.meta.url no longer points at the source tree — the cwd walk still
 *   finds the root (this bug made the corpora load empty in Studio: "no
 *   reflection source" 10ms failures).
 * Falls back to the source-relative path when no marker is found.
 */
let cached: string | null = null

export function repoRoot(): string {
  if (cached) return cached
  let dir = process.cwd()
  for (let i = 0; i < 12; i++) {
    if (existsSync(path.join(dir, "pnpm-workspace.yaml"))) {
      cached = dir
      return dir
    }
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  cached = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../../../..",
  )
  return cached
}
