import { prisma } from "@/db/client"
import { TypesenseClient } from "@/services/typesense-client"
import { rebuildTypesenseWatchSearchIndex } from "@/services/typesense-watch-search-indexer"

async function main() {
  const host = process.env.TYPESENSE_HOST
  const apiKey = process.env.TYPESENSE_API_KEY
  if (!host || !apiKey) {
    throw new Error("TYPESENSE_HOST and TYPESENSE_API_KEY are required")
  }
  const typesense = new TypesenseClient({
    host,
    apiKey,
    timeoutMs: 120_000,
  })
  const stats = await rebuildTypesenseWatchSearchIndex({
    prisma,
    typesense,
    batchSize: Number(process.env.TYPESENSE_INDEX_BATCH_SIZE ?? 100),
    onProgress: (progress) => {
      process.stdout.write(
        `[typesense-watch-index] catalog=${progress.catalogDocuments} transcripts=${progress.transcriptDocuments}\n`,
      )
    },
  })
  process.stdout.write(`${JSON.stringify(stats)}\n`)
}

main()
  .catch((error) => {
    process.stderr.write(
      `[typesense-watch-index] ${error instanceof Error ? error.stack : String(error)}\n`,
    )
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
