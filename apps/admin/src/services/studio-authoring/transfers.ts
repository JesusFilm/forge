import { randomBytes } from "node:crypto"
import { z } from "zod"
import type { PrismaClient } from "@prisma/client"
import { studioAssetReferenceSchema } from "@forge/studio-contracts"
import { studioAssetUploadSchema as studioUploadSchema } from "@forge/studio-contracts/assets"
import type { Principal } from "@/auth/principal"
import { studioActor } from "./state"
import { byteDigest, StudioAssetService } from "./assets"
import { ForbiddenError } from "../errors"
import { StudioCommandError } from "./errors"

export { studioAssetUploadSchema as studioUploadSchema } from "@forge/studio-contracts/assets"
const principalSchema = z.object({
  id: z.string().nullable(),
  role: z.enum([
    "ADMIN",
    "EDITOR",
    "VIEWER",
    "PUBLIC",
    "SYSTEM",
    "WORKFLOW_TRIGGER",
    "MANAGER_BACKEND",
    "VIDEO_MAPPER",
    "WEB_USER",
    "MOBILE_USER",
    "CONSUMER_BEARER",
  ]),
  studioAuthority: z.enum(["interactive", "delegated"]).optional(),
  studioClientId: z.string().optional(),
  managerRole: z.literal("OPERATOR").nullish(),
})
export class StudioTransferService {
  constructor(private readonly db: PrismaClient) {}
  async issue(user: Principal | null, kind: "read" | "upload", raw: unknown) {
    studioActor(user)
    const payload =
      kind === "read"
        ? studioAssetReferenceSchema.parse(raw)
        : studioUploadSchema.parse(raw)
    if (kind === "read")
      await new StudioAssetService(this.db).read(user, payload)
    const token = randomBytes(32).toString("hex"),
      expiresAt = new Date(Date.now() + 300000)
    const principal = principalSchema.parse({
      id: user!.id,
      role: user!.role,
      managerRole: user!.managerRole,
      studioAuthority: user!.studioAuthority,
      studioClientId: user!.studioClientId,
    })
    await this.db.studioAssetTransfer.create({
      data: {
        tokenHash: byteDigest(Buffer.from(token)),
        kind,
        principal,
        payload,
        expiresAt,
      },
    })
    return {
      path: `/api/studio/assets/transfer/${token}`,
      expiresAt: expiresAt.toISOString(),
      method: kind === "read" ? "GET" : "PUT",
    }
  }
  private async authorize(token: string, kind: string) {
    if (!/^[a-f0-9]{64}$/.test(token)) throw new ForbiddenError()
    const row = await this.db.studioAssetTransfer.findUnique({
      where: { tokenHash: byteDigest(Buffer.from(token)) },
    })
    if (!row || row.kind !== kind || row.expiresAt.getTime() <= Date.now())
      throw new ForbiddenError()
    return { ...row, principal: principalSchema.parse(row.principal) }
  }
  async download(token: string) {
    const grant = await this.authorize(token, "read"),
      assets = new StudioAssetService(this.db)
    const asset = await assets.read(grant.principal, grant.payload)
    return {
      asset,
      bytes: await assets.readBytes(grant.principal, asset.reference),
    }
  }
  async upload(token: string, body: ReadableStream<Uint8Array> | null) {
    const grant = await this.authorize(token, "upload"),
      payload = studioUploadSchema.parse(grant.payload)
    if (!body) throw new StudioCommandError("INVALID")
    const reader = body.getReader(),
      chunks: Uint8Array[] = []
    let length = 0
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        length += value.length
        if (length > payload.byteSize) throw new StudioCommandError("INVALID")
        chunks.push(value)
      }
    } catch (error) {
      await reader.cancel().catch(() => {})
      throw error
    } finally {
      reader.releaseLock()
    }
    const bytes = Buffer.concat(chunks)
    if (length !== payload.byteSize || byteDigest(bytes) !== payload.digest)
      throw new StudioCommandError("INVALID")
    return new StudioAssetService(this.db).register(
      grant.principal,
      payload.metadata,
      bytes,
    )
  }
}
