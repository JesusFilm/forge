import { z } from "zod"

export const STUDIO_INTERACTIVE_AUDIENCE = "forge-admin:studio:interactive"
export const STUDIO_INTERACTIVE_HEADER = "x-forge-studio-interactive"
export const studioRpcSchema = z
  .object({
    action: z.enum([
      "list",
      "read",
      "history",
      "create",
      "apply",
      "approve",
      "unpublish",
      "assets",
      "asset",
      "packs",
      "pack",
      "capture",
      "source",
      "eligibility",
      "sources",
      "preview-sources",
      "search",
      "asset-read",
      "asset-upload",
    ]),
    input: z.unknown(),
  })
  .strict()
export type StudioRpc = z.infer<typeof studioRpcSchema>
export type StudioAction = StudioRpc["action"]
