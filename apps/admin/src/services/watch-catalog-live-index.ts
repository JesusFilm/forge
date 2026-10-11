import { createHash } from "node:crypto"
import type { PrismaClient } from "@prisma/client"
import type { TypesenseClient } from "./typesense-client"
import {
  buildCatalogDocuments,
  buildAvailabilityDocuments,
  buildTypesenseWatchCandidateProjectionSnapshot,
} from "./typesense-watch-search-indexer"
import { buildTypesenseWatchCandidateLexicalDocuments } from "./typesense-watch-search-lexical"
import {
  candidateWatchCollectionNames,
  candidateWatchCollectionSchemas,
  candidateWatchCurationSetName,
} from "./typesense-watch-search-schema"
import {
  buildTypesenseWatchCurationProjection,
  loadWatchSearchCurations,
} from "./typesense-watch-search-curation"

const BATCH_SIZE = 100

export class LiveWatchSchemaExpansionError extends Error {
  constructor(readonly field: string) {
    super(`Live Watch lexical schema lacks ${field}`)
    this.name = "LiveWatchSchemaExpansionError"
  }
}

function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex")
}

function jsonIds(value: unknown): string[] {
  if (!Array.isArray(value) || value.some((id) => typeof id !== "string"))
    throw new Error("Watch catalog document ledger is corrupt")
  return value as string[]
}

async function importBatches(
  typesense: TypesenseClient,
  collection: string,
  documents: readonly object[],
) {
  for (let offset = 0; offset < documents.length; offset += 250)
    await typesense.importDocuments(
      collection,
      documents.slice(offset, offset + 250),
      "upsert",
    )
}

/** Full construction is reserved for the first live catalog or contract change.
 * An incomplete attempt is never selected by readers and is rebuilt on retry. */
export async function bootstrapLiveWatchCatalog(input: {
  prisma: PrismaClient
  typesense: TypesenseClient
  liveId: string
  assertLock: () => Promise<void>
}): Promise<void> {
  const { prisma, typesense, liveId, assertLock } = input
  const snapshot = await buildTypesenseWatchCandidateProjectionSnapshot(prisma)
  if (snapshot.counts.catalog === 0)
    throw new Error("Refusing an empty live Watch catalog")
  const schemas = candidateWatchCollectionSchemas(
    liveId,
    snapshot.tokenizerLocales,
  )
  const names = candidateWatchCollectionNames(liveId)
  const searchableCoreIds = new Set(
    snapshot.catalog.map((document) => document.coreId),
  )
  const curation = buildTypesenseWatchCurationProjection({
    setName: candidateWatchCurationSetName(liveId),
    curations: snapshot.curations.filter((item) =>
      searchableCoreIds.has(item.targetVideoCoreId),
    ),
    lexicalDocuments: snapshot.lexical,
  })
  const owner = await prisma.watchCatalogPublication.findUniqueOrThrow({
    where: { id: "core" },
    select: { buildingLiveCollectionId: true, liveCollectionId: true },
  })
  if (
    owner.buildingLiveCollectionId &&
    owner.buildingLiveCollectionId !== liveId &&
    owner.buildingLiveCollectionId !== owner.liveCollectionId
  ) {
    const abandoned = candidateWatchCollectionNames(
      owner.buildingLiveCollectionId,
    )
    for (const name of Object.values(abandoned))
      await typesense.deleteCollection(name)
    await typesense.deleteCurationSet(
      candidateWatchCurationSetName(owner.buildingLiveCollectionId),
    )
  }
  await prisma.watchCatalogPublication.update({
    where: { id: "core" },
    data: { buildingLiveCollectionId: liveId },
  })
  for (const name of Object.values(names))
    await typesense.deleteCollection(name)
  await typesense.upsertCurationSet(curation.name, curation.set)
  for (const [name, schema, documents] of [
    ["catalog", schemas.catalog, snapshot.catalog],
    ["availability", schemas.availability, snapshot.availability],
    ["lexical", schemas.lexical, snapshot.lexical],
  ] as const) {
    await assertLock()
    await typesense.createCollection(schema)
    await importBatches(typesense, names[name], documents)
  }
  const counts = await typesense.multiSearch(
    Object.values(names).map((collection) => ({
      collection,
      q: "*",
      per_page: 1,
    })),
  )
  if (
    counts[0]?.found !== snapshot.counts.catalog ||
    counts[1]?.found !== snapshot.counts.availability ||
    counts[2]?.found !== snapshot.counts.lexical
  )
    throw new Error("Live Watch catalog bootstrap count mismatch")
  const exactTitleKey = snapshot.lexical.find(
    (document) => (document.title_exact_keys?.length ?? 0) > 0,
  )?.title_exact_keys?.[0]
  if (exactTitleKey) {
    const [result] = await typesense.multiSearch<{
      title_exact_keys?: string[]
    }>([
      {
        collection: names.lexical,
        q: exactTitleKey,
        query_by: "title_exact_keys",
        include_fields: "id,title_exact_keys",
        num_typos: 0,
        prefix: false,
        drop_tokens_threshold: 0,
        per_page: 1,
      },
    ])
    if (
      !result?.hits?.some((hit) =>
        hit.document.title_exact_keys?.includes(exactTitleKey),
      )
    )
      throw new Error("Live Watch exact-title read failed")
  }
  await assertLock()
  const availability = new Map<string, typeof snapshot.availability>()
  const lexical = new Map<string, typeof snapshot.lexical>()
  for (const document of snapshot.availability)
    availability.set(document.videoId, [
      ...(availability.get(document.videoId) ?? []),
      document,
    ])
  for (const document of snapshot.lexical)
    lexical.set(document.videoId, [
      ...(lexical.get(document.videoId) ?? []),
      document,
    ])
  await prisma.$transaction(
    async (tx) => {
      const publication = await tx.watchCatalogPublication.findUniqueOrThrow({
        where: { id: "core" },
        select: {
          generationId: true,
          liveCollectionId: true,
          retiredLive: true,
        },
      })
      const retired = Array.isArray(publication.retiredLive)
        ? publication.retiredLive
        : []
      await tx.watchCatalogVideoState.deleteMany()
      await tx.watchCatalogVideoState.createMany({
        data: snapshot.catalog.map((document) => {
          const availabilityDocs = availability.get(document.id) ?? []
          const lexicalDocs = lexical.get(document.id) ?? []
          return {
            videoId: document.id,
            catalogDigest: digest(document),
            availabilityDigest: digest(availabilityDocs),
            availabilityIds: availabilityDocs.map((item) => item.id),
            lexicalDigest: digest(lexicalDocs),
            lexicalIds: lexicalDocs.map((item) => item.id),
          }
        }),
      })
      await tx.watchCatalogPublication.update({
        where: { id: "core" },
        data: {
          liveCollectionId: liveId,
          liveUpdating: true,
          liveLexicalFields: schemas.lexical.fields,
          generationId: null,
          buildingLiveCollectionId: null,
          liveCurationDigest: digest(curation.set),
          liveCurationInFlight: false,
          retiredLive:
            publication.liveCollectionId &&
            publication.liveCollectionId !== liveId
              ? [
                  ...retired,
                  {
                    id: publication.liveCollectionId,
                    after: new Date(Date.now() + 5 * 60_000).toISOString(),
                  },
                ]
              : retired,
        },
      })
      if (publication.generationId)
        await tx.watchSearchCandidateGeneration.update({
          where: { id: publication.generationId },
          data: { updatedAt: new Date() },
        })
    },
    { timeout: 60_000 },
  )
}

/** A failed import may have written any prefix of these documents. The compact
 * ledger moves only after all writes; retry reprojects current source data. */
export async function applyLiveWatchCatalogChanges(input: {
  prisma: PrismaClient
  typesense: TypesenseClient
  liveId: string
  assertLock: () => Promise<void>
}): Promise<number> {
  const { prisma, typesense, liveId, assertLock } = input
  const names = candidateWatchCollectionNames(liveId)
  const upper = await prisma.watchCatalogDirtyVideo.aggregate({
    _max: { revision: true },
  })
  if (upper._max.revision == null) {
    return 0
  }
  await prisma.watchCatalogPublication.update({
    where: { id: "core" },
    data: { liveUpdating: true },
  })
  let processed = 0
  while (true) {
    const dirty = await prisma.watchCatalogDirtyVideo.findMany({
      where: { revision: { lte: upper._max.revision } },
      orderBy: { revision: "asc" },
      take: BATCH_SIZE,
    })
    if (dirty.length === 0) break
    await assertLock()
    const ids = dirty.map((row) => row.videoId)
    const catalog = (await buildCatalogDocuments(prisma, ids)).sort((a, b) =>
      a.id.localeCompare(b.id),
    )
    const catalogById = new Map(catalog.map((doc) => [doc.id, doc]))
    const availability = buildAvailabilityDocuments(catalog).sort((a, b) =>
      a.id.localeCompare(b.id),
    )
    const lexical = buildTypesenseWatchCandidateLexicalDocuments(catalog).sort(
      (a, b) => a.id.localeCompare(b.id),
    )
    const schema = await typesense.getCollectionSchema(names.lexical)
    const fields = new Set(schema.fields.map((field) => field.name))
    for (const doc of lexical)
      for (const field of Object.keys(doc))
        if (/^(title|metadata)_/.test(field) && !fields.has(field))
          throw new LiveWatchSchemaExpansionError(field)
    for (const row of dirty) {
      const document = catalogById.get(row.videoId)
      const availabilityDocs = availability.filter(
        (item) => item.videoId === row.videoId,
      )
      const lexicalDocs = lexical.filter((item) => item.videoId === row.videoId)
      const previous = await prisma.watchCatalogVideoState.findUnique({
        where: { videoId: row.videoId },
      })
      const nextCatalogDigest = document ? digest(document) : null
      const nextAvailabilityDigest = digest(availabilityDocs)
      const nextLexicalDigest = digest(lexicalDocs)
      const previousAvailabilityIds = previous
        ? jsonIds(previous.availabilityIds)
        : []
      const previousLexicalIds = previous ? jsonIds(previous.lexicalIds) : []
      const writeCatalog =
        previous?.inFlight === true ||
        (previous?.catalogDigest ?? null) !== nextCatalogDigest
      const writeAvailability =
        previous?.inFlight === true ||
        (previous?.availabilityDigest ?? digest([])) !== nextAvailabilityDigest
      const writeLexical =
        previous?.inFlight === true ||
        (previous?.lexicalDigest ?? digest([])) !== nextLexicalDigest
      if (writeCatalog || writeAvailability || writeLexical) {
        // Record every child ID a failed attempt could have written BEFORE
        // sending any Typesense request. A retry may see a different source
        // value (including a reversion or removal) and must clean that prefix.
        const possibleAvailabilityIds = [
          ...new Set([
            ...previousAvailabilityIds,
            ...jsonIds(previous?.possibleAvailabilityIds ?? []),
            ...availabilityDocs.map((item) => item.id),
          ]),
        ]
        const possibleLexicalIds = [
          ...new Set([
            ...previousLexicalIds,
            ...jsonIds(previous?.possibleLexicalIds ?? []),
            ...lexicalDocs.map((item) => item.id),
          ]),
        ]
        await prisma.watchCatalogVideoState.upsert({
          where: { videoId: row.videoId },
          create: {
            videoId: row.videoId,
            catalogDigest: null,
            availabilityDigest: digest([]),
            availabilityIds: [],
            lexicalDigest: digest([]),
            lexicalIds: [],
            inFlight: true,
            possibleAvailabilityIds,
            possibleLexicalIds,
          },
          update: {
            inFlight: true,
            possibleAvailabilityIds,
            possibleLexicalIds,
          },
        })
      }
      if (writeCatalog) {
        if (document)
          await typesense.importDocuments(names.catalog, [document], "upsert")
        else await typesense.deleteDocument(names.catalog, row.videoId)
      }
      if (writeAvailability) {
        const possibleIds = [
          ...previousAvailabilityIds,
          ...jsonIds(previous?.possibleAvailabilityIds ?? []),
        ]
        for (const oldId of new Set(possibleIds))
          if (!availabilityDocs.some((item) => item.id === oldId))
            await typesense.deleteDocument(names.availability, oldId)
        await importBatches(typesense, names.availability, availabilityDocs)
      }
      if (writeLexical) {
        const possibleIds = [
          ...previousLexicalIds,
          ...jsonIds(previous?.possibleLexicalIds ?? []),
        ]
        for (const oldId of new Set(possibleIds))
          if (!lexicalDocs.some((item) => item.id === oldId))
            await typesense.deleteDocument(names.lexical, oldId)
        await importBatches(typesense, names.lexical, lexicalDocs)
      }
      await assertLock()
      await prisma.$transaction(async (tx) => {
        if (document)
          await tx.watchCatalogVideoState.upsert({
            where: { videoId: row.videoId },
            create: {
              videoId: row.videoId,
              catalogDigest: nextCatalogDigest,
              availabilityDigest: nextAvailabilityDigest,
              availabilityIds: availabilityDocs.map((item) => item.id),
              lexicalDigest: nextLexicalDigest,
              lexicalIds: lexicalDocs.map((item) => item.id),
              inFlight: false,
              possibleAvailabilityIds: [],
              possibleLexicalIds: [],
            },
            update: {
              catalogDigest: nextCatalogDigest,
              availabilityDigest: nextAvailabilityDigest,
              availabilityIds: availabilityDocs.map((item) => item.id),
              lexicalDigest: nextLexicalDigest,
              lexicalIds: lexicalDocs.map((item) => item.id),
              inFlight: false,
              possibleAvailabilityIds: [],
              possibleLexicalIds: [],
            },
          })
        else
          await tx.watchCatalogVideoState.deleteMany({
            where: { videoId: row.videoId },
          })
        await tx.watchCatalogDirtyVideo.deleteMany({
          where: { videoId: row.videoId, revision: row.revision },
        })
      })
      processed++
    }
  }
  return processed
}

/** Curations are small editorial metadata, independent of the Core dirty-ID
 * queue. Resolve only their target videos and persist intent before writing. */
export async function refreshLiveWatchCurations(input: {
  prisma: PrismaClient
  typesense: TypesenseClient
  liveId: string
}): Promise<boolean> {
  const { prisma, typesense, liveId } = input
  const curations = await loadWatchSearchCurations(prisma)
  const targetCoreIds = [
    ...new Set(curations.map((curation) => curation.targetVideoCoreId)),
  ]
  const targets = targetCoreIds.length
    ? await prisma.video.findMany({
        where: { coreId: { in: targetCoreIds } },
        select: { id: true },
      })
    : []
  const catalog = await buildCatalogDocuments(
    prisma,
    targets.map((target) => target.id),
  )
  const lexical = buildTypesenseWatchCandidateLexicalDocuments(catalog)
  const searchableCoreIds = new Set(catalog.map((document) => document.coreId))
  const projection = buildTypesenseWatchCurationProjection({
    setName: candidateWatchCurationSetName(liveId),
    curations: curations.filter((curation) =>
      searchableCoreIds.has(curation.targetVideoCoreId),
    ),
    lexicalDocuments: lexical,
  })
  const nextDigest = digest(projection.set)
  const publication = await prisma.watchCatalogPublication.findUniqueOrThrow({
    where: { id: "core" },
    select: { liveCurationDigest: true, liveCurationInFlight: true },
  })
  if (
    publication.liveCurationDigest === nextDigest &&
    !publication.liveCurationInFlight
  )
    return false
  await prisma.watchCatalogPublication.update({
    where: { id: "core" },
    data: { liveCurationInFlight: true },
  })
  await typesense.upsertCurationSet(projection.name, projection.set)
  await prisma.watchCatalogPublication.update({
    where: { id: "core" },
    data: { liveCurationDigest: nextDigest, liveCurationInFlight: false },
  })
  return true
}

export async function cleanupRetiredLiveWatchCatalogs(input: {
  prisma: PrismaClient
  typesense: TypesenseClient
  assertLock: () => Promise<void>
}): Promise<void> {
  const { prisma, typesense, assertLock } = input
  const publication = await prisma.watchCatalogPublication.findUniqueOrThrow({
    where: { id: "core" },
  })
  if (!Array.isArray(publication.retiredLive))
    throw new Error("Retired live Watch catalog ledger is corrupt")
  let remaining = publication.retiredLive
  for (const entry of publication.retiredLive) {
    if (
      !entry ||
      typeof entry !== "object" ||
      Array.isArray(entry) ||
      typeof entry.id !== "string" ||
      typeof entry.after !== "string"
    )
      throw new Error("Retired live Watch catalog entry is corrupt")
    if (
      entry.id === publication.liveCollectionId ||
      new Date(entry.after) > new Date()
    )
      continue
    await assertLock()
    const names = candidateWatchCollectionNames(entry.id)
    for (const name of Object.values(names))
      await typesense.deleteCollection(name)
    await typesense.deleteCurationSet(candidateWatchCurationSetName(entry.id))
    remaining = remaining.filter(
      (candidate) =>
        !candidate ||
        typeof candidate !== "object" ||
        Array.isArray(candidate) ||
        candidate.id !== entry.id,
    )
    await prisma.watchCatalogPublication.update({
      where: { id: "core" },
      data: { retiredLive: remaining },
    })
  }
}
