import { z } from "zod"
import { createHash, randomUUID } from "node:crypto"
import { Prisma, type PrismaClient } from "@prisma/client"
import {
  studioAssetReferenceSchema,
  studioListSchema,
  studioSpeechSchema,
  studioIdSchema,
  type StudioAssetReference,
} from "@forge/studio-contracts"
import {
  STUDIO_MAX_ASSET_BYTES,
  studioRegisterAssetSchema,
  studioAssetRoleSchema,
  studioAssetVersionSchema,
  studioNarrationIdentitySchema,
} from "@forge/studio-contracts/assets"
import type { Principal } from "@/auth/principal"
import {
  readMediaObject,
  writeMediaObject,
  safeMediaFilename,
  defaultBackend,
  type MediaStorageBackend,
} from "@/storage/media"
import { MediaAssetService } from "../media-asset.service"
import { NotFoundError } from "../errors"
import { studioActor, studioHash } from "./state"
import { StudioCommandError } from "./errors"

export { STUDIO_MAX_ASSET_BYTES } from "@forge/studio-contracts/assets"
export const byteDigest = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex")

export async function resolveAssetVersion(
  db: Prisma.TransactionClient,
  reference: StudioAssetReference,
) {
  const row = await db.shortAssetVersion.findFirst({
    where: {
      id: reference.versionId,
      assetId: reference.assetId,
      digest: reference.digest,
    },
    include: { mediaAsset: true },
  })
  if (
    !row ||
    row.mediaAsset.status !== "READY" ||
    row.mediaAsset.checksumSha256 !== reference.digest
  )
    throw new NotFoundError("Verified Studio asset version")
  return row
}

/** Internal canonical resolver: callers establish project/service authority first. */
export async function readVerifiedStudioAsset(
  db: Prisma.TransactionClient,
  ref: StudioAssetReference,
  maxBytes = STUDIO_MAX_ASSET_BYTES,
) {
  const row = await resolveAssetVersion(db, ref)
  if (!row.mediaAsset.objectKey) throw new NotFoundError("Studio bytes")
  if (Number(row.mediaAsset.byteSize) > maxBytes)
    throw new StudioCommandError("INVALID")
  const bytes = await readMediaObject({
    key: row.mediaAsset.objectKey,
    backend: row.mediaAsset.backend,
  })
  if (bytes.byteLength > maxBytes || byteDigest(bytes) !== ref.digest)
    throw new StudioCommandError("INVALID")
  return bytes
}

function present(row: Awaited<ReturnType<typeof resolveAssetVersion>>) {
  const metadata = studioRegisterAssetSchema.parse(row.metadata)
  return studioAssetVersionSchema.parse({
    reference: { assetId: row.assetId, versionId: row.id, digest: row.digest },
    mediaAssetId: row.mediaAssetId,
    filename: row.mediaAsset.originalFilename,
    mimeType: row.mediaAsset.mimeType,
    byteSize: Number(row.mediaAsset.byteSize),
    role: row.role,
    provenance: metadata.provenance,
    narration: metadata.narration ?? null,
    voice: metadata.voice ?? null,
    actor: row.actor,
  })
}

export class StudioAssetService {
  constructor(private readonly db: PrismaClient) {}
  async register(
    user: Principal | null,
    raw: unknown,
    bytes: Uint8Array,
    backend: MediaStorageBackend = defaultBackend(),
  ) {
    const actor = studioActor(user)
    const input = studioRegisterAssetSchema.parse(raw)
    if (
      !bytes.byteLength ||
      bytes.byteLength > STUDIO_MAX_ASSET_BYTES ||
      backend === "MUX"
    )
      throw new StudioCommandError("INVALID")
    const digest = byteDigest(bytes)
    const requestKey = studioHash({ actor, key: input.idempotencyKey })
    const requestHash = studioHash({ input, digest })
    // Byte writes use fresh IDs, never a caller-controlled historical object key.
    // A losing concurrent retry can leave retained unregistered bytes; it cannot replace bytes.
    const prior = await this.db.shortAssetVersion.findUnique({
      where: { requestKey },
      include: { mediaAsset: true },
    })
    if (prior) {
      if (prior.requestHash !== requestHash)
        throw new StudioCommandError("CONFLICT")
      return present(prior)
    }
    for (const pronunciation of [
      input.narration?.pronunciation,
      input.voice?.pronunciation,
    ]) {
      if (
        pronunciation &&
        (await resolveAssetVersion(this.db, pronunciation)).role !==
          "pronunciation"
      )
        throw new StudioCommandError("INVALID")
    }
    if (input.replaces) await resolveAssetVersion(this.db, input.replaces)
    const storageId = randomUUID()
    const objectKey = await writeMediaObject({
      assetId: storageId,
      filename: safeMediaFilename(input.filename),
      body: bytes,
      contentType: input.mimeType,
      backend,
    })
    if (
      byteDigest(await readMediaObject({ key: objectKey, backend })) !== digest
    )
      throw new StudioCommandError("INVALID")
    return this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${requestKey}, 455))::text`
      const retry = await tx.shortAssetVersion.findUnique({
        where: { requestKey },
        include: { mediaAsset: true },
      })
      if (retry) {
        if (retry.requestHash !== requestHash)
          throw new StudioCommandError("CONFLICT")
        return present(retry)
      }
      // Normal MediaAsset registration is the only blob registry. Studio authority
      // has already been checked; this internal principal never crosses transport.
      const media = await new MediaAssetService(tx as PrismaClient).create({
        user: { role: "ADMIN", id: null },
        input: {
          kind: input.mimeType.startsWith("image/")
            ? "IMAGE"
            : input.mimeType.startsWith("video/")
              ? "VIDEO"
              : "FILE",
          backend,
          status: "READY",
          visibility: "PRIVATE",
          mimeType: input.mimeType,
          objectKey,
          originalFilename: input.filename,
          byteSize: bytes.byteLength,
          checksumSha256: digest,
        },
      })
      const row = await tx.shortAssetVersion.create({
        data: {
          assetId: input.replaces?.assetId ?? randomUUID(),
          mediaAssetId: media.id,
          digest,
          role: input.role,
          metadata: input as Prisma.InputJsonValue,
          actor,
          requestKey,
          requestHash,
        },
        include: { mediaAsset: true },
      })
      return present(row)
    })
  }
  async read(user: Principal | null, raw: unknown) {
    studioActor(user)
    return present(
      await resolveAssetVersion(this.db, studioAssetReferenceSchema.parse(raw)),
    )
  }
  async readBytes(user: Principal | null, raw: unknown) {
    studioActor(user)
    return readVerifiedStudioAsset(
      this.db,
      studioAssetReferenceSchema.parse(raw),
    )
  }

  async list(user: Principal | null, raw: unknown = {}) {
    studioActor(user)
    const input = studioListSchema
      .extend({
        role: studioAssetRoleSchema.optional(),
        search: z.string().min(1).max(200).optional(),
      })
      .parse(raw)
    return (
      await this.db.shortAssetVersion.findMany({
        where: {
          id: input.cursor ? { gt: input.cursor } : undefined,
          role: input.role,
          mediaAsset: input.search
            ? {
                originalFilename: {
                  contains: input.search,
                  mode: "insensitive",
                },
              }
            : undefined,
        },
        orderBy: { id: "asc" },
        take: input.limit,
        include: { mediaAsset: true },
      })
    ).map(present)
  }
  async narrationIdentity(
    user: Principal | null,
    language: string,
    rawSpeech: unknown,
  ) {
    studioActor(user)
    const speech = studioSpeechSchema.parse(rawSpeech)
    const preset = await this.read(user, speech.voice)
    if (
      !preset.voice ||
      preset.role !== "voice" ||
      preset.provenance.recorded.registrationStatus === "preview" ||
      preset.voice.language !== language ||
      preset.voice.provider !== speech.provider ||
      preset.voice.model !== speech.model
    )
      throw new StudioCommandError("INVALID")
    if (
      speech.pronunciation &&
      (await this.read(user, speech.pronunciation)).role !== "pronunciation"
    )
      throw new StudioCommandError("INVALID")
    return studioNarrationIdentitySchema.parse({
      text: speech.text,
      role: speech.role,
      language: studioIdSchema.parse(language),
      provider: speech.provider,
      model: speech.model,
      voiceId: preset.voice.voiceId,
      settings: speech.settings,
      pronunciation: speech.pronunciation,
    })
  }
  async findNarration(user: Principal | null, raw: unknown) {
    studioActor(user)
    const identity = studioNarrationIdentitySchema.parse(raw)
    const rows = await this.db.shortAssetVersion.findMany({
      where: {
        role: "narration",
        metadata: { path: ["narration"], equals: identity },
      },
      include: { mediaAsset: true },
      take: 100,
      orderBy: { id: "asc" },
    })
    return rows.map(present)
  }
}
