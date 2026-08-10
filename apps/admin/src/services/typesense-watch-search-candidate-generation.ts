import {
  Prisma,
  type PrismaClient,
  type WatchSearchCandidateGenerationState,
  type WatchSearchCandidateLeaseKind,
  type WatchSearchCandidatePointerKind,
  type WatchSearchCandidateQualificationStatus,
} from "@prisma/client"
import type {
  TypesenseClient,
  TypesenseCollectionField,
  TypesenseCollectionSchema,
} from "./typesense-client"
import { TYPESENSE_WATCH_SEARCH_PUBLICATION_LOCK_ID } from "./typesense-watch-search-publication-lock"

export type CandidateGenerationState = WatchSearchCandidateGenerationState

export type CandidateCollectionOwnership = "OWNED" | "SHARED"

export type CandidateCollectionMember = {
  collection: string
  ownership: CandidateCollectionOwnership
  fields: readonly TypesenseCollectionField[]
}

export type CandidateGenerationInput = {
  id: string
  applicationRevision: string
  sourceEpoch: string
  sourceDigests: Record<string, unknown>
  transcriptProjectionRevision: bigint
  members: {
    catalog: CandidateCollectionMember
    availability: CandidateCollectionMember
    lexical: CandidateCollectionMember
    transcript: CandidateCollectionMember
  }
}

type SchemaClient = Pick<TypesenseClient, "getCollectionSchema">
type PointerKind = WatchSearchCandidatePointerKind

type StoredGeneration = {
  id: string
  state: CandidateGenerationState
  version: number
  applicationRevision: string
  catalogCollection: string
  availabilityCollection: string
  lexicalCollection: string
  transcriptCollection: string
  transcriptProjectionRevision: bigint
  catalogFields: unknown
  availabilityFields: unknown
  lexicalFields: unknown
  transcriptFields: unknown
}

export class CandidateGenerationValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "CandidateGenerationValidationError"
  }
}

export class CandidateGenerationConflictError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "CandidateGenerationConflictError"
  }
}

export class CandidateGenerationCompatibilityError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "CandidateGenerationCompatibilityError"
  }
}

export class CandidateGenerationLeaseError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "CandidateGenerationLeaseError"
  }
}

const LEGAL_TRANSITIONS: Readonly<
  Record<CandidateGenerationState, readonly CandidateGenerationState[]>
> = {
  BUILDING: ["INVALIDATED", "RETIRING"],
  READY: ["INVALIDATED"],
  INVALIDATED: ["RETIRING"],
  RETIRING: ["RETIRED"],
  RETIRED: [],
}

const MAX_LEASE_TTL_MS = 10 * 60 * 1_000

function requiredString(value: string, name: string): string {
  const normalized = value.trim()
  if (!normalized) {
    throw new CandidateGenerationValidationError(`${name} is required`)
  }
  return normalized
}

function asJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue
}

function assertJsonObject(value: unknown, name: string): void {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).length === 0
  ) {
    throw new CandidateGenerationValidationError(
      `${name} must be a non-empty object`,
    )
  }
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function assertPassingQualificationEvidence(
  evidence: Record<string, unknown>,
  input: {
    generationId: string
    applicationRevision: string
    transcriptCollection: string
    transcriptProjectionRevision: bigint
    qrelsRevision: string
    currentBindings: readonly string[]
  },
): void {
  const identity = recordValue(evidence.identity)
  const gates = recordValue(evidence.evidence)
  const artifacts = recordValue(gates?.artifacts)
  const storedBindings = recordValue(identity?.currentBindings)
  const identityBindings = storedBindings
    ? Object.values(storedBindings)
    : identity?.currentBindings
  const gatesPassed = [
    "relevance",
    "fixedLoadResources",
    "currentInterference",
    "operatorReview",
  ].every((gate) => gates?.[gate] === "PASS")
  if (
    evidence.schemaVersion !== "watch-search-candidate-qualification/v1" ||
    evidence.status !== "QUALIFIED" ||
    !Array.isArray(evidence.reasons) ||
    evidence.reasons.length !== 0 ||
    identity?.generationId !== input.generationId ||
    identity?.applicationRevision !== input.applicationRevision ||
    identity?.transcriptCollection !== input.transcriptCollection ||
    identity?.transcriptProjectionRevision !==
      input.transcriptProjectionRevision.toString() ||
    identity?.qrelsRevision !== input.qrelsRevision ||
    !Array.isArray(identityBindings) ||
    JSON.stringify(identityBindings) !==
      JSON.stringify(input.currentBindings) ||
    !gatesPassed ||
    !artifacts ||
    Object.keys(artifacts).length === 0
  ) {
    throw new CandidateGenerationValidationError(
      "passing qualification requires an exact QUALIFIED report with reviewed evidence",
    )
  }
}

function normalizedFields(
  fields: readonly TypesenseCollectionField[],
  name: string,
): TypesenseCollectionField[] {
  if (fields.length === 0) {
    throw new CandidateGenerationValidationError(
      `${name} field manifest cannot be empty`,
    )
  }

  const names = new Set<string>()
  return fields.map((field) => {
    const fieldName = requiredString(field.name, `${name} field name`)
    const type = requiredString(field.type, `${name}.${fieldName} field type`)
    if (names.has(fieldName)) {
      throw new CandidateGenerationValidationError(
        `${name} field manifest contains duplicate field ${fieldName}`,
      )
    }
    names.add(fieldName)
    return { ...field, name: fieldName, type }
  })
}

function parseStoredFields(value: unknown, name: string) {
  if (!Array.isArray(value)) {
    throw new CandidateGenerationValidationError(
      `${name} stored field manifest is invalid`,
    )
  }
  return normalizedFields(value as TypesenseCollectionField[], name)
}

function validateMember(
  member: CandidateCollectionMember,
  name: string,
  ownership: CandidateCollectionOwnership,
) {
  const collection = requiredString(member.collection, `${name} collection`)
  if (member.ownership !== ownership) {
    throw new CandidateGenerationValidationError(
      `${name} collection must be marked ${ownership}`,
    )
  }
  return {
    collection,
    fields: normalizedFields(member.fields, name),
  }
}

function validateInput(input: CandidateGenerationInput) {
  const id = requiredString(input.id, "generation id")
  const applicationRevision = requiredString(
    input.applicationRevision,
    "application revision",
  )
  const sourceEpoch = requiredString(input.sourceEpoch, "source epoch")
  assertJsonObject(input.sourceDigests, "source digests")
  if (input.transcriptProjectionRevision < 0n) {
    throw new CandidateGenerationValidationError(
      "transcript projection revision cannot be negative",
    )
  }

  const catalog = validateMember(input.members.catalog, "catalog", "OWNED")
  const availability = validateMember(
    input.members.availability,
    "availability",
    "OWNED",
  )
  const lexical = validateMember(input.members.lexical, "lexical", "OWNED")
  const transcript = validateMember(
    input.members.transcript,
    "transcript",
    "SHARED",
  )
  const collections = [
    catalog.collection,
    availability.collection,
    lexical.collection,
    transcript.collection,
  ]
  if (new Set(collections).size !== collections.length) {
    throw new CandidateGenerationValidationError(
      "candidate physical collection members must be distinct",
    )
  }

  return {
    id,
    applicationRevision,
    sourceEpoch,
    sourceDigests: input.sourceDigests,
    transcriptProjectionRevision: input.transcriptProjectionRevision,
    catalog,
    availability,
    lexical,
    transcript,
  }
}

function assertSchemaMatches(
  expectedCollection: string,
  expectedFields: readonly TypesenseCollectionField[],
  actual: TypesenseCollectionSchema,
): void {
  if (actual.name !== expectedCollection) {
    throw new CandidateGenerationValidationError(
      `Typesense returned schema ${actual.name} for ${expectedCollection}`,
    )
  }
  if (actual.fields.length !== expectedFields.length) {
    throw new CandidateGenerationValidationError(
      `Typesense collection ${expectedCollection} field count does not match its manifest`,
    )
  }

  const actualByName = new Map(
    actual.fields.map((field) => [field.name, field]),
  )
  for (const expected of expectedFields) {
    const observed = actualByName.get(expected.name)
    if (!observed || observed.type !== expected.type) {
      throw new CandidateGenerationValidationError(
        `Typesense collection ${expectedCollection} field ${expected.name} does not match its manifest`,
      )
    }
    for (const key of [
      "facet",
      "index",
      "locale",
      "optional",
      "sort",
      "num_dim",
    ] as const) {
      if (expected[key] !== undefined && observed[key] !== expected[key]) {
        throw new CandidateGenerationValidationError(
          `Typesense collection ${expectedCollection} field ${expected.name} does not match its manifest`,
        )
      }
    }
  }
}

function assertGenerationReady(generation: StoredGeneration): void {
  if (generation.state !== "READY") {
    throw new CandidateGenerationValidationError(
      `candidate generation ${generation.id} is not READY`,
    )
  }
}

function assertExactIdentity(
  generation: StoredGeneration,
  identity: {
    applicationRevision: string
    transcriptCollection: string
    transcriptProjectionRevision: bigint
  },
): void {
  if (generation.applicationRevision !== identity.applicationRevision) {
    throw new CandidateGenerationCompatibilityError(
      `candidate generation ${generation.id} is not compatible with application revision ${identity.applicationRevision}`,
    )
  }
  if (
    generation.transcriptCollection !== identity.transcriptCollection ||
    generation.transcriptProjectionRevision !==
      identity.transcriptProjectionRevision
  ) {
    throw new CandidateGenerationCompatibilityError(
      `candidate generation ${generation.id} transcript identity is stale`,
    )
  }
}

function expiresAt(now: Date, ttlMs: number): Date {
  if (!Number.isInteger(ttlMs) || ttlMs <= 0 || ttlMs > MAX_LEASE_TTL_MS) {
    throw new CandidateGenerationValidationError(
      `lease ttlMs must be between 1 and ${MAX_LEASE_TTL_MS}`,
    )
  }
  return new Date(now.getTime() + ttlMs)
}

function normalizedBindings(bindings: readonly string[]): string[] {
  const normalized = bindings.map((binding) =>
    requiredString(binding, "current binding"),
  )
  if (
    normalized.length === 0 ||
    new Set(normalized).size !== normalized.length
  ) {
    throw new CandidateGenerationValidationError(
      "current bindings must be a non-empty set",
    )
  }
  return normalized
}

function storedStringArray(value: unknown, name: string): string[] {
  if (
    !Array.isArray(value) ||
    value.some((entry) => typeof entry !== "string" || !entry.trim())
  ) {
    throw new CandidateGenerationValidationError(`${name} is invalid`)
  }
  return value as string[]
}

function storedDeletionProgress(value: unknown): string[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return []
  const deleted = (value as { deletedCollections?: unknown }).deletedCollections
  return deleted == null
    ? []
    : storedStringArray(deleted, "deleted collections")
}

function isUniqueConflict(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "P2002"
  )
}

export class TypesenseWatchSearchCandidateGenerationService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly typesense: SchemaClient,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async createBuildingGeneration(input: CandidateGenerationInput) {
    const validated = validateInput(input)
    return this.prisma.watchSearchCandidateGeneration.create({
      data: {
        id: validated.id,
        state: "BUILDING",
        applicationRevision: validated.applicationRevision,
        sourceEpoch: validated.sourceEpoch,
        sourceDigests: asJson(validated.sourceDigests),
        catalogCollection: validated.catalog.collection,
        availabilityCollection: validated.availability.collection,
        lexicalCollection: validated.lexical.collection,
        transcriptCollection: validated.transcript.collection,
        transcriptProjectionRevision: validated.transcriptProjectionRevision,
        catalogFields: asJson(validated.catalog.fields),
        availabilityFields: asJson(validated.availability.fields),
        lexicalFields: asJson(validated.lexical.fields),
        transcriptFields: asJson(validated.transcript.fields),
        ownedCollections: asJson([
          validated.catalog.collection,
          validated.availability.collection,
          validated.lexical.collection,
        ]),
        sharedCollections: asJson([validated.transcript.collection]),
      },
    })
  }

  async validateAndMarkReady(input: {
    generationId: string
    expectedVersion: number
    documentCounts: Record<string, unknown>
    capacityEvidence: Record<string, unknown>
  }) {
    const generation =
      await this.prisma.watchSearchCandidateGeneration.findUnique({
        where: { id: input.generationId },
      })
    if (
      !generation ||
      generation.state !== "BUILDING" ||
      generation.version !== input.expectedVersion
    ) {
      throw new CandidateGenerationConflictError(
        `candidate generation ${input.generationId} changed before validation completed`,
      )
    }
    assertJsonObject(input.documentCounts, "document counts")
    assertJsonObject(input.capacityEvidence, "capacity evidence")

    const manifests = [
      [
        generation.catalogCollection,
        parseStoredFields(generation.catalogFields, "catalog"),
      ],
      [
        generation.availabilityCollection,
        parseStoredFields(generation.availabilityFields, "availability"),
      ],
      [
        generation.lexicalCollection,
        parseStoredFields(generation.lexicalFields, "lexical"),
      ],
      [
        generation.transcriptCollection,
        parseStoredFields(generation.transcriptFields, "transcript"),
      ],
    ] as const

    const schemas = await Promise.all(
      manifests.map(([collection]) =>
        this.typesense.getCollectionSchema(collection),
      ),
    )
    manifests.forEach(([collection, fields], index) =>
      assertSchemaMatches(collection, fields, schemas[index]!),
    )

    const update = await this.prisma.watchSearchCandidateGeneration.updateMany({
      where: {
        id: input.generationId,
        state: "BUILDING",
        version: input.expectedVersion,
      },
      data: {
        state: "READY",
        version: { increment: 1 },
        documentCounts: asJson(input.documentCounts),
        capacityEvidence: asJson(input.capacityEvidence),
        validatedAt: this.now(),
      },
    })
    if (update.count !== 1) {
      throw new CandidateGenerationConflictError(
        `candidate generation ${input.generationId} changed during validation`,
      )
    }
    return this.requireGeneration(input.generationId)
  }

  async transitionGeneration(input: {
    generationId: string
    expectedState: CandidateGenerationState
    expectedVersion: number
    nextState: CandidateGenerationState
    reason?: string
  }) {
    if (!LEGAL_TRANSITIONS[input.expectedState].includes(input.nextState)) {
      throw new CandidateGenerationValidationError(
        `illegal candidate lifecycle transition ${input.expectedState} -> ${input.nextState}`,
      )
    }
    const reason =
      input.nextState === "INVALIDATED"
        ? requiredString(input.reason ?? "", "invalidation reason")
        : null
    const now = this.now()

    const updated = await this.prisma.$transaction(
      async (tx) => {
        if (input.nextState === "RETIRING" || input.nextState === "RETIRED") {
          const activeLease = await tx.watchSearchCandidateLease.findFirst({
            where: { generationId: input.generationId, expiresAt: { gt: now } },
            select: { resourceKey: true },
          })
          if (activeLease) {
            throw new CandidateGenerationLeaseError(
              `candidate generation ${input.generationId} is leased`,
            )
          }
        }
        if (input.nextState === "RETIRED") {
          const generation = await tx.watchSearchCandidateGeneration.findUnique(
            {
              where: { id: input.generationId },
              select: { ownedCollections: true, deletionProgress: true },
            },
          )
          if (!generation) {
            throw new CandidateGenerationConflictError(
              `candidate generation ${input.generationId} changed before transition`,
            )
          }
          const owned = storedStringArray(
            generation.ownedCollections,
            "owned collections",
          )
          const deleted = storedDeletionProgress(generation.deletionProgress)
          if (
            owned.length !== deleted.length ||
            owned.some((collection) => !deleted.includes(collection))
          ) {
            throw new CandidateGenerationValidationError(
              "candidate generation cannot retire before every owned collection is deleted",
            )
          }
        }
        return tx.watchSearchCandidateGeneration.updateMany({
          where: {
            id: input.generationId,
            state: input.expectedState,
            version: input.expectedVersion,
          },
          data: {
            state: input.nextState,
            version: { increment: 1 },
            invalidatedAt: input.nextState === "INVALIDATED" ? now : undefined,
            invalidationReason: reason ?? undefined,
            retiredAt: input.nextState === "RETIRED" ? now : undefined,
          },
        })
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    )
    if (updated.count !== 1) {
      throw new CandidateGenerationConflictError(
        `candidate generation ${input.generationId} changed before transition`,
      )
    }
    return this.requireGeneration(input.generationId)
  }

  publishEvaluationGeneration(input: {
    generationId: string
    expectedPointerVersion: number
  }) {
    return this.movePointer("EVALUATION", input, false)
  }

  pinServingGeneration(input: {
    generationId: string
    expectedPointerVersion: number
    currentBindings: readonly string[]
    qrelsRevision: string
  }) {
    return this.movePointer("SERVING", input, true)
  }

  async resolveGeneration(input: {
    generationId: string
    applicationRevision: string
    transcriptCollection: string
    transcriptProjectionRevision: bigint
    requireQualified?: boolean
    currentBindings?: readonly string[]
    qrelsRevision?: string
  }) {
    const generation = await this.requireGeneration(input.generationId)
    assertGenerationReady(generation)

    if (
      generation.transcriptCollection !== input.transcriptCollection ||
      generation.transcriptProjectionRevision !==
        input.transcriptProjectionRevision
    ) {
      await this.prisma.watchSearchCandidateGeneration.updateMany({
        where: {
          id: generation.id,
          state: "READY",
          version: generation.version,
        },
        data: {
          state: "INVALIDATED",
          version: { increment: 1 },
          invalidatedAt: this.now(),
          invalidationReason:
            "transcript physical collection or projection revision changed",
        },
      })
      throw new CandidateGenerationCompatibilityError(
        `candidate generation ${generation.id} transcript identity is stale`,
      )
    }
    assertExactIdentity(generation, input)

    if (input.requireQualified) {
      if (!input.currentBindings || !input.qrelsRevision) {
        throw new CandidateGenerationValidationError(
          "qualified resolution requires current bindings and qrels revision",
        )
      }
      const qualification = await this.findExactPassedQualification(
        generation,
        input.currentBindings,
        input.qrelsRevision,
      )
      if (!qualification) {
        throw new CandidateGenerationValidationError(
          `candidate generation ${generation.id} has no exact passing qualification`,
        )
      }
    }

    return {
      generationId: generation.id,
      applicationRevision: generation.applicationRevision,
      transcriptProjectionRevision: generation.transcriptProjectionRevision,
      collections: {
        catalog: generation.catalogCollection,
        availability: generation.availabilityCollection,
        lexical: generation.lexicalCollection,
        transcript: generation.transcriptCollection,
      },
      fieldManifests: {
        catalog: parseStoredFields(generation.catalogFields, "catalog"),
        availability: parseStoredFields(
          generation.availabilityFields,
          "availability",
        ),
        lexical: parseStoredFields(generation.lexicalFields, "lexical"),
        transcript: parseStoredFields(
          generation.transcriptFields,
          "transcript",
        ),
      },
    }
  }

  async resolvePointer(input: {
    kind: PointerKind
    applicationRevision: string
    transcriptCollection: string
    transcriptProjectionRevision: bigint
    requireQualified?: boolean
  }) {
    const pointer = await this.prisma.watchSearchCandidatePointer.findUnique({
      where: { kind: input.kind },
    })
    if (!pointer?.generationId) {
      throw new CandidateGenerationValidationError(
        `${input.kind.toLowerCase()} candidate pointer is not set`,
      )
    }
    return this.resolveGeneration({
      ...input,
      generationId: pointer.generationId,
    })
  }

  async invalidateForTranscriptChange(input: {
    transcriptCollection: string
    transcriptProjectionRevision: bigint
    reason: string
  }): Promise<number> {
    const reason = requiredString(input.reason, "invalidation reason")
    const update = await this.prisma.watchSearchCandidateGeneration.updateMany({
      where: {
        state: { in: ["BUILDING", "READY"] },
        OR: [
          { transcriptCollection: { not: input.transcriptCollection } },
          {
            transcriptProjectionRevision: {
              not: input.transcriptProjectionRevision,
            },
          },
        ],
      },
      data: {
        state: "INVALIDATED",
        version: { increment: 1 },
        invalidatedAt: this.now(),
        invalidationReason: reason,
      },
    })
    return update.count
  }

  async recordQualification(input: {
    generationId: string
    status: WatchSearchCandidateQualificationStatus
    applicationRevision: string
    transcriptCollection: string
    transcriptProjectionRevision: bigint
    qrelsRevision: string
    currentBindings: readonly string[]
    evidence: Record<string, unknown>
  }) {
    const qrelsRevision = requiredString(input.qrelsRevision, "qrels revision")
    const currentBindings = normalizedBindings(input.currentBindings)
    assertJsonObject(input.evidence, "qualification evidence")
    if (input.status === "PASSED") {
      assertPassingQualificationEvidence(input.evidence, {
        ...input,
        qrelsRevision,
        currentBindings,
      })
    }
    return this.prisma.$transaction(
      async (tx) => {
        const generation = await tx.watchSearchCandidateGeneration.findUnique({
          where: { id: input.generationId },
        })
        if (!generation) {
          throw new CandidateGenerationValidationError(
            `candidate generation ${input.generationId} does not exist`,
          )
        }
        assertGenerationReady(generation)
        assertExactIdentity(generation, input)
        return tx.watchSearchCandidateQualification.create({
          data: {
            generationId: generation.id,
            status: input.status,
            applicationRevision: generation.applicationRevision,
            transcriptCollection: generation.transcriptCollection,
            transcriptProjectionRevision:
              generation.transcriptProjectionRevision,
            qrelsRevision,
            currentBindings: asJson(currentBindings),
            evidence: asJson(input.evidence),
          },
        })
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    )
  }

  async acquireLease(input: {
    resourceKey: string
    kind: WatchSearchCandidateLeaseKind
    holderToken: string
    ttlMs: number
    generationId: string
    applicationRevision: string
    transcriptCollection: string
    transcriptProjectionRevision: bigint
    currentBindings: readonly string[]
  }) {
    const resourceKey = requiredString(input.resourceKey, "lease resource key")
    const holderToken = requiredString(input.holderToken, "lease holder token")
    const currentBindings = normalizedBindings(input.currentBindings)
    const now = this.now()
    const expiry = expiresAt(now, input.ttlMs)

    return this.prisma.$transaction(
      async (tx) => {
        const lock = await tx.$queryRaw<Array<{ acquired: boolean }>>`
          SELECT pg_try_advisory_xact_lock(
            ${TYPESENSE_WATCH_SEARCH_PUBLICATION_LOCK_ID}
          ) AS acquired
        `
        if (lock[0]?.acquired !== true) return null
        const generation = await tx.watchSearchCandidateGeneration.findUnique({
          where: { id: input.generationId },
        })
        if (!generation) {
          throw new CandidateGenerationValidationError(
            `candidate generation ${input.generationId} does not exist`,
          )
        }
        assertGenerationReady(generation)
        assertExactIdentity(generation, input)

        const data = {
          kind: input.kind,
          holderToken,
          generationId: generation.id,
          applicationRevision: generation.applicationRevision,
          transcriptCollection: generation.transcriptCollection,
          transcriptProjectionRevision: generation.transcriptProjectionRevision,
          currentBindings: asJson(currentBindings),
          acquiredAt: now,
          renewedAt: now,
          expiresAt: expiry,
        } as const
        const takeover = await tx.watchSearchCandidateLease.updateMany({
          where: {
            resourceKey,
            OR: [{ expiresAt: { lte: now } }, { holderToken }],
          },
          data,
        })
        if (takeover.count === 0) {
          try {
            await tx.watchSearchCandidateLease.create({
              data: { resourceKey, ...data },
            })
          } catch (error) {
            if (isUniqueConflict(error)) return null
            throw error
          }
        }
        return tx.watchSearchCandidateLease.findUnique({
          where: { resourceKey },
        })
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    )
  }

  async renewLease(input: {
    resourceKey: string
    holderToken: string
    ttlMs: number
  }): Promise<boolean> {
    const now = this.now()
    const resourceKey = requiredString(input.resourceKey, "lease resource key")
    const holderToken = requiredString(input.holderToken, "lease holder token")
    return this.prisma.$transaction(
      async (tx) => {
        const lock = await tx.$queryRaw<Array<{ acquired: boolean }>>`
          SELECT pg_try_advisory_xact_lock(
            ${TYPESENSE_WATCH_SEARCH_PUBLICATION_LOCK_ID}
          ) AS acquired
        `
        if (lock[0]?.acquired !== true) return false
        const update = await tx.watchSearchCandidateLease.updateMany({
          where: {
            resourceKey,
            holderToken,
            expiresAt: { gt: now },
          },
          data: { renewedAt: now, expiresAt: expiresAt(now, input.ttlMs) },
        })
        return update.count === 1
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    )
  }

  async releaseLease(input: {
    resourceKey: string
    holderToken: string
  }): Promise<boolean> {
    const result = await this.prisma.watchSearchCandidateLease.deleteMany({
      where: {
        resourceKey: requiredString(input.resourceKey, "lease resource key"),
        holderToken: requiredString(input.holderToken, "lease holder token"),
      },
    })
    return result.count === 1
  }

  getGeneration(generationId: string) {
    return this.requireGeneration(requiredString(generationId, "generation id"))
  }

  async getPointer(kind: PointerKind) {
    const pointer = await this.prisma.watchSearchCandidatePointer.findUnique({
      where: { kind },
    })
    if (!pointer) {
      throw new CandidateGenerationValidationError(
        `${kind.toLowerCase()} candidate pointer is missing`,
      )
    }
    return pointer
  }

  async clearPointer(
    kind: PointerKind,
    input: { generationId: string; expectedPointerVersion: number },
  ) {
    const update = await this.prisma.watchSearchCandidatePointer.updateMany({
      where: {
        kind,
        generationId: requiredString(input.generationId, "generation id"),
        version: input.expectedPointerVersion,
      },
      data: { generationId: null, version: { increment: 1 } },
    })
    if (update.count !== 1) {
      throw new CandidateGenerationConflictError(
        `${kind.toLowerCase()} candidate pointer changed concurrently`,
      )
    }
    return this.getPointer(kind)
  }

  async beginRetirement(generationId: string) {
    const id = requiredString(generationId, "generation id")
    const now = this.now()
    return this.prisma.$transaction(
      async (tx) => {
        const generation = await tx.watchSearchCandidateGeneration.findUnique({
          where: { id },
        })
        if (!generation) {
          throw new CandidateGenerationValidationError(
            `candidate generation ${id} does not exist`,
          )
        }
        if (generation.state === "RETIRED" || generation.state === "RETIRING") {
          return generation
        }
        if (
          generation.state !== "BUILDING" &&
          generation.state !== "READY" &&
          generation.state !== "INVALIDATED"
        ) {
          throw new CandidateGenerationValidationError(
            `candidate generation ${id} cannot retire from ${generation.state}`,
          )
        }

        const [servingPointer, evaluationPointer, activeLease] =
          await Promise.all([
            tx.watchSearchCandidatePointer.findUnique({
              where: { kind: "SERVING" },
            }),
            tx.watchSearchCandidatePointer.findUnique({
              where: { kind: "EVALUATION" },
            }),
            tx.watchSearchCandidateLease.findFirst({
              where: { generationId: id, expiresAt: { gt: now } },
              select: { resourceKey: true },
            }),
          ])
        if (servingPointer?.generationId === id) {
          throw new CandidateGenerationLeaseError(
            `candidate generation ${id} is still referenced by serving`,
          )
        }
        if (activeLease) {
          throw new CandidateGenerationLeaseError(
            `candidate generation ${id} is leased`,
          )
        }

        if (evaluationPointer?.generationId === id) {
          const cleared = await tx.watchSearchCandidatePointer.updateMany({
            where: {
              kind: "EVALUATION",
              generationId: id,
              version: evaluationPointer.version,
            },
            data: { generationId: null, version: { increment: 1 } },
          })
          if (cleared.count !== 1) {
            throw new CandidateGenerationConflictError(
              "evaluation candidate pointer changed during retirement",
            )
          }
        }

        const update = await tx.watchSearchCandidateGeneration.updateMany({
          where: {
            id,
            state: generation.state,
            version: generation.version,
          },
          data: {
            state: "RETIRING",
            version: { increment: 1 },
            invalidatedAt: generation.state === "READY" ? now : undefined,
            invalidationReason:
              generation.state === "READY"
                ? "candidate retirement requested"
                : undefined,
          },
        })
        if (update.count !== 1) {
          throw new CandidateGenerationConflictError(
            `candidate generation ${id} changed during retirement`,
          )
        }
        const retiring = await tx.watchSearchCandidateGeneration.findUnique({
          where: { id },
        })
        if (!retiring) {
          throw new CandidateGenerationConflictError(
            `candidate generation ${id} disappeared during retirement`,
          )
        }
        return retiring
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    )
  }

  async assertRetirementAllowed(generationId: string): Promise<void> {
    const now = this.now()
    const [pointer, lease] = await this.prisma.$transaction(
      async (tx) =>
        Promise.all([
          tx.watchSearchCandidatePointer.findFirst({
            where: { generationId },
            select: { kind: true },
          }),
          tx.watchSearchCandidateLease.findFirst({
            where: { generationId, expiresAt: { gt: now } },
            select: { resourceKey: true },
          }),
        ]),
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    )
    if (pointer) {
      throw new CandidateGenerationLeaseError(
        `candidate generation ${generationId} is still referenced by ${pointer.kind.toLowerCase()}`,
      )
    }
    if (lease) {
      throw new CandidateGenerationLeaseError(
        `candidate generation ${generationId} is leased`,
      )
    }
  }

  async recordDeletionProgress(input: {
    generationId: string
    expectedVersion: number
    deletedCollections: readonly string[]
  }) {
    const generation = await this.requireGeneration(input.generationId)
    if (
      generation.state !== "RETIRING" ||
      generation.version !== input.expectedVersion
    ) {
      throw new CandidateGenerationConflictError(
        `candidate generation ${input.generationId} changed during retirement`,
      )
    }
    const owned = new Set(
      storedStringArray(generation.ownedCollections, "owned collections"),
    )
    const deletedCollections = normalizedBindings(input.deletedCollections)
    if (deletedCollections.some((collection) => !owned.has(collection))) {
      throw new CandidateGenerationValidationError(
        "deletion progress contains a collection not owned by the generation",
      )
    }
    const previous = storedDeletionProgress(generation.deletionProgress)
    if (
      previous.some((collection) => !deletedCollections.includes(collection))
    ) {
      throw new CandidateGenerationValidationError(
        "deletion progress cannot move backward",
      )
    }
    const update = await this.prisma.watchSearchCandidateGeneration.updateMany({
      where: {
        id: input.generationId,
        state: "RETIRING",
        version: input.expectedVersion,
      },
      data: {
        version: { increment: 1 },
        deletionProgress: asJson({ deletedCollections }),
      },
    })
    if (update.count !== 1) {
      throw new CandidateGenerationConflictError(
        `candidate generation ${input.generationId} changed during retirement`,
      )
    }
    return this.requireGeneration(input.generationId)
  }

  async assertGenerationNotLeased(generationId: string): Promise<void> {
    const active = await this.prisma.watchSearchCandidateLease.findFirst({
      where: {
        generationId: requiredString(generationId, "generation id"),
        expiresAt: { gt: this.now() },
      },
      select: { resourceKey: true },
    })
    if (active) {
      throw new CandidateGenerationLeaseError(
        `candidate generation ${generationId} is leased`,
      )
    }
  }

  async assertTranscriptNotLeased(
    transcriptCollection: string,
    transcriptProjectionRevision: bigint,
  ): Promise<void> {
    const active = await this.prisma.watchSearchCandidateLease.findFirst({
      where: {
        transcriptCollection: requiredString(
          transcriptCollection,
          "transcript collection",
        ),
        transcriptProjectionRevision,
        expiresAt: { gt: this.now() },
      },
      select: { resourceKey: true },
    })
    if (active) {
      throw new CandidateGenerationLeaseError(
        `transcript projection ${transcriptCollection}@${transcriptProjectionRevision} is leased`,
      )
    }
  }

  async assertCurrentPublicationAllowed(input: {
    rebuildTranscripts: boolean
  }): Promise<void> {
    const now = this.now()
    const [activeLease, transcriptCandidate, servingPointer] =
      await Promise.all([
        this.prisma.watchSearchCandidateLease.findFirst({
          where: { expiresAt: { gt: now } },
          select: { resourceKey: true },
        }),
        input.rebuildTranscripts
          ? this.prisma.watchSearchCandidateGeneration.findFirst({
              where: { state: { in: ["BUILDING", "READY"] } },
              select: { id: true },
            })
          : Promise.resolve(null),
        this.prisma.watchSearchCandidatePointer.findUnique({
          where: { kind: "SERVING" },
          select: { generationId: true },
        }),
      ])
    if (activeLease) {
      throw new CandidateGenerationLeaseError(
        "current publication is blocked by an active candidate lease",
      )
    }
    if (servingPointer?.generationId) {
      throw new CandidateGenerationLeaseError(
        `current publication is blocked by serving candidate generation ${servingPointer.generationId}`,
      )
    }
    if (transcriptCandidate) {
      throw new CandidateGenerationLeaseError(
        `transcript rebuild is blocked by candidate generation ${transcriptCandidate.id}`,
      )
    }
  }

  private async movePointer(
    kind: PointerKind,
    input: {
      generationId: string
      expectedPointerVersion: number
      currentBindings?: readonly string[]
      qrelsRevision?: string
    },
    requireQualification: boolean,
  ) {
    return this.prisma.$transaction(
      async (tx) => {
        if (kind === "SERVING") {
          const lock = await tx.$queryRaw<Array<{ acquired: boolean }>>`
            SELECT pg_try_advisory_xact_lock(
              ${TYPESENSE_WATCH_SEARCH_PUBLICATION_LOCK_ID}
            ) AS acquired
          `
          if (lock[0]?.acquired !== true) {
            throw new CandidateGenerationLeaseError(
              "serving promotion is blocked by current publication",
            )
          }
        }
        const generation = await tx.watchSearchCandidateGeneration.findUnique({
          where: { id: input.generationId },
        })
        if (!generation) {
          throw new CandidateGenerationValidationError(
            `candidate generation ${input.generationId} does not exist`,
          )
        }
        assertGenerationReady(generation)
        if (requireQualification) {
          if (!input.currentBindings || !input.qrelsRevision) {
            throw new CandidateGenerationValidationError(
              "serving promotion requires current bindings and qrels revision",
            )
          }
          const currentBindings = normalizedBindings(input.currentBindings)
          const qrelsRevision = requiredString(
            input.qrelsRevision,
            "qrels revision",
          )
          const qualification =
            await tx.watchSearchCandidateQualification.findFirst({
              where: {
                generationId: generation.id,
                status: "PASSED",
                applicationRevision: generation.applicationRevision,
                transcriptCollection: generation.transcriptCollection,
                transcriptProjectionRevision:
                  generation.transcriptProjectionRevision,
                qrelsRevision,
                currentBindings: { equals: asJson(currentBindings) },
              },
              select: { id: true },
            })
          if (!qualification) {
            throw new CandidateGenerationValidationError(
              `candidate generation ${generation.id} has no exact passing qualification`,
            )
          }
        }

        const update = await tx.watchSearchCandidatePointer.updateMany({
          where: { kind, version: input.expectedPointerVersion },
          data: {
            generationId: generation.id,
            version: { increment: 1 },
          },
        })
        if (update.count !== 1) {
          throw new CandidateGenerationConflictError(
            `${kind.toLowerCase()} candidate pointer changed concurrently`,
          )
        }
        const pointer = await tx.watchSearchCandidatePointer.findUnique({
          where: { kind },
        })
        if (!pointer) {
          throw new CandidateGenerationConflictError(
            `${kind.toLowerCase()} candidate pointer is missing`,
          )
        }
        return pointer
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    )
  }

  private async findExactPassedQualification(
    generation: StoredGeneration,
    currentBindings: readonly string[],
    qrelsRevision: string,
  ) {
    return this.prisma.watchSearchCandidateQualification.findFirst({
      where: {
        generationId: generation.id,
        status: "PASSED",
        applicationRevision: generation.applicationRevision,
        transcriptCollection: generation.transcriptCollection,
        transcriptProjectionRevision: generation.transcriptProjectionRevision,
        qrelsRevision: requiredString(qrelsRevision, "qrels revision"),
        currentBindings: {
          equals: asJson(normalizedBindings(currentBindings)),
        },
      },
      select: { id: true },
    })
  }

  private async requireGeneration(id: string) {
    const generation =
      await this.prisma.watchSearchCandidateGeneration.findUnique({
        where: { id },
      })
    if (!generation) {
      throw new CandidateGenerationValidationError(
        `candidate generation ${id} does not exist`,
      )
    }
    return generation
  }
}
