import { Prisma, type PrismaClient } from "@prisma/client"

export const ACTIVE_CONTENT_EMBEDDING_CONTRACT_ID =
  "semantic-transcript-pgvector-v1" as const
export const CONTENT_EMBEDDING_CONTRACT_POINTER_ID =
  "content-embedding-contract-pointer" as const
export const ACTIVE_CONTENT_QUERY_EMBEDDING_PROVIDER = "openrouter" as const
export const ACTIVE_CONTENT_QUERY_EMBEDDING_MODEL =
  "qwen/qwen3-embedding-8b" as const
export const ACTIVE_CONTENT_QUERY_EMBEDDING_DIMENSIONS = 1536 as const
export const ACTIVE_CONTENT_STORAGE_EMBEDDING_PROVIDER =
  "jesus-film-ai-gateway" as const
export const ACTIVE_CONTENT_STORAGE_EMBEDDING_MODEL = "embeddings" as const
export const ACTIVE_CONTENT_STORAGE_EMBEDDING_DIMENSIONS = 1536 as const

export type ContentEmbeddingTuple = {
  provider: string
  model: string
  nativeDimensions: number
  dimensions: number
  transformVersion: string | null
}

export type ContentEmbeddingContract = {
  id: string
  query: ContentEmbeddingTuple
  storage: ContentEmbeddingTuple
}

export const ACTIVE_CONTENT_EMBEDDING_CONTRACT_SEED = {
  id: ACTIVE_CONTENT_EMBEDDING_CONTRACT_ID,
  query: {
    provider: ACTIVE_CONTENT_QUERY_EMBEDDING_PROVIDER,
    model: ACTIVE_CONTENT_QUERY_EMBEDDING_MODEL,
    nativeDimensions: ACTIVE_CONTENT_QUERY_EMBEDDING_DIMENSIONS,
    dimensions: ACTIVE_CONTENT_QUERY_EMBEDDING_DIMENSIONS,
    transformVersion: null,
  },
  storage: {
    provider: ACTIVE_CONTENT_STORAGE_EMBEDDING_PROVIDER,
    model: ACTIVE_CONTENT_STORAGE_EMBEDDING_MODEL,
    nativeDimensions: ACTIVE_CONTENT_STORAGE_EMBEDDING_DIMENSIONS,
    dimensions: ACTIVE_CONTENT_STORAGE_EMBEDDING_DIMENSIONS,
    transformVersion: null,
  },
} as const satisfies ContentEmbeddingContract

type ContentEmbeddingContractRow = {
  pointerId: string
  contractId: string | null
  queryProvider: string | null
  queryModel: string | null
  queryNativeDimensions: number | null
  queryDimensions: number | null
  queryTransformVersion: string | null
  storageProvider: string | null
  storageModel: string | null
  storageNativeDimensions: number | null
  storageDimensions: number | null
  storageTransformVersion: string | null
}

export class ContentEmbeddingContractStateError extends Error {
  constructor(
    readonly code:
      | "missing_active_pointer"
      | "multiple_active_pointers"
      | "dangling_active_pointer",
    message: string,
  ) {
    super(message)
    this.name = "ContentEmbeddingContractStateError"
  }
}

function normalizeTuple(tuple: {
  provider: string | null
  model: string | null
  nativeDimensions: number | null
  dimensions: number | null
  transformVersion: string | null
}): ContentEmbeddingTuple | null {
  if (
    tuple.provider == null ||
    tuple.model == null ||
    tuple.nativeDimensions == null ||
    tuple.dimensions == null
  ) {
    return null
  }

  return {
    provider: tuple.provider,
    model: tuple.model,
    nativeDimensions: tuple.nativeDimensions,
    dimensions: tuple.dimensions,
    transformVersion: tuple.transformVersion,
  }
}

export function contentEmbeddingTupleMatches(
  left: ContentEmbeddingTuple,
  right: ContentEmbeddingTuple,
): boolean {
  return (
    left.provider === right.provider &&
    left.model === right.model &&
    left.nativeDimensions === right.nativeDimensions &&
    left.dimensions === right.dimensions &&
    left.transformVersion === right.transformVersion
  )
}

export async function resolveActiveContentEmbeddingContract(
  prisma: Pick<PrismaClient, "$queryRaw">,
): Promise<ContentEmbeddingContract> {
  const rows = await prisma.$queryRaw<ContentEmbeddingContractRow[]>`
    SELECT
      pointer.id AS "pointerId",
      contract.id AS "contractId",
      contract.query_provider AS "queryProvider",
      contract.query_model AS "queryModel",
      contract.query_native_dimensions AS "queryNativeDimensions",
      contract.query_dimensions AS "queryDimensions",
      contract.query_transform_version AS "queryTransformVersion",
      contract.storage_provider AS "storageProvider",
      contract.storage_model AS "storageModel",
      contract.storage_native_dimensions AS "storageNativeDimensions",
      contract.storage_dimensions AS "storageDimensions",
      contract.storage_transform_version AS "storageTransformVersion"
    FROM content_embedding_contract_pointer pointer
    LEFT JOIN content_embedding_contract contract
      ON contract.id = pointer.active_contract_id
    ORDER BY pointer.id ASC
  `

  if (rows.length === 0) {
    throw new ContentEmbeddingContractStateError(
      "missing_active_pointer",
      "Active content embedding contract pointer is missing",
    )
  }
  if (rows.length > 1) {
    throw new ContentEmbeddingContractStateError(
      "multiple_active_pointers",
      "Multiple active content embedding contract pointers exist",
    )
  }

  const row = rows[0]!
  if (
    row.pointerId !== CONTENT_EMBEDDING_CONTRACT_POINTER_ID ||
    row.contractId == null
  ) {
    throw new ContentEmbeddingContractStateError(
      "dangling_active_pointer",
      "Active content embedding contract pointer does not resolve to a contract",
    )
  }

  const query = normalizeTuple({
    provider: row.queryProvider,
    model: row.queryModel,
    nativeDimensions: row.queryNativeDimensions,
    dimensions: row.queryDimensions,
    transformVersion: row.queryTransformVersion,
  })
  const storage = normalizeTuple({
    provider: row.storageProvider,
    model: row.storageModel,
    nativeDimensions: row.storageNativeDimensions,
    dimensions: row.storageDimensions,
    transformVersion: row.storageTransformVersion,
  })
  if (query == null || storage == null) {
    throw new ContentEmbeddingContractStateError(
      "dangling_active_pointer",
      "Active content embedding contract row is incomplete",
    )
  }

  return {
    id: row.contractId,
    query,
    storage,
  }
}

function exactNullableSql(
  leftExpression: string,
  rightExpression: string,
): Prisma.Sql {
  return Prisma.sql`(
    (${Prisma.raw(leftExpression)} IS NULL AND ${Prisma.raw(rightExpression)} IS NULL)
    OR ${Prisma.raw(leftExpression)} = ${Prisma.raw(rightExpression)}
  )`
}

/**
 * Shared transcript-vector provenance guard. Every current transcript-backed
 * read path resolves the same active contract row and compares exact
 * provider/model/native-dimension/stored-dimension/transform provenance.
 */
export function activeTranscriptContentEmbeddingWhere(input: {
  transcriptAlias: string
  chunkAlias?: string
}): Prisma.Sql {
  const transcriptAlias = input.transcriptAlias
  const chunkAlias = input.chunkAlias
  return Prisma.sql`
    AND EXISTS (
      SELECT 1
      FROM content_embedding_contract_pointer pointer
      JOIN content_embedding_contract contract
        ON contract.id = pointer.active_contract_id
      WHERE pointer.id = ${CONTENT_EMBEDDING_CONTRACT_POINTER_ID}
        AND ${Prisma.raw(`${transcriptAlias}.embedding_provider`)} = contract.storage_provider
        AND ${Prisma.raw(`${transcriptAlias}.model`)} = contract.storage_model
        AND ${Prisma.raw(`${transcriptAlias}.dimensions`)} = contract.storage_dimensions
        AND ${Prisma.raw(`${transcriptAlias}.embedding_native_dimensions`)} = contract.storage_native_dimensions
        AND ${exactNullableSql(
          `${transcriptAlias}.embedding_transform_version`,
          "contract.storage_transform_version",
        )}
        ${
          chunkAlias
            ? Prisma.sql`
                AND ${Prisma.raw(`${chunkAlias}.model`)} = contract.storage_model
                AND ${Prisma.raw(`${chunkAlias}.dimensions`)} = contract.storage_dimensions
              `
            : Prisma.empty
        }
    )
  `
}

export function activeExperienceContentEmbeddingWhere(
  experienceAlias: string,
): Prisma.Sql {
  return Prisma.sql`
    AND EXISTS (
      SELECT 1
      FROM content_embedding_contract_pointer pointer
      JOIN content_embedding_contract contract
        ON contract.id = pointer.active_contract_id
      WHERE pointer.id = ${CONTENT_EMBEDDING_CONTRACT_POINTER_ID}
        AND ${Prisma.raw(`${experienceAlias}.embedding_provider`)} = contract.storage_provider
        AND ${Prisma.raw(`${experienceAlias}.embedding_model`)} = contract.storage_model
        AND ${Prisma.raw(`${experienceAlias}.embedding_dimensions`)} = contract.storage_dimensions
        AND ${Prisma.raw(`${experienceAlias}.embedding_native_dimensions`)} = contract.storage_native_dimensions
        AND ${exactNullableSql(
          `${experienceAlias}.embedding_transform_version`,
          "contract.storage_transform_version",
        )}
    )
  `
}
