import { fileURLToPath } from "node:url"

import {
  assertEnvironmentForTarget,
  ENVIRONMENT_TARGETS,
  type EnvironmentTarget,
  loadEnvironmentFiles,
} from "../src/config/env.js"

const targets = new Set<string>(ENVIRONMENT_TARGETS)

const target = process.argv[2] as EnvironmentTarget | undefined
if (!target || !targets.has(target)) {
  console.error(`usage: pnpm env:check <${ENVIRONMENT_TARGETS.join("|")}>`)
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
