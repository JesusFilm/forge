// Bakes the Remotion bundle for @forge/shorts-compositions/entry into a
// directory (default ./bundle; Docker passes /app/bundle). Runs at IMAGE
// BUILD time so webpack never runs at runtime and the first render after a
// deploy costs the same as the Nth (plan perf O1). Runtime points
// SHORTS_WORKER_BUNDLE_DIR at the output.
//
// Usage: pnpm --filter @forge/shorts-worker prebundle [outDir]

import { rm } from "node:fs/promises"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { bundle } from "@remotion/bundler"

async function main(): Promise<void> {
  const outDir = resolve(process.argv[2] ?? "./bundle")
  const entryPoint = fileURLToPath(
    import.meta.resolve("@forge/shorts-compositions/entry"),
  )

  await rm(outDir, { recursive: true, force: true })

  console.log(
    `[shorts-worker] event=prebundle_started entryPoint=${entryPoint} outDir=${outDir}`,
  )

  let lastReported = -10
  const serveUrl = await bundle({
    entryPoint,
    outDir,
    webpackOverride: (config) => config,
    onProgress: (progress) => {
      if (progress - lastReported >= 10 || progress === 100) {
        lastReported = progress
        console.log(
          `[shorts-worker] event=prebundle_progress percent=${progress}`,
        )
      }
    },
  })

  console.log(`[shorts-worker] event=prebundle_complete serveUrl=${serveUrl}`)
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)
  console.error(
    `[shorts-worker] event=prebundle_failed error=${JSON.stringify(message)}`,
  )
  process.exit(1)
})
