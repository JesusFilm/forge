import { StudioProductionError } from "@/services/studio-production/errors"
import { createHash } from "node:crypto"
import { z } from "zod"
import { env } from "@/config/env"
import {
  studioAssetVersionSchema,
  studioRegisterAssetSchema,
} from "@forge/studio-contracts/assets"
import { readStudioBytes, type StudioCaller } from "@forge/studio-server"
import { studioServiceCall } from "@/services/studio-agent/transport"
/** Dedicated server capability; never expose this caller or its signed assertions to browser/MCP/model. */
export function studioProductionClient(userId: string, runId: string) {
  const caller: StudioCaller = {
    sub: userId,
    authority: "delegated",
    clientId: "studio-production",
    scopes: ["studio:production:execute"],
  }
  const call = (command: string, input: unknown) =>
    studioServiceCall("admin", caller, {
      action: "production",
      runId,
      command,
      input,
    })
  return {
    call,
    async upload(
      raw: z.input<typeof studioRegisterAssetSchema>,
      bytes: Buffer,
    ) {
      const metadata = studioRegisterAssetSchema.parse(raw)
      const capability = z.object({ path: z.string() }).parse(
        await call("upload", {
          metadata,
          byteSize: bytes.length,
          digest: createHash("sha256").update(bytes).digest("hex"),
        }),
      )
      if (
        !/^\/api\/studio\/assets\/transfer\/[a-f0-9]{64}$/.test(
          capability.path,
        ) ||
        !env.ADMIN_GRAPHQL_URL
      )
        throw new StudioProductionError("Invalid Studio transfer capability")
      const response = await fetch(
        new URL(capability.path, env.ADMIN_GRAPHQL_URL),
        {
          method: "PUT",
          body: new Uint8Array(bytes),
          redirect: "error",
          signal: AbortSignal.timeout(30000),
        },
      )
      if (!response.ok)
        throw new StudioProductionError(
          "Generated asset retention failed; inspect before replay",
        )
      return studioAssetVersionSchema.parse(
        JSON.parse(await readStudioBytes(response)),
      )
    },
  }
}
