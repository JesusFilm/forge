import { fileURLToPath } from "node:url"

import {
  assertEnvironmentForTarget,
  type EnvironmentTarget,
  loadEnvironmentFiles,
} from "../src/config/env.js"

const targets = new Set<EnvironmentTarget>([
  "local",
  "ci",
  "railway",
  "firecrawl",
  "language-sweep",
  "eval",
  "smoke",
  "dashboard",
  "production-read",
  "production-write",
])

const target = process.argv[2] as EnvironmentTarget | undefined
if (!target || !targets.has(target)) {
  console.error(`usage: pnpm env:check <${[...targets].join("|")}>`)
  process.exit(2)
}

const packageDirectory = fileURLToPath(new URL("..", import.meta.url))
const environment = loadEnvironmentFiles(packageDirectory)

try {
  assertEnvironmentForTarget(environment, target)
  console.log(`[rag-env] target=${target} status=valid`)
} catch (error) {
  const message =
    error instanceof Error ? error.message : "unknown validation error"
  console.error(`[rag-env] target=${target} status=invalid`)
  console.error(message)
  process.exit(1)
}
