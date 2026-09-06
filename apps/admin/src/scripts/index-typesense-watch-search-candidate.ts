import { pathToFileURL } from "node:url"
import type { PrismaClient } from "@prisma/client"
import { prisma } from "@/db/client"
import {
  TypesenseClient,
  type TypesenseCollectionField,
  type TypesenseCollectionSchema,
  type TypesenseSearchRequest,
} from "@/services/typesense-client"
import {
  type CandidateGenerationInput,
  type CandidateGenerationState,
  TypesenseWatchSearchCandidateGenerationService,
} from "@/services/typesense-watch-search-candidate-generation"
import { candidateWatchSearchIndexContractRevision } from "@/services/typesense-watch-search-candidate-identity"
import { resolveCurrentWatchSearchTranscriptCompatibility } from "@/services/typesense-watch-search-transcript-compatibility"
import {
  buildTypesenseWatchCandidateProjectionSnapshot,
  type TypesenseWatchCandidateProjectionSnapshot,
} from "@/services/typesense-watch-search-indexer"
import {
  TYPESENSE_WATCH_EXACT_TITLE_KEY_BYTES,
  TYPESENSE_WATCH_EXACT_TITLE_KEYS_FIELD,
} from "@/services/typesense-watch-search-exact-title"
import {
  candidateWatchCollectionNames,
  candidateWatchCollectionSchemas,
  TYPESENSE_WATCH_AVAILABILITY_ALIAS,
  TYPESENSE_WATCH_CATALOG_ALIAS,
  TYPESENSE_WATCH_LEXICAL_ALIAS,
  TYPESENSE_WATCH_TRANSCRIPT_ALIAS,
} from "@/services/typesense-watch-search-schema"
import { withTypesenseWatchSearchIndexLock } from "./index-typesense-watch-search"

const DEFAULT_BATCH_SIZE = 100

type CandidateGenerationRecord = {
  id: string
  state: CandidateGenerationState
  version: number
  indexContractRevision?: string
  sourceEpoch?: string
  sourceDigests?: unknown
  catalogCollection?: string
  availabilityCollection?: string
  lexicalCollection?: string
  transcriptCollection: string
  contentEmbeddingContractId?: string
  transcriptChunkingVersion?: string
  transcriptProjectionRevision?: bigint
  catalogFields?: unknown
  availabilityFields?: unknown
  lexicalFields?: unknown
  transcriptFields?: unknown
  ownedCollections: unknown
  sharedCollections: unknown
  deletionProgress: unknown
}

type CandidateGenerationLifecycle = {
  createBuildingGeneration(
    input: CandidateGenerationInput,
  ): Promise<CandidateGenerationRecord>
  getGeneration(generationId: string): Promise<CandidateGenerationRecord>
  validateAndMarkReady(input: {
    generationId: string
    expectedVersion: number
    documentCounts: Record<string, unknown>
    capacityEvidence: Record<string, unknown>
  }): Promise<CandidateGenerationRecord>
  getPointer(kind: "EVALUATION" | "SERVING"): Promise<{
    generationId: string | null
    version: number
  }>
  publishEvaluationGeneration(input: {
    generationId: string
    expectedPointerVersion: number
  }): Promise<unknown>
  beginRetirement(generationId: string): Promise<CandidateGenerationRecord>
  transitionGeneration(input: {
    generationId: string
    expectedState: CandidateGenerationState
    expectedVersion: number
    nextState: CandidateGenerationState
    reason?: string
  }): Promise<CandidateGenerationRecord>
  recordDeletionProgress(input: {
    generationId: string
    expectedVersion: number
    deletedCollections: readonly string[]
  }): Promise<CandidateGenerationRecord>
}

type CandidateTypesense = Pick<
  TypesenseClient,
  | "getCollectionSchema"
  | "createCollection"
  | "importDocuments"
  | "multiSearch"
  | "getAlias"
  | "deleteCollection"
>

type PublicationStep =
  | "owner:created"
  | "catalog:created"
  | "catalog:imported"
  | "availability:created"
  | "availability:imported"
  | "lexical:created"
  | "lexical:imported"
  | "projection:validated"
  | "generation:ready"
  | "pointer:published"

type RetirementStep =
  | "catalog:deleted"
  | "availability:deleted"
  | "lexical:deleted"

export class CandidateProjectionSafetyError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "CandidateProjectionSafetyError"
  }
}

function isUniqueConflict(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "P2002"
  )
}

function isMissingCollection(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    error.status === 404
  )
}

function jsonEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

function stringArray(value: unknown, name: string): string[] {
  if (
    !Array.isArray(value) ||
    value.some((entry) => typeof entry !== "string" || !entry.trim())
  ) {
    throw new CandidateProjectionSafetyError(`${name} is corrupt`)
  }
  return value as string[]
}

function deletedCollections(value: unknown): string[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return []
  const deleted = (value as { deletedCollections?: unknown }).deletedCollections
  return deleted == null ? [] : stringArray(deleted, "deletion progress")
}

function expectedOwnerInput({
  generationId,
  indexContractRevision,
  sourceEpoch,
  transcript,
  transcriptFields,
  snapshot,
  schemas,
}: {
  generationId: string
  indexContractRevision: string
  sourceEpoch: string
  transcript: {
    collection: string
    contentEmbeddingContractId: string
    chunkingVersion: string
    projectionRevision: bigint
  }
  transcriptFields: readonly TypesenseCollectionField[]
  snapshot: TypesenseWatchCandidateProjectionSnapshot
  schemas: ReturnType<typeof candidateWatchCollectionSchemas>
}): CandidateGenerationInput {
  return {
    id: generationId,
    indexContractRevision,
    sourceEpoch,
    sourceDigests: snapshot.digests,
    contentEmbeddingContractId: transcript.contentEmbeddingContractId,
    transcriptChunkingVersion: transcript.chunkingVersion,
    transcriptProjectionRevision: transcript.projectionRevision,
    members: {
      catalog: {
        collection: schemas.catalog.name,
        ownership: "OWNED",
        fields: schemas.catalog.fields,
      },
      availability: {
        collection: schemas.availability.name,
        ownership: "OWNED",
        fields: schemas.availability.fields,
      },
      lexical: {
        collection: schemas.lexical.name,
        ownership: "OWNED",
        fields: schemas.lexical.fields,
      },
      transcript: {
        collection: transcript.collection,
        ownership: "SHARED",
        fields: transcriptFields,
      },
    },
  }
}

function assertExistingOwner(
  generation: CandidateGenerationRecord,
  expected: CandidateGenerationInput,
): void {
  const matches =
    generation.id === expected.id &&
    generation.indexContractRevision === expected.indexContractRevision &&
    generation.sourceEpoch === expected.sourceEpoch &&
    jsonEqual(generation.sourceDigests, expected.sourceDigests) &&
    generation.catalogCollection === expected.members.catalog.collection &&
    generation.availabilityCollection ===
      expected.members.availability.collection &&
    generation.lexicalCollection === expected.members.lexical.collection &&
    generation.transcriptCollection ===
      expected.members.transcript.collection &&
    generation.contentEmbeddingContractId ===
      expected.contentEmbeddingContractId &&
    generation.transcriptChunkingVersion ===
      expected.transcriptChunkingVersion &&
    generation.transcriptProjectionRevision ===
      expected.transcriptProjectionRevision &&
    jsonEqual(generation.catalogFields, expected.members.catalog.fields) &&
    jsonEqual(
      generation.availabilityFields,
      expected.members.availability.fields,
    ) &&
    jsonEqual(generation.lexicalFields, expected.members.lexical.fields) &&
    jsonEqual(generation.transcriptFields, expected.members.transcript.fields)
  if (!matches) {
    throw new CandidateProjectionSafetyError(
      `candidate generation ${expected.id} does not match its immutable publication input`,
    )
  }
  if (generation.state !== "BUILDING" && generation.state !== "READY") {
    throw new CandidateProjectionSafetyError(
      `candidate generation ${expected.id} cannot resume from ${generation.state}`,
    )
  }
}

async function ensureCollection(
  typesense: CandidateTypesense,
  schema: TypesenseCollectionSchema,
): Promise<void> {
  try {
    await typesense.getCollectionSchema(schema.name)
  } catch (error) {
    if (!isMissingCollection(error)) throw error
    await typesense.createCollection(schema)
  }
}

async function importProjection(
  typesense: CandidateTypesense,
  collection: string,
  documents: readonly object[],
  batchSize: number,
): Promise<void> {
  if (documents.length === 0) {
    await typesense.importDocuments(collection, [], "upsert")
    return
  }
  for (let index = 0; index < documents.length; index += batchSize) {
    await typesense.importDocuments(
      collection,
      documents.slice(index, index + batchSize),
      "upsert",
    )
  }
}

async function validateDocumentCounts(
  typesense: CandidateTypesense,
  schemas: ReturnType<typeof candidateWatchCollectionSchemas>,
  snapshot: TypesenseWatchCandidateProjectionSnapshot,
): Promise<void> {
  const requests = Object.values(schemas).map(
    (schema) =>
      ({
        collection: schema.name,
        q: "*",
        per_page: 1,
      }) satisfies TypesenseSearchRequest,
  )
  const results = await typesense.multiSearch(requests)
  const expected = [
    snapshot.counts.catalog,
    snapshot.counts.availability,
    snapshot.counts.lexical,
  ]
  results.forEach((result, index) => {
    if (result.found !== expected[index]) {
      throw new CandidateProjectionSafetyError(
        `candidate collection count mismatch: expected ${expected[index]}, found ${result.found}`,
      )
    }
  })
}

function exactTitleProbe(
  snapshot: TypesenseWatchCandidateProjectionSnapshot,
): string | null {
  const encoder = new TextEncoder()
  let exactTitleKeyBytes = 0

  for (const document of snapshot.lexical) {
    const hasTitle = Object.entries(document).some(
      ([field, values]) =>
        field.startsWith("title_") &&
        field !== TYPESENSE_WATCH_EXACT_TITLE_KEYS_FIELD &&
        (Array.isArray(values) ? values : [values]).some(
          (value) => value.trim().length > 0,
        ),
    )
    const keys = document.title_exact_keys ?? []
    if (hasTitle && keys.length === 0) {
      throw new CandidateProjectionSafetyError(
        `candidate lexical document ${document.id} has titles without exact keys`,
      )
    }
    for (const key of keys) {
      if (
        !new RegExp(
          `^[0-9a-f]{${TYPESENSE_WATCH_EXACT_TITLE_KEY_BYTES * 2}}$`,
        ).test(key)
      ) {
        throw new CandidateProjectionSafetyError(
          `candidate lexical document ${document.id} has a malformed exact title key`,
        )
      }
      exactTitleKeyBytes += encoder.encode(key).byteLength
    }
  }

  if (exactTitleKeyBytes !== snapshot.lexicalMemory.exactTitleKeyBytes) {
    throw new CandidateProjectionSafetyError(
      "candidate exact title key byte estimate does not match its projection",
    )
  }

  const document = snapshot.lexical.find(
    (entry) => (entry.title_exact_keys?.length ?? 0) > 0,
  )
  return document?.title_exact_keys?.[0] ?? null
}

async function validateExactTitleRead(
  typesense: CandidateTypesense,
  lexicalCollection: string,
  probe: string | null,
): Promise<void> {
  if (!probe) return

  const [result] = await typesense.multiSearch<{
    id: string
    title_exact_keys?: string[]
  }>([
    {
      collection: lexicalCollection,
      q: probe,
      query_by: TYPESENSE_WATCH_EXACT_TITLE_KEYS_FIELD,
      include_fields: `id,${TYPESENSE_WATCH_EXACT_TITLE_KEYS_FIELD}`,
      num_typos: 0,
      prefix: false,
      drop_tokens_threshold: 0,
      per_page: 1,
    },
  ])
  const hit = result?.hits?.find(({ document }) =>
    document.title_exact_keys?.includes(probe),
  )
  if (!hit) {
    throw new CandidateProjectionSafetyError(
      "candidate exact title key read smoke failed",
    )
  }
}

export async function publishTypesenseWatchSearchCandidate({
  prisma,
  typesense,
  generations,
  generationId,
  indexContractRevision,
  sourceEpoch,
  transcript,
  batchSize = DEFAULT_BATCH_SIZE,
  loadSnapshot = () => buildTypesenseWatchCandidateProjectionSnapshot(prisma),
  runCurrentCanary = async () => undefined,
  failpoint,
}: {
  prisma: PrismaClient
  typesense: CandidateTypesense
  generations: CandidateGenerationLifecycle
  generationId: string
  indexContractRevision: string
  sourceEpoch: string
  transcript: {
    collection: string
    contentEmbeddingContractId: string
    chunkingVersion: string
    projectionRevision: bigint
  }
  batchSize?: number
  loadSnapshot?: () => Promise<TypesenseWatchCandidateProjectionSnapshot>
  runCurrentCanary?: () => Promise<void>
  failpoint?: (step: PublicationStep) => void | Promise<void>
}) {
  if (!Number.isInteger(batchSize) || batchSize <= 0) {
    throw new CandidateProjectionSafetyError("batch size must be positive")
  }
  const preBuildRssBytes = process.memoryUsage().rss
  await runCurrentCanary()
  const snapshot = await loadSnapshot()
  const schemas = candidateWatchCollectionSchemas(
    generationId,
    snapshot.tokenizerLocales,
  )
  const probe = exactTitleProbe(snapshot)
  const transcriptSchema = await typesense.getCollectionSchema(
    transcript.collection,
  )
  const ownerInput = expectedOwnerInput({
    generationId,
    indexContractRevision,
    sourceEpoch,
    transcript,
    transcriptFields: transcriptSchema.fields,
    snapshot,
    schemas,
  })

  let generation: CandidateGenerationRecord
  try {
    generation = await generations.createBuildingGeneration(ownerInput)
  } catch (error) {
    if (!isUniqueConflict(error)) throw error
    generation = await generations.getGeneration(generationId)
    assertExistingOwner(generation, ownerInput)
  }
  await failpoint?.("owner:created")

  if (generation.state === "BUILDING") {
    const members = [
      ["catalog", schemas.catalog, snapshot.catalog],
      ["availability", schemas.availability, snapshot.availability],
      ["lexical", schemas.lexical, snapshot.lexical],
    ] as const
    for (const [name, schema, documents] of members) {
      await ensureCollection(typesense, schema)
      await failpoint?.(`${name}:created`)
      await importProjection(typesense, schema.name, documents, batchSize)
      await failpoint?.(`${name}:imported`)
    }

    await validateDocumentCounts(typesense, schemas, snapshot)
    await validateExactTitleRead(typesense, schemas.lexical.name, probe)
    const [transcriptCount] = await typesense.multiSearch([
      {
        collection: transcript.collection,
        q: "*",
        per_page: 1,
        exclude_fields: "embedding,text",
      },
    ])
    await runCurrentCanary()
    await failpoint?.("projection:validated")
    generation = await generations.validateAndMarkReady({
      generationId,
      expectedVersion: generation.version,
      documentCounts: {
        ...snapshot.counts,
        transcript: transcriptCount?.found ?? 0,
      },
      capacityEvidence: {
        preBuildRssBytes,
        postBuildRssBytes: process.memoryUsage().rss,
        lexicalSearchableBytes: snapshot.lexicalMemory.searchableBytes,
        estimatedKeywordMemoryLowBytes:
          snapshot.lexicalMemory.estimatedRamLowBytes,
        estimatedKeywordMemoryHighBytes:
          snapshot.lexicalMemory.estimatedRamHighBytes,
        exactTitleKeyBytes: snapshot.lexicalMemory.exactTitleKeyBytes,
        transcriptReused: true,
      },
    })
    await failpoint?.("generation:ready")
  }

  const pointer = await generations.getPointer("EVALUATION")
  if (pointer.generationId !== generationId) {
    await generations.publishEvaluationGeneration({
      generationId,
      expectedPointerVersion: pointer.version,
    })
  }
  await failpoint?.("pointer:published")

  return {
    generationId,
    state: generation.state,
    counts: snapshot.counts,
    digests: snapshot.digests,
    collections: {
      ...candidateWatchCollectionNames(generationId),
      transcript: transcript.collection,
    },
    contentEmbeddingContractId: transcript.contentEmbeddingContractId,
    transcriptChunkingVersion: transcript.chunkingVersion,
    transcriptProjectionRevision: transcript.projectionRevision,
    transcriptReused: true,
  }
}

const CURRENT_ALIASES = [
  TYPESENSE_WATCH_CATALOG_ALIAS,
  TYPESENSE_WATCH_AVAILABILITY_ALIAS,
  TYPESENSE_WATCH_LEXICAL_ALIAS,
  TYPESENSE_WATCH_TRANSCRIPT_ALIAS,
] as const

function assertOwnedMembers(
  generation: CandidateGenerationRecord,
  generationId: string,
): string[] {
  const expected = candidateWatchCollectionNames(generationId)
  const expectedOwned = [
    expected.catalog,
    expected.availability,
    expected.lexical,
  ]
  const owned = stringArray(generation.ownedCollections, "owned collections")
  const shared = stringArray(generation.sharedCollections, "shared collections")
  if (
    owned.length !== expectedOwned.length ||
    expectedOwned.some((collection) => !owned.includes(collection)) ||
    shared.length !== 1 ||
    shared[0] !== generation.transcriptCollection ||
    owned.includes(generation.transcriptCollection) ||
    owned.some((collection) =>
      CURRENT_ALIASES.some(
        (alias) => collection === alias || collection.startsWith(`${alias}_`),
      ),
    )
  ) {
    throw new CandidateProjectionSafetyError(
      `candidate generation ${generationId} has unsafe or forged ownership`,
    )
  }
  return expectedOwned
}

export async function retireTypesenseWatchSearchCandidate({
  generationId,
  typesense,
  generations,
  assertDrained,
  failpoint,
}: {
  generationId: string
  typesense: CandidateTypesense
  generations: CandidateGenerationLifecycle
  assertDrained: () => Promise<void>
  failpoint?: (step: RetirementStep) => void | Promise<void>
}) {
  let generation = await generations.getGeneration(generationId)
  if (generation.state === "RETIRED") return generation
  const owned = assertOwnedMembers(generation, generationId)

  const aliases = await Promise.all(
    CURRENT_ALIASES.map((alias) => typesense.getAlias(alias)),
  )
  const aliasedCollections = new Set(
    aliases.flatMap((alias) => (alias ? [alias.collection_name] : [])),
  )
  if (owned.some((collection) => aliasedCollections.has(collection))) {
    throw new CandidateProjectionSafetyError(
      `candidate generation ${generationId} still has an alias reference`,
    )
  }

  await assertDrained()
  generation = await generations.beginRetirement(generationId)
  if (generation.state !== "RETIRING") {
    throw new CandidateProjectionSafetyError(
      `candidate generation ${generationId} cannot retire from ${generation.state}`,
    )
  }

  const deleted = new Set(deletedCollections(generation.deletionProgress))
  const memberNames = ["catalog", "availability", "lexical"] as const
  for (let index = 0; index < owned.length; index += 1) {
    const collection = owned[index]!
    if (deleted.has(collection)) continue
    try {
      await typesense.deleteCollection(collection)
    } catch (error) {
      // A previous attempt can delete the collection before its progress
      // update commits. A missing collection is therefore completed work.
      if (!isMissingCollection(error)) throw error
    }
    await failpoint?.(`${memberNames[index]}:deleted`)
    deleted.add(collection)
    generation = await generations.recordDeletionProgress({
      generationId,
      expectedVersion: generation.version,
      deletedCollections: [...deleted],
    })
  }

  return generations.transitionGeneration({
    generationId,
    expectedState: "RETIRING",
    expectedVersion: generation.version,
    nextState: "RETIRED",
  })
}

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
        const compatibility =
          await resolveCurrentWatchSearchTranscriptCompatibility(prisma)
        return {
          collection: requiredEnv("WATCH_SEARCH_TRANSCRIPT_COLLECTION"),
          contentEmbeddingContractId: compatibility.contentEmbeddingContractId,
          chunkingVersion: compatibility.transcriptChunkingVersion,
          projectionRevision: BigInt(
            requiredEnv("WATCH_SEARCH_TRANSCRIPT_PROJECTION_REVISION"),
          ),
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
