/**
 * Anchored paths for the eval harness.
 *
 * Default paths in this module derive from the location of THIS source
 * file (via `import.meta.url`), not `process.cwd()`. This way the
 * harness works whether invoked from repo root, from inside
 * `apps/admin/`, or from a worktree — the eval data files always
 * resolve to `apps/admin/eval/*`.
 *
 * Tests can ignore these by passing explicit `directory` /
 * `filePath` overrides.
 */

import path from "node:path"
import { fileURLToPath } from "node:url"

const HERE = path.dirname(fileURLToPath(import.meta.url))

/** apps/admin/ — anchor for everything else. The source path is
 *  apps/admin/src/services/search-eval/paths.ts so we walk up three. */
const ADMIN_DIR = path.resolve(HERE, "../../..")

export function evalDir(): string {
  return path.join(ADMIN_DIR, "eval")
}

export function baselinesDir(): string {
  return path.join(evalDir(), "baselines")
}

export function syntheticQueriesDir(): string {
  return path.join(evalDir(), "synthetic-queries")
}

export function regressionsPath(): string {
  return path.join(evalDir(), "regressions.json")
}

export function calibrationPath(): string {
  return path.join(evalDir(), "calibration.json")
}

export function runsDir(): string {
  return path.join(ADMIN_DIR, ".tmp", "eval", "runs")
}
