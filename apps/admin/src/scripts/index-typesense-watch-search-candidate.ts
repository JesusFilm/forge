import { pathToFileURL } from "node:url"
import { prisma } from "@/db/client"
import {
  TypesenseClient,
  type TypesenseSearchRequest,
} from "@/services/typesense-client"
import { TypesenseWatchSearchCandidateGenerationService } from "@/services/typesense-watch-search-candidate-generation"
import { candidateWatchSearchIndexContractRevision } from "@/services/typesense-watch-search-candidate-identity"
import { resolveCurrentWatchSearchTranscriptProjectionWithFallback } from "@/services/typesense-watch-search-current-transcript-projection"
import {
  TYPESENSE_WATCH_CATALOG_ALIAS,
  TYPESENSE_WATCH_AVAILABILITY_ALIAS,
  TYPESENSE_WATCH_LEXICAL_ALIAS,
} from "@/services/typesense-watch-search-schema"
import { withTypesenseWatchSearchIndexLock } from "./index-typesense-watch-search"
import {
  CandidateProjectionSafetyError,
  publishTypesenseWatchSearchCandidate,
  retireTypesenseWatchSearchCandidate,
} from "@/services/typesense-watch-catalog-builder"
export {
  CandidateProjectionSafetyError,
  publishTypesenseWatchSearchCandidate,
  retireTypesenseWatchSearchCandidate,
} from "@/services/typesense-watch-catalog-builder"
type CandidateTypesense = TypesenseClient

async function currentCanary(typesense: CandidateTypesense): Promise<void> {
  await typesense.multiSearch(
    [
      TYPESENSE_WATCH_CATALOG_ALIAS,
      TYPESENSE_WATCH_AVAILABILITY_ALIAS,
      TYPESENSE_WATCH_LEXICAL_ALIAS,
    ].map(
      (collection) =>
        ({ collection, q: "*", per_page: 1 }) satisfies TypesenseSearchRequest,
    ),
  )
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) throw new CandidateProjectionSafetyError(`${name} is required`)
  return value
}

async function main(argv: readonly string[] = process.argv.slice(2)) {
  const host = requiredEnv("TYPESENSE_HOST")
  const apiKey = requiredEnv("TYPESENSE_OPERATOR_API_KEY")
  const typesense = new TypesenseClient({ host, apiKey, timeoutMs: 120_000 })
  const generations = new TypesenseWatchSearchCandidateGenerationService(
    prisma,
    typesense,
  )

  const result = await withTypesenseWatchSearchIndexLock(async () => {
    const retireArg = argv.find((argument) => argument.startsWith("--retire="))
    if (retireArg) {
      if (argv.length !== 1) {
        throw new CandidateProjectionSafetyError(
          "unknown candidate index arguments",
        )
      }
      const generationId = retireArg.slice("--retire=".length)
      return retireTypesenseWatchSearchCandidate({
        generationId,
        typesense,
        generations,
        assertDrained: async () => {
          if (
            process.env.WATCH_SEARCH_CANDIDATE_RETIREMENT_DRAIN_CONFIRMED !==
            "true"
          ) {
            throw new CandidateProjectionSafetyError(
              "candidate retirement requires an observed drain confirmation",
            )
          }
          const drainUntil = Date.parse(
            requiredEnv("WATCH_SEARCH_CANDIDATE_DRAIN_UNTIL"),
          )
          if (!Number.isFinite(drainUntil) || Date.now() < drainUntil) {
            throw new CandidateProjectionSafetyError(
              "candidate retirement drain lifetime has not elapsed",
            )
          }
        },
      })
    }
    if (argv.length !== 0) {
      throw new CandidateProjectionSafetyError(
        "unknown candidate index arguments",
      )
    }
    return publishTypesenseWatchSearchCandidate({
      prisma,
      typesense,
      generations,
      generationId: requiredEnv("WATCH_SEARCH_CANDIDATE_GENERATION_ID"),
      indexContractRevision: candidateWatchSearchIndexContractRevision(),
      sourceEpoch: requiredEnv("WATCH_SEARCH_CANDIDATE_SOURCE_EPOCH"),
      transcript: await (async () => {
        const projection =
          await resolveCurrentWatchSearchTranscriptProjectionWithFallback({
            prisma,
            typesense,
          })
        return {
          collection: projection.transcriptCollection,
          contentEmbeddingContractId: projection.contentEmbeddingContractId,
          chunkingVersion: projection.transcriptChunkingVersion,
          projectionRevision: projection.projectionRevision,
        }
      })(),
      batchSize: Number(process.env.TYPESENSE_INDEX_BATCH_SIZE ?? 100),
      runCurrentCanary: () => currentCanary(typesense),
    })
  })
  process.stdout.write(
    `${JSON.stringify(result, (_key, value) =>
      typeof value === "bigint" ? value.toString() : value,
    )}\n`,
  )
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main()
    .catch((error) => {
      process.stderr.write(
        `[typesense-watch-candidate] ${error instanceof Error ? error.stack : String(error)}\n`,
      )
      process.exitCode = 1
    })
    .finally(() => prisma.$disconnect())
}
