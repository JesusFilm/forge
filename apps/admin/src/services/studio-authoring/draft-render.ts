import type { PrismaClient } from "@prisma/client"
import type { Principal } from "@/auth/principal"
import { studioAttemptResultSchema } from "@forge/studio-contracts"
import { studioCatalogRenderManifestSchema } from "@forge/studio-contracts/catalog"
import {
  studioDraftRenderIdentitySchema,
  studioDraftRenderRequestSchema,
} from "@forge/studio-contracts/render"
import { StudioAuthoringService } from "./index"
import { StudioAssetService } from "./assets"
import { StudioTransferService } from "./transfers"
import { StudioCommandError } from "./errors"
import { studioHash } from "./state"
import { NotFoundError } from "../errors"

/** Draft admission retains the delegated actor. The durable worker scan owns
 * enqueueing, canonical source preparation, execution and recovery after disconnect. */
export class StudioDraftRenderService {
  constructor(private readonly db: PrismaClient) {}
  async request(user: Principal, raw: unknown) {
    const input = studioDraftRenderRequestSchema.parse(raw)
    return new StudioAuthoringService(this.db).request(
      user,
      {
        ...input,
        kind: "RENDER",
        instructions: [],
      },
      { deferSourceMaterialization: true },
    )
  }
  async status(user: Principal, raw: unknown) {
    const input = studioDraftRenderIdentitySchema.parse(raw)
    const commands = new StudioAuthoringService(this.db)
    const project = await commands.read(user, input.projectId)
    const attempt = await commands.readAttempt(
      user,
      input.projectId,
      input.attemptId,
    )
    if (attempt.kind !== "RENDER") throw new NotFoundError("ShortRenderAttempt")
    const job = await this.db.shortRenderJob.findUnique({
      where: { attemptId: attempt.id },
      select: { state: true },
    })
    const result = attempt.result
      ? studioAttemptResultSchema.parse(attempt.result)
      : null
    let output = null
    if (result?.manifest && ["SUCCEEDED", "STALE"].includes(attempt.status)) {
      const assets = new StudioAssetService(this.db)
      const asset = await assets.read(user, result.manifest)
      if (asset.role !== "manifest" || asset.byteSize > 32768)
        throw new StudioCommandError("INVALID")
      const manifest = studioCatalogRenderManifestSchema.parse(
        JSON.parse(
          Buffer.from(await assets.readBytes(user, result.manifest)).toString(
            "utf8",
          ),
        ),
      )
      if (
        manifest.projectId !== input.projectId ||
        manifest.revision !== attempt.baseRevision ||
        manifest.renderAttemptId !== attempt.id ||
        manifest.inputHash !== attempt.inputHash ||
        manifest.verification.outputDigest !== manifest.output.digest ||
        !result.assets.some(
          (ref) => studioHash(ref) === studioHash(manifest.output),
        )
      )
        throw new StudioCommandError("INVALID")
      const media = await assets.read(user, manifest.output)
      if (media.role !== "render" || media.mimeType !== "video/mp4")
        throw new StudioCommandError("INVALID")
      output = manifest.output
    }
    return {
      projectId: input.projectId,
      revision: attempt.baseRevision,
      attemptId: attempt.id,
      inputHash: attempt.inputHash,
      status: attempt.status,
      stale:
        project.revision !== attempt.baseRevision || attempt.status === "STALE",
      currentRevision: project.revision,
      jobState: job?.state ?? "PENDING_ENQUEUE",
      output,
      manifest: result?.manifest ?? null,
      diagnostic: result?.diagnostic ?? null,
      costMicros: result?.costMicros ?? null,
      pollAfterMs: ["QUEUED", "RUNNING"].includes(attempt.status) ? 2000 : null,
    }
  }
  async read(user: Principal, raw: unknown) {
    const status = await this.status(user, raw)
    if (!status.output) throw new StudioCommandError("UNREADY")
    const access = await new StudioTransferService(this.db).issue(
      user,
      "read",
      status.output,
    )
    return { ...status, access }
  }
}
