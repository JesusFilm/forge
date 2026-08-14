import { createHash } from "node:crypto"
import { pathToFileURL } from "node:url"
import type { PrismaClient } from "@prisma/client"
import { prisma } from "@/db/client"
import {
  TYPESENSE_COLLECTION_FIELD_CONTRACT_KEYS,
  typesenseCollectionFieldContractValue,
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
import { candidateWatchSearchApplicationRevision } from "@/services/typesense-watch-search-candidate-identity"
import {
  buildTypesenseWatchCandidateProjectionSnapshot,
  type TypesenseWatchCandidateProjectionSnapshot,
  typesenseDocumentImportBatches,
} from "@/services/typesense-watch-search-indexer"
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
const VALIDATION_SEARCH_BATCH_SIZE = 50
const VALIDATION_GROUP_PAGE_SIZE = 250

type CandidateGenerationRecord = {
  id: string
  state: CandidateGenerationState
  version: number
  applicationRevision?: string
  sourceEpoch?: string
  sourceDigests?: unknown
  catalogCollection?: string
  availabilityCollection?: string
  lexicalCollection?: string
  transcriptCollection: string
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
  applicationRevision,
  sourceEpoch,
  transcript,
  transcriptFields,
  snapshot,
  schemas,
}: {
  generationId: string
  applicationRevision: string
  sourceEpoch: string
  transcript: { collection: string; projectionRevision: bigint }
  transcriptFields: readonly TypesenseCollectionField[]
  snapshot: TypesenseWatchCandidateProjectionSnapshot
  schemas: ReturnType<typeof candidateWatchCollectionSchemas>
}): CandidateGenerationInput {
  return {
    id: generationId,
    applicationRevision,
    sourceEpoch,
    sourceDigests: snapshot.digests,
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
    generation.applicationRevision === expected.applicationRevision &&
    generation.sourceEpoch === expected.sourceEpoch &&
    jsonEqual(generation.sourceDigests, expected.sourceDigests) &&
    generation.catalogCollection === expected.members.catalog.collection &&
    generation.availabilityCollection ===
      expected.members.availability.collection &&
    generation.lexicalCollection === expected.members.lexical.collection &&
    generation.transcriptCollection ===
      expected.members.transcript.collection &&
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
  for (const batch of typesenseDocumentImportBatches(documents, batchSize)) {
    await typesense.importDocuments(collection, batch, "upsert")
  }
}

async function validateDocumentCounts(
  typesense: CandidateTypesense,
  schemas: ReturnType<typeof candidateWatchCollectionSchemas>,
  snapshot: TypesenseWatchCandidateProjectionSnapshot,
  applicationRevision: string,
): Promise<{
  lexicalByLanguageIdentity: Record<string, number>
  lexicalCanonicalVideos: number
  lexicalDuplicateIdentityCanonicalPairs: 0
  schemaManifestHash: string
}> {
  const schemaManifest = (
    observed: TypesenseCollectionSchema,
    expected: TypesenseCollectionSchema,
  ) => {
    const observedByName = new Map(
      observed.fields.map((field) => [field.name, field]),
    )
    return {
      name: observed.name,
      fields: expected.fields.map((expectedField) => {
        const observedField = observedByName.get(expectedField.name)
        if (!observedField) return null
        return Object.fromEntries([
          ["name", observedField.name],
          ["type", observedField.type],
          ...TYPESENSE_COLLECTION_FIELD_CONTRACT_KEYS.flatMap((key) =>
            typesenseCollectionFieldContractValue(expectedField, key) ===
            undefined
              ? []
              : ([
                  [
                    key,
                    typesenseCollectionFieldContractValue(observedField, key),
                  ],
                ] as const),
          ),
        ])
      }),
      fieldCount: observed.fields.length,
      ...(expected.default_sorting_field == null
        ? {}
        : { default_sorting_field: observed.default_sorting_field }),
      ...(expected.enable_nested_fields == null
        ? {}
        : { enable_nested_fields: observed.enable_nested_fields }),
    }
  }
  const expectedSchemaManifests = Object.values(schemas).map((schema) =>
    schemaManifest(schema, schema),
  )
  const actualSchemaManifests = await Promise.all(
    Object.values(schemas).map(async (schema) =>
      schemaManifest(await typesense.getCollectionSchema(schema.name), schema),
    ),
  )
  if (!jsonEqual(actualSchemaManifests, expectedSchemaManifests)) {
    throw new CandidateProjectionSafetyError(
      "candidate physical schema manifest mismatch",
    )
  }
  const schemaManifestHash = `sha256:${createHash("sha256")
    .update(
      JSON.stringify({
        applicationRevision,
        schemas: expectedSchemaManifests,
      }),
    )
    .digest("hex")}`

  const requests = Object.values(schemas).map(
    (schema) =>
      ({
        collection: schema.name,
        q: "*",
        per_page: 1,
      }) satisfies TypesenseSearchRequest,
  )
  const results = await typesense.multiSearch(requests)
  if (results.length !== requests.length) {
    throw new CandidateProjectionSafetyError(
      "candidate collection count result mismatch",
    )
  }
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

  const lexicalByLanguageIdentity = new Map<string, number>()
  const expectedPairs = new Map<
    string,
    { languageIdentity: string; canonicalVideoId: string; id: string }
  >()
  const expectedCanonicalVideos = new Set<string>()
  for (const document of snapshot.lexical) {
    const languageIdentity = document.languageIdentity
    const canonicalVideoId = document.canonicalVideoId
    if (
      !/^[A-Za-z0-9:._-]+$/.test(languageIdentity) ||
      !canonicalVideoId.trim()
    ) {
      throw new CandidateProjectionSafetyError(
        "candidate lexical snapshot contains an unsafe identity",
      )
    }
    lexicalByLanguageIdentity.set(
      languageIdentity,
      (lexicalByLanguageIdentity.get(languageIdentity) ?? 0) + 1,
    )
    const pairKey = `${languageIdentity}\0${canonicalVideoId}`
    if (expectedPairs.has(pairKey)) {
      throw new CandidateProjectionSafetyError(
        "candidate lexical snapshot contains a duplicate canonical identity pair",
      )
    }
    expectedPairs.set(pairKey, {
      languageIdentity,
      canonicalVideoId,
      id: document.id,
    })
    expectedCanonicalVideos.add(canonicalVideoId)
  }

  const forEachBoundedSearchResult = async (
    searches: readonly TypesenseSearchRequest[],
    consume: (
      result: Awaited<ReturnType<CandidateTypesense["multiSearch"]>>[number],
    ) => void,
  ) => {
    for (
      let index = 0;
      index < searches.length;
      index += VALIDATION_SEARCH_BATCH_SIZE
    ) {
      const batch = searches.slice(index, index + VALIDATION_SEARCH_BATCH_SIZE)
      const batchResults = await typesense.multiSearch(batch)
      if (batchResults.length !== batch.length) {
        throw new CandidateProjectionSafetyError(
          "candidate validation search result mismatch",
        )
      }
      batchResults.forEach(consume)
    }
  }

  const identityEntries = [...lexicalByLanguageIdentity.entries()].sort(
    ([left], [right]) => left.localeCompare(right),
  )
  const groupPages = Math.ceil(expectedPairs.size / VALIDATION_GROUP_PAGE_SIZE)
  const observedPairs = new Set<string>()
  const observedCanonicalVideos = new Set<string>()
  const observedByLanguageIdentity = new Map<string, number>()
  await forEachBoundedSearchResult(
    Array.from({ length: groupPages }, (_value, index) => ({
      collection: schemas.lexical.name,
      q: "*",
      page: index + 1,
      per_page: VALIDATION_GROUP_PAGE_SIZE,
      group_by: "languageIdentity,canonicalVideoId",
      group_limit: 1,
      include_fields: "id,languageIdentity,canonicalVideoId",
    })),
    (result) => {
      if (!("grouped_hits" in result) || !Array.isArray(result.grouped_hits)) {
        throw new CandidateProjectionSafetyError(
          "candidate canonical coverage validation is malformed",
        )
      }
      if (result.found !== expectedPairs.size) {
        throw new CandidateProjectionSafetyError(
          `candidate canonical coverage mismatch: expected ${expectedPairs.size}, found ${result.found}`,
        )
      }
      for (const group of result.grouped_hits) {
        const [languageIdentity, canonicalVideoId] = group.group_key
        const pairKey = `${languageIdentity}\0${canonicalVideoId}`
        if (group.found !== 1) {
          throw new CandidateProjectionSafetyError(
            `candidate duplicate canonical identity pair ${languageIdentity}/${canonicalVideoId}`,
          )
        }
        const expected = expectedPairs.get(pairKey)
        const document = group.hits[0]?.document as
          | {
              id?: unknown
              languageIdentity?: unknown
              canonicalVideoId?: unknown
            }
          | undefined
        if (
          !expected ||
          observedPairs.has(pairKey) ||
          document?.id !== expected.id ||
          document.languageIdentity !== languageIdentity ||
          document.canonicalVideoId !== canonicalVideoId
        ) {
          throw new CandidateProjectionSafetyError(
            "candidate canonical coverage contains an unexpected identity pair",
          )
        }
        observedPairs.add(pairKey)
        observedCanonicalVideos.add(canonicalVideoId!)
        observedByLanguageIdentity.set(
          languageIdentity!,
          (observedByLanguageIdentity.get(languageIdentity!) ?? 0) + 1,
        )
      }
    },
  )
  for (const [languageIdentity, expected] of identityEntries) {
    const observed = observedByLanguageIdentity.get(languageIdentity) ?? 0
    if (observed !== expected) {
      throw new CandidateProjectionSafetyError(
        `candidate languageIdentity ${languageIdentity} count mismatch: expected ${expected}, found ${observed}`,
      )
    }
  }
  if (
    observedPairs.size !== expectedPairs.size ||
    observedCanonicalVideos.size !== expectedCanonicalVideos.size
  ) {
    throw new CandidateProjectionSafetyError(
      "candidate canonical coverage is incomplete",
    )
  }

  return {
    lexicalByLanguageIdentity: Object.fromEntries(identityEntries),
    lexicalCanonicalVideos: observedCanonicalVideos.size,
    lexicalDuplicateIdentityCanonicalPairs: 0,
    schemaManifestHash,
  }
}

export async function publishTypesenseWatchSearchCandidate({
  prisma,
  typesense,
  generations,
  generationId,
  applicationRevision,
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
  applicationRevision: string
  sourceEpoch: string
  transcript: { collection: string; projectionRevision: bigint }
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
  const schemas = candidateWatchCollectionSchemas(generationId)
  const transcriptSchema = await typesense.getCollectionSchema(
    transcript.collection,
  )
  const ownerInput = expectedOwnerInput({
    generationId,
    applicationRevision,
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

    const validation = await validateDocumentCounts(
      typesense,
      schemas,
      snapshot,
      applicationRevision,
    )
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
        lexicalByLanguageIdentity: validation.lexicalByLanguageIdentity,
        lexicalCanonicalVideos: validation.lexicalCanonicalVideos,
        lexicalDuplicateIdentityCanonicalPairs:
          validation.lexicalDuplicateIdentityCanonicalPairs,
        transcript: transcriptCount?.found ?? 0,
      },
      capacityEvidence: {
        applicationRevision,
        schemaManifestHash: validation.schemaManifestHash,
        preBuildRssBytes,
        postBuildRssBytes: process.memoryUsage().rss,
        lexicalSearchableBytes: snapshot.lexicalMemory.searchableBytes,
        lexicalSearchableBytesByFamily:
          snapshot.lexicalMemory.searchableBytesByFamily,
        estimatedKeywordMemoryLowBytes:
          snapshot.lexicalMemory.estimatedRamLowBytes,
        estimatedKeywordMemoryHighBytes:
          snapshot.lexicalMemory.estimatedRamHighBytes,
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
      applicationRevision: candidateWatchSearchApplicationRevision(),
      sourceEpoch: requiredEnv("WATCH_SEARCH_CANDIDATE_SOURCE_EPOCH"),
      transcript: {
        collection: requiredEnv("WATCH_SEARCH_TRANSCRIPT_COLLECTION"),
        projectionRevision: BigInt(
          requiredEnv("WATCH_SEARCH_TRANSCRIPT_PROJECTION_REVISION"),
        ),
      },
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
