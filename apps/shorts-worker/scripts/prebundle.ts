// Bake the retained devotional bundle once for portrait and wide rendering.
// Usage: pnpm --filter @forge/shorts-worker prebundle [outDir]

import { rm } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { bundle } from "@remotion/bundler"

async function main(): Promise<void> {
  const devotionalOutDir = resolve(process.argv[2] ?? "./devotional-bundle")
  const schemaPath = fileURLToPath(
    import.meta.resolve("@forge/shorts-compositions/schema"),
  )
  const devotionalEntryPoint = join(
    dirname(schemaPath),
    "devotional",
    "entry.ts",
  )

  await rm(devotionalOutDir, { recursive: true, force: true })

  console.log(
    `[shorts-worker] event=prebundle_started entryPoint=${devotionalEntryPoint} outDir=${devotionalOutDir}`,
  )
  const devotionalServeUrl = await bundle({
    entryPoint: devotionalEntryPoint,
    outDir: devotionalOutDir,
    webpackOverride: (config) => config,
  })
  console.log(
    `[shorts-worker] event=prebundle_complete serveUrl=${devotionalServeUrl}`,
  )
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)
  console.error(
    `[shorts-worker] event=prebundle_failed error=${JSON.stringify(message)}`,
  )
  process.exit(1)
})
