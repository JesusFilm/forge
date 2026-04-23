import type {
  SharedAgentCategory,
  SharedAgentDefinition,
  SharedAgentDraftPatch,
  SharedAgentField,
  SharedAgentRunInput,
  SharedAgentStructuredResult,
} from "@forge/agents"
import {
  sharedAgentRunInputSchema,
  sharedAgentStructuredResultSchema,
} from "@forge/agents"
import { z } from "zod"

export type SharedAgentCatalogItem = {
  id: string
  name: string
  summary: string
  category: SharedAgentCategory
  starterPrompt: string
  description: string
  fields: readonly SharedAgentField[]
  capabilities: {
    supportsSessions: boolean
    supportsWriteback: boolean
    supportsVideoContext: boolean
  }
}

export type SharedAgentUsage = {
  promptTokens: number
  completionTokens: number
  totalTokens: number
}

export type SharedAgentSessionOwner = {
  actorId: string
  kind: "session" | "api_key" | "compatibility"
  label: string
}

export type SharedAgentWorkflowId =
  | "translateVideoMetadataWorkflow"
  | "improveVideoSeoWorkflow"
  | "sharedVideoAdvisoryWorkflow"

export type SharedAgentToolEvent = {
  id: string
  name:
    | "searchLibraryVideos"
    | "readVideoContext"
    | "readSceneSignals"
    | "readExistingMetadataArtifacts"
    | "saveDraftRecommendation"
    | "applyVideoMetadataPatch"
    | "enqueueEnrichmentOrFollowup"
  status: "completed" | "pending_approval" | "approved" | "declined"
  summary: string
  createdAt: string
}

export type SharedAgentApprovalActionType =
  | "apply_video_metadata_patch"
  | "enqueue_followup"

export type SharedAgentPendingApproval = {
  id: string
  sessionId: string
  runId: string | null
  traceId: string | null
  agentId: string
  owner: SharedAgentSessionOwner
  actionType: SharedAgentApprovalActionType
  target: {
    videoDocumentId: string
    videoCoreId: string | null
  }
  patchSummary: string
  actor: string | null
  status: "pending" | "approved" | "declined"
  createdAt: string
  resolvedAt: string | null
  draftPatch: SharedAgentDraftPatch | null
}

export type SharedAgentRunResponse = {
  sessionId?: string
  agent: SharedAgentCatalogItem
  output: string
  result: SharedAgentStructuredResult
  draftPatch: SharedAgentDraftPatch | null
  pendingApproval: SharedAgentPendingApproval | null
  toolEvents: SharedAgentToolEvent[]
  usage: SharedAgentUsage
  generatedAt: string
  traceId: string | null
  runId: string | null
  workflowId: SharedAgentWorkflowId | null
}

export type SharedAgentVideoItem = {
  documentId: string
  coreId: string | null
  title: string
  slug: string | null
  description: string | null
  primaryLanguage: string | null
}

export type SharedAgentSubtitleContextStatus =
  | "included"
  | "unavailable"
  | "omitted"

export type SharedAgentVideoHydrationResponse = {
  video: SharedAgentVideoItem
  subtitleContextStatus: SharedAgentSubtitleContextStatus
  draft: SharedAgentRunRequest
}

export type SharedAgentSessionMessage = {
  id: string
  role: "user" | "assistant" | "system"
  content: string
  createdAt: string
}

export type SharedAgentSession = {
  id: string
  agent: SharedAgentCatalogItem
  owner: SharedAgentSessionOwner
  video: SharedAgentVideoItem | null
  workflowId: SharedAgentWorkflowId | null
  createdAt: string
  updatedAt: string
  latestDraft: SharedAgentRunRequest | null
  latestRun: SharedAgentRunResponse | null
  savedRecommendationSummary: string | null
  messages: SharedAgentSessionMessage[]
}

export type SharedAgentSessionResponse = {
  session: SharedAgentSession
}

export const sharedAgentRunRequestSchema = sharedAgentRunInputSchema

export type SharedAgentRunRequest = SharedAgentRunInput

export const sharedAgentSessionCreateRequestSchema = z.object({
  agentId: z.string().trim().min(1),
  videoDocumentId: z
    .string()
    .trim()
    .min(1)
    .optional()
    .transform((value) => (value && value.length > 0 ? value : undefined)),
})

export type SharedAgentSessionCreateRequest = z.infer<
  typeof sharedAgentSessionCreateRequestSchema
>

export const sharedAgentSessionMessageRequestSchema = z
  .object({
    message: z
      .string()
      .trim()
      .max(4_000)
      .optional()
      .transform((value) => (value && value.length > 0 ? value : undefined)),
    draft: sharedAgentRunRequestSchema.optional(),
  })
  .superRefine((value, context) => {
    if (!value.message && !value.draft) {
      context.addIssue({
        code: "custom",
        message: "Provide either a message or a draft payload.",
        path: ["message"],
      })
    }
  })

export type SharedAgentSessionMessageRequest = z.infer<
  typeof sharedAgentSessionMessageRequestSchema
>

export const sharedAgentApprovalActionRequestSchema = z.object({
  action: z.enum(["approve", "decline"]),
})

export type SharedAgentApprovalActionRequest = z.infer<
  typeof sharedAgentApprovalActionRequestSchema
>

export const sharedAgentResultSchema = sharedAgentStructuredResultSchema

export function toSharedAgentCatalogItem(
  definition: SharedAgentDefinition,
): SharedAgentCatalogItem {
  return {
    id: definition.id,
    name: definition.name,
    summary: definition.summary,
    category: definition.category,
    starterPrompt: definition.starterPrompt,
    description: definition.description,
    fields: definition.fields,
    capabilities: definition.capabilities,
  }
}
