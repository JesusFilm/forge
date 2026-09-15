#!/usr/bin/env tsx

import { readFile, writeFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import type { PrismaClient } from "@prisma/client"
import {
  loadWatchSearchCurationManifest,
  serializeWatchSearchCurationManifest,
} from "@/services/watch-search-curation-manifest"

export const WATCH_SEARCH_CURATION_MANIFEST_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../data/watch-search-curations.json",
)

export class WatchSearchCurationManifestStaleError extends Error {
  constructor() {
    super(
      "Watch Search curation backup is stale; run watch-search-curations:export and commit the result",
    )
    this.name = "WatchSearchCurationManifestStaleError"
  }
}

export class WatchSearchCurationExportArgumentError extends Error {
  constructor(readonly unknownArguments: readonly string[]) {
    super(`unknown argument(s): ${unknownArguments.join(", ")}`)
    this.name = "WatchSearchCurationExportArgumentError"
  }
}

export async function exportWatchSearchCurations({
  prisma,
  destination = WATCH_SEARCH_CURATION_MANIFEST_PATH,
  check = false,
}: {
  prisma: PrismaClient
  destination?: string
  check?: boolean
}): Promise<{ destination: string; curations: number; aliases: number }> {
  const manifest = await loadWatchSearchCurationManifest(prisma)
  const serialized = serializeWatchSearchCurationManifest(manifest)

  if (check) {
    const committed = await readFile(destination, "utf8").catch(() => null)
    if (committed !== serialized) {
      throw new WatchSearchCurationManifestStaleError()
    }
  } else {
    await writeFile(destination, serialized, "utf8")
  }

  return {
    destination,
    curations: manifest.curations.length,
    aliases: manifest.curations.reduce(
      (count, curation) => count + curation.aliases.length,
      0,
    ),
  }
}

async function main(argv: readonly string[] = process.argv.slice(2)) {
  const unknown = argv.filter((argument) => argument !== "--check")
  if (unknown.length > 0) {
    throw new WatchSearchCurationExportArgumentError(unknown)
  }
  const { prisma } = await import("@/db/client")
  try {
    const result = await exportWatchSearchCurations({
      prisma,
      check: argv.includes("--check"),
    })
    process.stdout.write(`${JSON.stringify(result)}\n`)
  } finally {
    await prisma.$disconnect()
  }
}

const isDirectInvoke =
  process.argv[1] != null &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url

if (isDirectInvoke) {
  main().catch((error) => {
    process.stderr.write(
      `[export-watch-search-curations] ${error instanceof Error ? error.message : String(error)}\n`,
    )
    process.exit(1)
  })
}
