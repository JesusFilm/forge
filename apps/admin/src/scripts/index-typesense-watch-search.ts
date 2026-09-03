import { pathToFileURL } from "node:url"
import { prisma } from "@/db/client"
import { TypesenseClient } from "@/services/typesense-client"
import { TypesenseWatchSearchCandidateGenerationService } from "@/services/typesense-watch-search-candidate-generation"
import {
  withTypesenseWatchSearchIndexLock,
  type TypesenseWatchSearchIndexLockClient,
} from "@/services/typesense-watch-search-publication-lock"
import {
  rebuildTypesenseWatchSearchIndex,
  type TypesenseWatchSearchTranscriptStrategy,
} from "@/services/typesense-watch-search-indexer"

const REBUILD_TRANSCRIPTS_FLAG = "--rebuild-transcripts"
export type { TypesenseWatchSearchIndexLockClient }
export { withTypesenseWatchSearchIndexLock }

export function parseTypesenseWatchSearchIndexArgs(argv: readonly string[]): {
  transcriptStrategy: TypesenseWatchSearchTranscriptStrategy
} {
  if (argv.length === 0) return { transcriptStrategy: "reuse" }
  if (argv.length === 1 && argv[0] === REBUILD_TRANSCRIPTS_FLAG) {
    return { transcriptStrategy: "rebuild" }
  }
  throw new Error(
    `Unknown Typesense Watch Search index argument: ${argv.join(" ")}`,
  )
}

export async function runGuardedTypesenseWatchSearchPublication<T>(
  transcriptStrategy: TypesenseWatchSearchTranscriptStrategy,
  deps: {
    assertCurrentPublicationAllowed(input: {
      rebuildTranscripts: boolean
    }): Promise<void>
    publish(): Promise<T>
  },
): Promise<T> {
  await deps.assertCurrentPublicationAllowed({
    rebuildTranscripts: transcriptStrategy === "rebuild",
  })
  return deps.publish()
}

async function main(argv: readonly string[] = process.argv.slice(2)) {
  const { transcriptStrategy } = parseTypesenseWatchSearchIndexArgs(argv)
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
  const generations = new TypesenseWatchSearchCandidateGenerationService(
    prisma,
    typesense,
  )
  const stats = await withTypesenseWatchSearchIndexLock(async () => {
    return runGuardedTypesenseWatchSearchPublication(transcriptStrategy, {
      assertCurrentPublicationAllowed: (input) =>
        generations.assertCurrentPublicationAllowed(input),
      publish: () =>
        rebuildTypesenseWatchSearchIndex({
          prisma,
          typesense,
          batchSize: Number(process.env.TYPESENSE_INDEX_BATCH_SIZE ?? 100),
          transcriptStrategy,
          onProgress: (progress) => {
            process.stdout.write(
              `[typesense-watch-index] catalog=${progress.catalogDocuments} availability=${progress.availabilityDocuments} lexical=${progress.lexicalDocuments} lexicalBytes=${progress.lexicalSearchableBytes} transcripts=${progress.transcriptDocuments} transcriptReused=${progress.transcriptReused}\n`,
            )
          },
        }),
    })
  })
  process.stdout.write(`${JSON.stringify(stats)}\n`)
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main()
    .catch((error) => {
      process.stderr.write(
        `[typesense-watch-index] ${error instanceof Error ? error.stack : String(error)}\n`,
      )
      process.exitCode = 1
    })
    .finally(() => prisma.$disconnect())
}
