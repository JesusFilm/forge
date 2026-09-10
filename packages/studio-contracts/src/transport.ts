import { z } from "zod"

export const STUDIO_INTERACTIVE_AUDIENCE = "forge-admin:shorts:interactive"
export const STUDIO_INTERACTIVE_HEADER = "x-forge-shorts-interactive"
export const studioRpcSchema = z
  .object({
    action: z.enum([
      "render-state",
      "publication-candidate",
      "render-cancel",
      "publish",
      "calendar-production",
      "calendar-read",
      "calendar-configure",
      "calendar-edit-slot",
      "calendar-assign-week",
      "calendar-plan-admit",
      "calendar-authorize",
      "calendar-cancel",
      "narration-plan",
      "request",
      "attempts",
      "production-admit",
      "production-read",
      "production-list",
      "production-cancel",
      "experiment-request",
      "experiment-read",
      "experiment-select",
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
      "source-preview",
      "eligibility",
      "sources",
      "preview-sources",
      "search",
      "asset-read",
      "asset-upload",
      "validate-proposal",
      "generation-read",
    ]),
    input: z.unknown(),
  })
  .strict()
export type StudioRpc = z.infer<typeof studioRpcSchema>
export type StudioAction = StudioRpc["action"]
