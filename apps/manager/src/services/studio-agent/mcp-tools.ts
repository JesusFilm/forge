import { studioInspectionRequestSchema } from "@forge/studio-contracts/inspection"
import {
  studioDraftRenderRequestSchema,
  studioDraftRenderIdentitySchema,
} from "@forge/studio-contracts/render"
import { studioAssetReferenceSchema } from "@forge/studio-contracts"
import { studioAssetUploadSchema } from "@forge/studio-contracts/assets"
import {
  studioCaptureSourceSchema,
  studioSourcePreviewSchema,
} from "@forge/studio-contracts/sources"
import { z } from "zod"
import {
  studioCommandBaseSchema,
  studioApplySchema,
  studioCreateSchema,
  studioIdSchema,
  studioListSchema,
} from "@forge/studio-contracts"
import { studioChatSchema } from "@forge/studio-contracts/agent"
export const STUDIO_MCP_TOOLS = [
  {
    name: "shorts.inspect",
    description:
      "Inspect bounded sampled images and measured audio statistics from the exact rendered output. Reuses immutable evidence, never rerenders or approves. Report actual supported modalities, unknowns and sampled coverage; at most one automatic repair per handoff. Human approval remains separate.",
    scope: "shorts:read",
    action: "inspect",
    schema: studioInspectionRequestSchema,
  },
  {
    name: "shorts.narrationQuote",
    description:
      "Inspect effective narration, reusable recordings, verified price or pricing-unavailable state. This is not human script approval.",
    scope: "shorts:read",
    action: "narration-quote",
    schema: z
      .object({
        projectId: studioIdSchema,
        expectedRevision: z.number().int().positive(),
      })
      .strict(),
  },
  {
    name: "shorts.narrate",
    description:
      "Requires shorts:read and shorts:narration. Generate and attach draft narration with approved existing voices. One initial multi-item pass and one correction per project; unchanged audio is reused. Retry the same key to resume; ambiguous calls require reconciliation. Provider charges apply. Never approves script or publication.",
    scope: "shorts:narration",
    action: "narration-admit",
    schema: studioCommandBaseSchema.strict(),
  },
  {
    name: "shorts.narrationStatus",
    description:
      "Read durable project narration allowance, accepted runs, retained output and reconciliation state.",
    scope: "shorts:read",
    action: "narration-status",
    schema: z.object({ projectId: studioIdSchema }).strict(),
  },
  {
    name: "shorts.renderRequest",
    description:
      "Admit a durable private render of the exact current revision. Reuse the same idempotency key after a lost response. Does not approve or publish; rendering uses infrastructure with unknown cost.",
    scope: "shorts:render",
    action: "render-request",
    schema: studioDraftRenderRequestSchema,
  },
  {
    name: "shorts.renderStatus",
    description:
      "Read an exact render attempt across reconnects. Stale output remains evidence but cannot approve a newer revision. Poll no faster than pollAfterMs.",
    scope: "shorts:read",
    action: "render-status",
    schema: studioDraftRenderIdentitySchema,
  },
  {
    name: "shorts.renderRead",
    description:
      "Refresh five-minute access to the exact rendered output. Never log or persist bearer URLs. No approval or publication authority.",
    scope: "shorts:read",
    action: "render-read",
    schema: studioDraftRenderIdentitySchema,
  },
  {
    name: "shorts.projects",
    description:
      "Discover a bounded page of accessible projects. Continue with nextCursor until null.",
    scope: "shorts:read",
    action: "list",
    schema: studioListSchema,
  },
  {
    name: "shorts.resolveProject",
    description:
      "Resolve a same-environment Studio project link and read its current attributed state. Does not fetch arbitrary URLs.",
    scope: "shorts:read",
    action: "resolve-project",
    schema: z.object({ url: z.string().url().max(2048) }).strict(),
  },
  {
    name: "shorts.sourcePreview",
    description:
      "Read a bounded page of exact-language retained canonical subtitle cues. Follow nextOffset until null for complete range coverage.",
    scope: "shorts:read",
    action: "source-preview",
    schema: studioSourcePreviewSchema,
  },
  {
    name: "shorts.assets",
    description: "Discover shared assets and immutable versions.",
    scope: "shorts:read",
    action: "assets",
    schema: z
      .object({
        search: z.string().max(200).optional(),
        limit: z.number().int().min(1).max(100).optional(),
      })
      .strict(),
  },
  {
    name: "shorts.asset",
    description: "Read asset metadata by exact immutable reference.",
    scope: "shorts:read",
    action: "asset",
    schema: studioAssetReferenceSchema,
  },
  {
    name: "shorts.packs",
    description: "Discover reusable Content Packs.",
    scope: "shorts:read",
    action: "packs",
    schema: z.object({ search: z.string().max(200).optional() }).strict(),
  },
  {
    name: "shorts.pack",
    description:
      "Read immutable Content Pack evidence and separate editorial guidance.",
    scope: "shorts:read",
    action: "pack",
    schema: z.object({ id: studioIdSchema }).strict(),
  },
  {
    name: "shorts.search",
    description:
      "Find exact-language video/dub/edition, subtitle and download identities for source capture.",
    scope: "shorts:read",
    action: "search",
    schema: z
      .object({ search: z.string().max(200), language: studioIdSchema })
      .strict(),
  },
  {
    name: "shorts.capture",
    description:
      "Capture canonical source and subtitle identity, never a caller URL or replacement transcription. Media materialization remains a trusted broker step.",
    scope: "shorts:edit",
    action: "capture",
    schema: studioCaptureSourceSchema,
  },
  {
    name: "shorts.source",
    description: "Read canonical source snapshot.",
    scope: "shorts:read",
    action: "source",
    schema: z.object({ id: studioIdSchema }).strict(),
  },
  {
    name: "shorts.assetRead",
    description:
      "Issue a five-minute scoped byte-read capability. Do not log or persist its URL.",
    scope: "shorts:read",
    action: "asset-read",
    schema: studioAssetReferenceSchema,
  },
  {
    name: "shorts.assetUpload",
    description:
      "Issue a five-minute digest/size-bound PUT capability for a component or other asset. Upload bytes to receive the durable reference; add declarations/items with shorts.apply. Never trust generated code as codec proof.",
    scope: "shorts:edit",
    action: "asset-upload",
    schema: studioAssetUploadSchema,
  },
  {
    name: "shorts.read",
    description: "Read a Shorts project revision and attributed state.",
    scope: "shorts:read",
    action: "read",
    schema: z.object({ projectId: studioIdSchema }).strict(),
  },
  {
    name: "shorts.history",
    description: "Read attributed revision history for undo/reconciliation.",
    scope: "shorts:read",
    action: "history",
    schema: z
      .object({
        projectId: studioIdSchema,
        beforeRevision: z.number().int().positive().optional(),
      })
      .strict(),
  },
  {
    name: "shorts.apply",
    description:
      "Apply revision-checked draft operations. Never reviews, publishes or activates instructions.",
    scope: "shorts:edit",
    action: "apply",
    schema: studioApplySchema,
  },
  {
    name: "shorts.create",
    description: "Create a standalone draft project.",
    scope: "shorts:edit",
    action: "create",
    schema: studioCreateSchema,
  },
  {
    name: "shorts.instructions",
    description:
      "Inspect native Shorts guidance and version identities without activation authority.",
    scope: "shorts:instructions:read",
    action: "instructions",
    schema: z.object({}).strict(),
  },
  {
    name: "shorts.chat",
    description:
      "Run the hosted Shorts agent and return its streamed diagnostics and proposed changes. Apply proposals separately; narration and publication are unavailable.",
    scope: "shorts:chat",
    action: "chat",
    schema: studioChatSchema,
  },
] as const
