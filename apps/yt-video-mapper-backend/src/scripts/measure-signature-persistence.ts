import {
  Prisma,
  PrismaClient,
  type SignatureType as PrismaSignatureType,
} from "../generated/prisma/index.js"
import { isDeepStrictEqual } from "node:util"
import {
  PrismaMediaIndexRepository,
  type StoredMediaSignatureInput,
} from "../services/media-indexing.js"

const DATABASE_URL =
  process.env.MEDIA_SIGNATURE_BENCHMARK_DATABASE_URL ??
  "postgresql://vscode@127.0.0.1:55432/ytm_bulk_bench?schema=public"
const BENCHMARK_VARIANTS = 24
const SIGNATURES_PER_VARIANT = 12
const SQL_INJECTION_MARKER = "marker'); DROP TABLE mapper_media_signature; --"

async function main(): Promise<void> {
  const queryTexts: string[] = []
  const database = new PrismaClient({
    datasourceUrl: DATABASE_URL,
    log: [{ emit: "event", level: "query" }],
  })
  database.$on("query", ({ query }) => queryTexts.push(query))

  try {
    await database.$connect()
    await resetSchema(database)
    const repository = new PrismaMediaIndexRepository(database)
    const initialSignatures = benchmarkSignatures()

    queryTexts.length = 0
    const startedAt = performance.now()
    for (const signatures of byVariant(initialSignatures)) {
      await repository.upsertMediaSignatures(signatures)
    }
    const signaturePersistMs = performance.now() - startedAt
    const databaseOperations = queryTexts.length
    const parameterizedQueries = [...queryTexts]

    const initialRows = await database.mediaSignature.findMany({
      orderBy: [
        { coreId: "asc" },
        { videoVariantId: "asc" },
        { offsetMilliseconds: "asc" },
      ],
    })
    const exactRowsOk = rowsMatchInputs(initialRows, initialSignatures)
    const originalIdentity = new Map(
      initialRows.map((row) => [signatureKey(row), identityKey(row)]),
    )

    const updatedSignatures = initialSignatures.map((signature, index) => ({
      ...signature,
      durationMilliseconds: index % 3 === 0 ? null : 4_000 + index,
      signature: {
        ...signature.signature,
        revision: 2,
        nested: { variant: signature.videoVariantId, updated: true },
      },
      sourceMediaUrl: index % 4 === 0 ? null : signature.sourceMediaUrl,
      sourceMediaHash: index % 5 === 0 ? null : `sha256:updated:${index}`,
    }))
    const rerunStartedAt = performance.now()
    for (const signatures of byVariant(updatedSignatures)) {
      await repository.upsertMediaSignatures(signatures)
    }
    const rerunPersistMs = performance.now() - rerunStartedAt
    const updatedRows = await database.mediaSignature.findMany()
    const idempotentUpdateOk =
      rowsMatchInputs(updatedRows, updatedSignatures) &&
      updatedRows.every(
        (row) => originalIdentity.get(signatureKey(row)) === identityKey(row),
      )

    const duplicate = signatureInput({
      coreId: "core-duplicate",
      videoVariantId: "variant-duplicate",
      offsetMilliseconds: 0,
      signature: { kind: "visual_frame_phash_v2", phash: "first" },
    })
    await repository.upsertMediaSignatures([
      duplicate,
      {
        ...duplicate,
        durationMilliseconds: null,
        signature: { kind: "visual_frame_phash_v2", phash: "last" },
        sourceMediaUrl: null,
        sourceMediaHash: null,
      },
    ])
    const duplicateRow = await database.mediaSignature.findFirst({
      where: { coreId: "core-duplicate" },
    })
    const duplicateLastWinsOk =
      duplicateRow?.durationMilliseconds === null &&
      duplicateRow.sourceMediaUrl === null &&
      duplicateRow.sourceMediaHash === null &&
      isDeepStrictEqual(duplicateRow.signature, {
        kind: "visual_frame_phash_v2",
        phash: "last",
      })

    const atomicCoreId = "core-atomic-failure"
    let atomicWriteRejected = false
    try {
      await repository.upsertMediaSignatures([
        signatureInput({
          coreId: atomicCoreId,
          videoVariantId: "variant-atomic",
          offsetMilliseconds: 0,
        }),
        signatureInput({
          coreId: atomicCoreId,
          videoVariantId: "variant-atomic",
          offsetMilliseconds: 3_000_000_000,
        }),
      ])
    } catch {
      atomicWriteRejected = true
    }
    const atomicRows = await database.mediaSignature.count({
      where: { coreId: atomicCoreId },
    })
    const atomicFailureOk = atomicWriteRejected && atomicRows === 0
    const sqlParameterizedOk =
      parameterizedQueries.length > 0 &&
      parameterizedQueries.every(
        (query) => !query.includes(SQL_INJECTION_MARKER),
      ) &&
      initialRows.some((row) => row.sourceMediaUrl === SQL_INJECTION_MARKER)

    process.stdout.write(
      `${JSON.stringify({
        signature_persist_ms: round(signaturePersistMs),
        exact_rows_ok: Number(exactRowsOk),
        idempotent_update_ok: Number(idempotentUpdateOk),
        duplicate_last_wins_ok: Number(duplicateLastWinsOk),
        atomic_failure_ok: Number(atomicFailureOk),
        sql_parameterized_ok: Number(sqlParameterizedOk),
        variants_persisted: BENCHMARK_VARIANTS,
        signatures_persisted: initialSignatures.length,
        database_operations: databaseOperations,
        rerun_persist_ms: round(rerunPersistMs),
      })}\n`,
    )
  } finally {
    await database.$disconnect()
  }
}

async function resetSchema(database: PrismaClient): Promise<void> {
  await database.$executeRaw(
    Prisma.sql`DROP TABLE IF EXISTS "mapper_media_signature"`,
  )
  await database.$executeRaw(Prisma.sql`DROP TYPE IF EXISTS "signature_type"`)
  await database.$executeRaw(
    Prisma.sql`CREATE TYPE "signature_type" AS ENUM ('visual_frame', 'audio_fingerprint', 'text_segment', 'structural_hint')`,
  )
  await database.$executeRaw(Prisma.sql`
    CREATE TABLE "mapper_media_signature" (
      "id" TEXT NOT NULL,
      "core_id" TEXT NOT NULL,
      "video_variant_id" TEXT NOT NULL,
      "signature_type" "signature_type" NOT NULL,
      "algorithm_version" TEXT NOT NULL,
      "offset_milliseconds" INTEGER NOT NULL DEFAULT 0,
      "duration_milliseconds" INTEGER,
      "signature" JSONB NOT NULL,
      "source_media_url" TEXT,
      "source_media_hash" TEXT,
      "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "mapper_media_signature_pkey" PRIMARY KEY ("id")
    )
  `)
  await database.$executeRaw(Prisma.sql`
    CREATE UNIQUE INDEX "mapper_media_signature_variant_signature_key"
    ON "mapper_media_signature"(
      "core_id",
      "video_variant_id",
      "signature_type",
      "algorithm_version",
      "offset_milliseconds"
    )
  `)
}

function benchmarkSignatures(): StoredMediaSignatureInput[] {
  return Array.from({ length: BENCHMARK_VARIANTS }, (_, variantIndex) =>
    Array.from({ length: SIGNATURES_PER_VARIANT }, (_, signatureIndex) => {
      const globalIndex = variantIndex * SIGNATURES_PER_VARIANT + signatureIndex
      return signatureInput({
        coreId: `core-${String(variantIndex).padStart(3, "0")}`,
        videoVariantId: `variant-${String(variantIndex).padStart(3, "0")}`,
        signatureType: signatureType(globalIndex),
        offsetMilliseconds: signatureIndex * 10_000,
        durationMilliseconds: globalIndex % 2 === 0 ? null : 5_000,
        signature: {
          kind: `benchmark_${signatureType(globalIndex).toLowerCase()}`,
          sequence: globalIndex,
          nested: { variant: variantIndex, signature: signatureIndex },
        },
        sourceMediaUrl:
          globalIndex === 0
            ? SQL_INJECTION_MARKER
            : `https://media.example.com/${variantIndex}.mp4`,
        sourceMediaHash:
          globalIndex % 3 === 0 ? null : `sha256:initial:${globalIndex}`,
      })
    }),
  ).flat()
}

function signatureInput(
  overrides: Partial<StoredMediaSignatureInput>,
): StoredMediaSignatureInput {
  return {
    coreId: "core-default",
    videoVariantId: "variant-default",
    signatureType: "VISUAL_FRAME",
    algorithmVersion: "official-media-signature-v3",
    offsetMilliseconds: 0,
    durationMilliseconds: 5_000,
    signature: { kind: "visual_frame_phash_v2", phash: "0000000000000000" },
    sourceMediaUrl: "https://media.example.com/default.mp4",
    sourceMediaHash: "sha256:default",
    ...overrides,
  }
}

function signatureType(
  index: number,
): StoredMediaSignatureInput["signatureType"] {
  const types: StoredMediaSignatureInput["signatureType"][] = [
    "VISUAL_FRAME",
    "AUDIO_FINGERPRINT",
    "TEXT_SEGMENT",
    "STRUCTURAL_HINT",
  ]
  return types[index % types.length]!
}

function byVariant(
  signatures: StoredMediaSignatureInput[],
): StoredMediaSignatureInput[][] {
  const variants = new Map<string, StoredMediaSignatureInput[]>()
  for (const signature of signatures) {
    const key = `${signature.coreId}\u0000${signature.videoVariantId}`
    const rows = variants.get(key) ?? []
    rows.push(signature)
    variants.set(key, rows)
  }
  return [...variants.values()]
}

function rowsMatchInputs(
  rows: Array<{
    coreId: string
    videoVariantId: string
    signatureType: PrismaSignatureType
    algorithmVersion: string
    offsetMilliseconds: number
    durationMilliseconds: number | null
    signature: unknown
    sourceMediaUrl: string | null
    sourceMediaHash: string | null
  }>,
  inputs: StoredMediaSignatureInput[],
): boolean {
  if (rows.length !== inputs.length) return false
  const expected = new Map(inputs.map((input) => [signatureKey(input), input]))

  return rows.every((row) => {
    const input = expected.get(signatureKey(row))
    return (
      input != null &&
      row.durationMilliseconds === input.durationMilliseconds &&
      isDeepStrictEqual(row.signature, input.signature) &&
      row.sourceMediaUrl === input.sourceMediaUrl &&
      row.sourceMediaHash === input.sourceMediaHash
    )
  })
}

function signatureKey(input: {
  coreId: string
  videoVariantId: string
  signatureType: string
  algorithmVersion: string
  offsetMilliseconds: number
}): string {
  return JSON.stringify([
    input.coreId,
    input.videoVariantId,
    input.signatureType,
    input.algorithmVersion,
    input.offsetMilliseconds,
  ])
}

function identityKey(input: { id: string; createdAt: Date }): string {
  return `${input.id}:${input.createdAt.toISOString()}`
}

function round(value: number): number {
  return Math.round(value * 100) / 100
}

await main()
