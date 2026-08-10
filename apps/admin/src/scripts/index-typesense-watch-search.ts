import { pathToFileURL } from "node:url"
import { Client } from "pg"
import { prisma } from "@/db/client"
import { TypesenseClient } from "@/services/typesense-client"
import { TypesenseWatchSearchCandidateGenerationService } from "@/services/typesense-watch-search-candidate-generation"
import { TYPESENSE_WATCH_SEARCH_PUBLICATION_LOCK_ID } from "@/services/typesense-watch-search-publication-lock"
import {
  rebuildTypesenseWatchSearchIndex,
  type TypesenseWatchSearchTranscriptStrategy,
} from "@/services/typesense-watch-search-indexer"

const REBUILD_TRANSCRIPTS_FLAG = "--rebuild-transcripts"

export type TypesenseWatchSearchIndexLockClient = {
  connect(): Promise<void>
  query(
    text: string,
    values: readonly unknown[],
  ): Promise<{ rows: Array<{ acquired?: boolean; released?: boolean }> }>
  end(): Promise<void>
}

type TypesenseWatchSearchIndexLockClientFactory = (
  databaseUrl: string,
) => TypesenseWatchSearchIndexLockClient

function defaultLockClientFactory(
  databaseUrl: string,
): TypesenseWatchSearchIndexLockClient {
  const client = new Client({ connectionString: databaseUrl })
  return {
    connect: async () => {
      await client.connect()
    },
    query: async (text, values) => client.query(text, [...values]),
    end: () => client.end(),
  }
}

export async function withTypesenseWatchSearchIndexLock<T>(
  run: () => Promise<T>,
  {
    databaseUrl = process.env.DATABASE_URL,
    clientFactory = defaultLockClientFactory,
  }: {
    databaseUrl?: string
    clientFactory?: TypesenseWatchSearchIndexLockClientFactory
  } = {},
): Promise<T> {
  if (!databaseUrl) throw new Error("DATABASE_URL is required")
  const client = clientFactory(databaseUrl)
  await client.connect()
  let acquired = false
  let runSucceeded = false
  let runResult: T | undefined
  let runError: unknown
  const cleanupErrors: unknown[] = []
  try {
    const result = await client.query(
      "SELECT pg_try_advisory_lock($1) AS acquired",
      [TYPESENSE_WATCH_SEARCH_PUBLICATION_LOCK_ID],
    )
    if (result.rows[0]?.acquired !== true) {
      throw new Error(
        "Another Typesense Watch Search index release is already running",
      )
    }
    acquired = true
    runResult = await run()
    runSucceeded = true
  } catch (error) {
    runError = error
  } finally {
    if (acquired) {
      try {
        const result = await client.query(
          "SELECT pg_advisory_unlock($1) AS released",
          [TYPESENSE_WATCH_SEARCH_PUBLICATION_LOCK_ID],
        )
        if (result.rows[0]?.released !== true) {
          cleanupErrors.push(
            new Error(
              "PostgreSQL did not release the Typesense Watch Search index lock",
            ),
          )
        }
      } catch (error) {
        cleanupErrors.push(error)
      }
    }
    try {
      await client.end()
    } catch (error) {
      cleanupErrors.push(error)
    }
  }
  if (cleanupErrors.length > 0) {
    throw new AggregateError(
      runSucceeded ? cleanupErrors : [runError, ...cleanupErrors],
      "Typesense Watch Search index lock cleanup failed",
    )
  }
  if (!runSucceeded) throw runError
  return runResult as T
}

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
