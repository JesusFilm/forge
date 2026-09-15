import { z } from "zod"
import type { PrismaClient } from "@prisma/client"
import { studioIdSchema, studioListSchema } from "@forge/studio-contracts"
import {
  contentPackDocumentSchema,
  writeContentPackSchema,
} from "@forge/studio-contracts/content-packs"
import type { Principal } from "@/auth/principal"
import { NotFoundError } from "../errors"
import { studioActor, studioHash } from "./state"
import { StudioCommandError } from "./errors"
import { studioSourceSnapshotSchema } from "@forge/studio-contracts/sources"
import { assertStudioSourceEligible } from "./sources"
import type { Prisma } from "@prisma/client"

export async function resolveStudioPackSources(
  tx: Prisma.TransactionClient,
  revisionIds: readonly string[],
) {
  const result = []
  for (const id of revisionIds) {
    const row = await tx.contentPackRevision.findUnique({ where: { id } })
    if (!row) throw new NotFoundError("ContentPackRevision")
    const document = contentPackDocumentSchema.parse(row.document)
    const sources = []
    for (const evidence of document.sources) {
      if (!evidence.sourceSnapshotId) continue
      const source = await tx.shortSourceSnapshot.findUnique({
        where: { id: evidence.sourceSnapshotId },
      })
      if (!source) throw new NotFoundError("ShortSourceSnapshot")
      const snapshot = studioSourceSnapshotSchema.parse(source.snapshot)
      sources.push({
        snapshot,
        eligibility: await assertStudioSourceEligible(tx, snapshot),
        excerpt: evidence.excerpt,
      })
    }
    result.push({
      revisionId: row.id,
      packId: row.packId,
      number: row.number,
      document,
      sources,
    })
  }
  return result
}

export class ContentPackService {
  constructor(private readonly db: PrismaClient) {}
  async write(user: Principal | null, raw: unknown) {
    const actor = studioActor(user)
    const input = writeContentPackSchema.parse(raw)
    const hash = studioHash({ actor, input })
    return this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${input.packId}, 455))::text`
      const prior = await tx.contentPackRevision.findUnique({
        where: {
          packId_idempotencyKey: {
            packId: input.packId,
            idempotencyKey: input.idempotencyKey,
          },
        },
      })
      if (prior) {
        if (prior.inputHash !== hash) throw new StudioCommandError("CONFLICT")
        return prior
      }
      const pack = await tx.contentPack.findUnique({
        where: { id: input.packId },
      })
      if ((pack?.currentRevision ?? 0) !== input.expectedRevision)
        throw new StudioCommandError("CONFLICT")
      const number = input.expectedRevision + 1
      if (!pack)
        await tx.contentPack.create({
          data: { id: input.packId, currentRevision: number },
        })
      const revision = await tx.contentPackRevision.create({
        data: {
          packId: input.packId,
          number,
          document: input.document,
          actor,
          idempotencyKey: input.idempotencyKey,
          inputHash: hash,
        },
      })
      if (pack)
        await tx.contentPack.update({
          where: { id: pack.id },
          data: { currentRevision: number },
        })
      return revision
    })
  }
  async read(user: Principal | null, revisionId: string) {
    studioActor(user)
    const row = await this.db.contentPackRevision.findUnique({
      where: { id: studioIdSchema.parse(revisionId) },
    })
    if (!row) throw new NotFoundError("ContentPackRevision")
    return { ...row, document: contentPackDocumentSchema.parse(row.document) }
  }
  async list(user: Principal | null, raw: unknown = {}) {
    studioActor(user)
    const input = studioListSchema
      .extend({ search: z.string().min(1).max(200).optional() })
      .parse(raw)
    const packs = await this.db.contentPack.findMany({
      where: {
        id: input.cursor ? { gt: input.cursor } : undefined,
        revisions: input.search
          ? {
              some: {
                document: { path: ["title"], string_contains: input.search },
              },
            }
          : undefined,
      },
      orderBy: { id: "asc" },
      take: input.limit,
      include: { revisions: { orderBy: { number: "desc" }, take: 1 } },
    })
    return packs.flatMap((p) => p.revisions)
  }
}
