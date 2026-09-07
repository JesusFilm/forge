import { createHash } from "node:crypto"
import { z } from "zod"
import { createTool } from "@mastra/core/tools"
import { readStudioBytes, StudioBoundaryError } from "@forge/studio-server"
import { studioCaptureSourceSchema } from "@forge/studio-contracts/sources"
import { studioAssetReferenceSchema } from "@forge/studio-contracts"
export function studioAssetTools(
  call: (action: string, input: unknown) => Promise<unknown>,
) {
  return {
    discoverAssets: createTool({
      id: "discoverAssets",
      description: "Discover shared assets. Returned references are immutable.",
      inputSchema: z.object({ search: z.string().max(200).optional() }),
      execute: async (input) => call("assets", input),
    }),
    discoverPacks: createTool({
      id: "discoverPacks",
      description: "Discover Content Packs.",
      inputSchema: z.object({ search: z.string().max(200).optional() }),
      execute: async (input) => call("packs", input),
    }),
    readPack: createTool({
      id: "readPack",
      description:
        "Read immutable source evidence and separate editorial guidance.",
      inputSchema: z.object({ id: z.string() }),
      execute: async (input) => call("pack", input.id),
    }),
    searchSources: createTool({
      id: "searchSources",
      description:
        "Find exact-language source identities for capture; never invent IDs.",
      inputSchema: z.object({
        search: z.string().max(200),
        language: z.string(),
      }),
      execute: async (input) => call("search", input),
    }),
    captureSource: createTool({
      id: "captureSource",
      description:
        "Retain canonical source selection and subtitles for a proposal. Does not render or apply project edits.",
      inputSchema: studioCaptureSourceSchema,
      execute: async (input) => call("capture", input),
    }),
    registerComponent: createTool({
      id: "registerComponent",
      description:
        "Register generated TSX as an immutable component asset. Then propose a component declaration and item using returned reference. Code executes only in the isolated preview; allowed imports are react and remotion.",
      inputSchema: z.object({ source: z.string().min(1).max(131072) }).strict(),
      execute: async ({ source }) => {
        const bytes = Buffer.from(source),
          digest = createHash("sha256").update(bytes).digest("hex")
        const capability = z.object({ url: z.string().url() }).parse(
          await call("asset-upload", {
            metadata: {
              idempotencyKey: crypto.randomUUID(),
              filename: "studio-component.tsx",
              mimeType: "text/plain",
              role: "component",
              provenance: {
                status: "recorded",
                recorded: { creator: "studio-hosted", digest },
              },
            },
            digest,
            byteSize: bytes.length,
          }),
        )
        // The trusted Admin returns this short-lived capability; never return it to the model.
        const response = await fetch(capability.url, {
          method: "PUT",
          body: bytes,
          redirect: "error",
          signal: AbortSignal.timeout(15000),
        })
        if (!response.ok)
          throw new StudioBoundaryError("Component registration failed")
        const result: unknown = JSON.parse(await readStudioBytes(response))
        return result
      },
    }),
    readAsset: createTool({
      id: "readAsset",
      description: "Read asset metadata for an exact reference.",
      inputSchema: studioAssetReferenceSchema,
      execute: async (input) => call("asset", input),
    }),
  }
}
