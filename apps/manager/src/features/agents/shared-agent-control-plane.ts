import { randomUUID } from "node:crypto"
import { Agent } from "@mastra/core/agent"
import {
  MASTRA_RESOURCE_ID_KEY,
  MASTRA_THREAD_ID_KEY,
  RequestContext,
} from "@mastra/core/request-context"
import { InMemoryStore } from "@mastra/core/storage"
import { createTool } from "@mastra/core/tools"
import { createStep, createWorkflow } from "@mastra/core/workflows"
import { Memory } from "@mastra/memory"
import {
  buildSharedAgentDraftFromVideo,
  hydrateSharedAgentVideoDraft,
  loadSharedAgentVideoSource,
  searchSharedAgentLibraryVideos,
} from "@/features/agents/shared-agent-video-library"
import {
  SharedAgentMetadataTranslationError,
  translateSharedAgentMetadata,
} from "@/features/agents/shared-agent-translation"
import type { ManagerOverrideActor } from "@/lib/auth"
import { createEnrichmentJobs } from "@/app/api/enrich/route"
import {
  buildSharedAgentPrompt,
  createSharedMastraAgent,
  getSharedAgentDefinition,
  listSharedAgentDefinitions,
  sharedAgentDraftPatchSchema,
  sharedAgentStructuredResultSchema,
  validateSharedAgentRunInput,
  type SharedAgentDefinition,
  type SharedAgentDraftPatch,
} from "@forge/agents"
import { graphql } from "@forge/graphql"
import { createOpenRouter } from "@openrouter/ai-sdk-provider"
import { z } from "zod"
import getClient from "@/cms/client"
import { env } from "@/config/env"
import {
  DEFAULT_MODEL,
  createStructuredOpenrouterOutput,
} from "@/services/openrouter"
import {
  appendSharedAgentSessionMessage,
  getSharedAgentApprovalRecord,
  getSharedAgentSession,
  recordSharedAgentSessionRun,
  resolveSharedAgentPendingApproval,
  saveSharedAgentRecommendationSummary,
  saveSharedAgentSession,
} from "./shared-agent-session-store"
import {
  toSharedAgentCatalogItem,
  type SharedAgentCatalogItem,
  type SharedAgentPendingApproval,
  type SharedAgentRunRequest,
  type SharedAgentRunResponse,
  type SharedAgentSession,
  type SharedAgentSessionOwner,
  type SharedAgentToolEvent,
  type SharedAgentUsage,
  type SharedAgentVideoItem,
  type SharedAgentWorkflowId,
} from "./shared-agent-contract"

const UPDATE_SHARED_AGENT_VIDEO = graphql(`
  mutation UpdateSharedAgentVideoMetadata(
    $documentId: ID!
    $data: VideoInput!
  ) {
    updateVideo(documentId: $documentId, data: $data) {
      documentId
      coreId
      title
      slug
      description
      snippet
      imageAlt
      aiMetadata
      primaryLanguage {
        coreId
        name
        bcp47
        iso3
      }
    }
  }
`)

const sharedAgentVideoItemSchema = z.object({
  documentId: z.string(),
  coreId: z.string().nullable(),
  title: z.string(),
  slug: z.string().nullable(),
  description: z.string().nullable(),
  primaryLanguage: z.string().nullable(),
})

const sharedAgentUsageSchema = z.object({
  promptTokens: z.number().int().min(0),
  completionTokens: z.number().int().min(0),
  totalTokens: z.number().int().min(0),
})

const sharedAgentToolEventSchema = z.object({
  id: z.string(),
  name: z.enum([
    "searchLibraryVideos",
    "readVideoContext",
    "readSceneSignals",
    "readExistingMetadataArtifacts",
    "saveDraftRecommendation",
    "applyVideoMetadataPatch",
    "enqueueEnrichmentOrFollowup",
  ]),
  status: z.enum(["completed", "pending_approval", "approved", "declined"]),
  summary: z.string(),
  createdAt: z.string(),
})

const sharedAgentRequestContextSchema = z.object({
  operatorId: z.string(),
  operatorKind: z.enum(["session", "api_key", "compatibility"]),
  operatorRole: z.string(),
  selectedApp: z.literal("manager"),
  sessionId: z.string(),
  locale: z.string(),
  videoDocumentId: z.string().optional(),
  allowedToolScope: z.array(z.string()).default([]),
})

type SharedAgentRequestContextValue = z.infer<
  typeof sharedAgentRequestContextSchema
> & {
  [MASTRA_RESOURCE_ID_KEY]?: string
  [MASTRA_THREAD_ID_KEY]?: string
}

const sharedAgentWorkflowInputSchema = z.object({
  sessionId: z.string(),
  agentId: z.string(),
  videoDocumentId: z.string().optional(),
  message: z.string().optional(),
  draft: z.any().optional(),
})

const sharedAgentSourceMetadataSchema = z.object({
  sourceLanguage: z.string().nullable(),
  title: z.string().nullable(),
  description: z.string().nullable(),
  slug: z.string().nullable(),
  snippet: z.string().nullable(),
  imageAlt: z.string().nullable(),
})

const sharedAgentGatheredPromptSchema = z.object({
  sessionId: z.string(),
  agentId: z.string(),
  workflowId: z.enum([
    "translateVideoMetadataWorkflow",
    "improveVideoSeoWorkflow",
    "sharedVideoAdvisoryWorkflow",
  ]),
  videoDocumentId: z.string().optional(),
  videoCoreId: z.string().nullable().optional(),
  draft: z.any(),
  userPrompt: z.string(),
  videoMetadata: sharedAgentSourceMetadataSchema.nullable(),
  toolEvents: z.array(sharedAgentToolEventSchema),
})

const sharedAgentWorkflowOutputSchema = z.object({
  agentId: z.string(),
  workflowId: z.enum([
    "translateVideoMetadataWorkflow",
    "improveVideoSeoWorkflow",
    "sharedVideoAdvisoryWorkflow",
  ]),
  videoDocumentId: z.string().optional(),
  videoCoreId: z.string().nullable().optional(),
  output: z.string(),
  result: sharedAgentStructuredResultSchema,
  draftPatch: sharedAgentDraftPatchSchema.nullable(),
  toolEvents: z.array(sharedAgentToolEventSchema),
  usage: sharedAgentUsageSchema,
  traceId: z.string().nullable(),
  runId: z.string().nullable(),
})

const sharedAgentStructuredResultJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    summary: { type: "string" },
    markdown: { type: "string" },
    confidence: { type: "string", enum: ["low", "medium", "high"] },
    recommendations: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          label: { type: "string" },
          rationale: { type: "string" },
          appliesTo: {
            type: "array",
            items: { type: "string" },
          },
        },
        required: ["label", "rationale", "appliesTo"],
      },
    },
    draftPatch: {
      type: "object",
      additionalProperties: false,
      properties: {
        title: { type: "string" },
        description: { type: "string" },
        slug: { type: "string" },
        snippet: { type: "string" },
        imageAlt: { type: "string" },
        targetLanguage: { type: "string" },
      },
    },
    followupActions: {
      type: "array",
      items: { type: "string" },
    },
  },
  required: [
    "summary",
    "markdown",
    "confidence",
    "recommendations",
    "followupActions",
  ],
} satisfies Record<string, unknown>

type SharedAgentWorkflowOutput = z.infer<typeof sharedAgentWorkflowOutputSchema>

export class SharedAgentNotFoundError extends Error {
  constructor(agentId: string) {
    super(`Shared agent "${agentId}" was not found.`)
    this.name = "SharedAgentNotFoundError"
  }
}

export class SharedAgentSessionNotFoundError extends Error {
  constructor(sessionId: string) {
    super(`Shared agent session "${sessionId}" was not found.`)
    this.name = "SharedAgentSessionNotFoundError"
  }
}

export class SharedAgentAccessDeniedError extends Error {
  constructor(entityId: string, entityName: "session" | "approval") {
    super(
      `Shared agent ${entityName} "${entityId}" is not available to this actor.`,
    )
    this.name = "SharedAgentAccessDeniedError"
  }
}

export class SharedAgentApprovalNotFoundError extends Error {
  constructor(approvalId: string) {
    super(`Shared agent approval "${approvalId}" was not found.`)
    this.name = "SharedAgentApprovalNotFoundError"
  }
}

export class SharedAgentApprovalAlreadyResolvedError extends Error {
  constructor(approvalId: string) {
    super(`Shared agent approval "${approvalId}" has already been resolved.`)
    this.name = "SharedAgentApprovalAlreadyResolvedError"
  }
}

export class SharedAgentValidationError extends Error {
  details: string[]

  constructor(details: string[]) {
    super("Shared agent input validation failed.")
    this.name = "SharedAgentValidationError"
    this.details = details
  }
}

let openrouterProvider: ReturnType<typeof createOpenRouter> | undefined

function getOpenrouterProvider() {
  if (!openrouterProvider) {
    openrouterProvider = createOpenRouter({
      apiKey: env.OPENROUTER_API_KEY,
      compatibility: "strict",
    })
  }

  return openrouterProvider
}

const sharedAgentStorage = new InMemoryStore({
  id: "manager-shared-agent-control-plane",
})

const sharedAgentMemory = new Memory({
  storage: sharedAgentStorage,
})

function toUsage(
  usage:
    | {
        inputTokens?: number
        outputTokens?: number
        totalTokens?: number
      }
    | undefined,
): SharedAgentUsage {
  return {
    promptTokens: usage?.inputTokens ?? 0,
    completionTokens: usage?.outputTokens ?? 0,
    totalTokens:
      usage?.totalTokens ??
      (usage?.inputTokens ?? 0) + (usage?.outputTokens ?? 0),
  }
}

function getWorkflowId(agentId: string): SharedAgentWorkflowId {
  if (agentId === "translation") {
    return "translateVideoMetadataWorkflow"
  }

  if (agentId === "seo") {
    return "improveVideoSeoWorkflow"
  }

  return "sharedVideoAdvisoryWorkflow"
}

function buildThreadId(input: {
  sessionId: string
  videoDocumentId?: string
}): string {
  return input.videoDocumentId
    ? `shared-agent:${input.sessionId}:${input.videoDocumentId}`
    : `shared-agent:${input.sessionId}`
}

function emptyDraft(definition: SharedAgentDefinition): SharedAgentRunRequest {
  return {
    goal: definition.starterPrompt,
    supportingContext: "",
    fields: Object.fromEntries(
      definition.fields.map((field) => [field.key, ""]),
    ),
  }
}

function getActorLabel(actor: ManagerOverrideActor | undefined): string {
  if (!actor) return "compatibility:manager"
  if (actor.kind === "api_key") return actor.approvedByUserId
  return `${actor.user.email} (#${actor.user.id})`
}

function getActorId(actor: ManagerOverrideActor | undefined): string {
  return actor?.approvedByUserId ?? "compatibility:manager"
}

function toSessionOwner(
  actor: ManagerOverrideActor | undefined,
): SharedAgentSessionOwner {
  return {
    actorId: getActorId(actor),
    kind:
      actor?.kind === "session"
        ? "session"
        : actor?.kind === "api_key"
          ? "api_key"
          : "compatibility",
    label: getActorLabel(actor),
  }
}

function actorOwnsRecord(
  owner: SharedAgentSessionOwner,
  actor: ManagerOverrideActor | undefined,
): boolean {
  if (!actor) {
    return (
      owner.kind === "compatibility" &&
      owner.actorId === "compatibility:manager"
    )
  }

  return owner.actorId === actor.approvedByUserId && owner.kind === actor.kind
}

function assertActorOwnsRecord(input: {
  owner: SharedAgentSessionOwner
  actor: ManagerOverrideActor | undefined
  entityId: string
  entityName: "session" | "approval"
}) {
  if (!actorOwnsRecord(input.owner, input.actor)) {
    throw new SharedAgentAccessDeniedError(input.entityId, input.entityName)
  }
}

function buildRequestContext(input: {
  sessionId: string
  actor?: ManagerOverrideActor
  locale?: string
  videoDocumentId?: string
  allowedToolScope: string[]
}): RequestContext<SharedAgentRequestContextValue> {
  const actorId = input.actor?.approvedByUserId ?? "compatibility:manager"
  const context = new RequestContext<SharedAgentRequestContextValue>()

  context.set("operatorId", actorId)
  context.set(
    "operatorKind",
    input.actor?.kind === "api_key"
      ? "api_key"
      : input.actor?.kind === "session"
        ? "session"
        : "compatibility",
  )
  context.set(
    "operatorRole",
    input.actor?.kind === "session"
      ? (input.actor.user.role?.name ?? "Manager")
      : "Manager",
  )
  context.set("selectedApp", "manager")
  context.set("sessionId", input.sessionId)
  context.set("locale", input.locale ?? "en")
  context.set("allowedToolScope", input.allowedToolScope)
  if (input.videoDocumentId) {
    context.set("videoDocumentId", input.videoDocumentId)
  }

  context.set(MASTRA_RESOURCE_ID_KEY, actorId)
  context.set(
    MASTRA_THREAD_ID_KEY,
    buildThreadId({
      sessionId: input.sessionId,
      videoDocumentId: input.videoDocumentId,
    }),
  )

  return context
}

function recordToolEvent(
  name: SharedAgentToolEvent["name"],
  summary: string,
  status: SharedAgentToolEvent["status"] = "completed",
): SharedAgentToolEvent {
  return {
    id: randomUUID(),
    name,
    status,
    summary,
    createdAt: new Date().toISOString(),
  }
}

function buildMetadataArtifactsSummary(input: {
  title: string
  description: string | null
  slug: string | null
  snippet: string | null
  imageAlt: string | null
  aiMetadata: boolean | null
}): string {
  const lines = [`Title: ${input.title}`]

  if (input.description) lines.push(`Description: ${input.description}`)
  if (input.slug) lines.push(`Slug: ${input.slug}`)
  if (input.snippet) lines.push(`Snippet: ${input.snippet}`)
  if (input.imageAlt) lines.push(`Image alt: ${input.imageAlt}`)
  if (input.aiMetadata != null) {
    lines.push(`AI metadata flag: ${input.aiMetadata ? "true" : "false"}`)
  }

  return lines.join("\n")
}

function normalizeOperatorMessage(
  message: string | undefined,
): string | undefined {
  if (!message) return undefined
  const trimmed = message.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

function stripPromptInjection(text: string): string {
  return text.replace(
    /(ignore previous instructions|system prompt|developer message|tool instructions)/gi,
    "[redacted]",
  )
}

function normalizeDraftPatch(
  patch: SharedAgentDraftPatch,
): SharedAgentDraftPatch {
  const slug = patch.slug
    ? patch.slug
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
    : undefined

  const next = {
    ...patch,
    ...(slug ? { slug } : {}),
  }

  const parsed = sharedAgentDraftPatchSchema.safeParse(next)
  if (!parsed.success) {
    throw new SharedAgentValidationError(
      parsed.error.issues.map((issue) => issue.message),
    )
  }

  return parsed.data
}

function buildPatchSummary(patch: SharedAgentDraftPatch): string {
  const fields = [
    patch.title ? "title" : null,
    patch.description ? "description" : null,
    patch.slug ? "slug" : null,
    patch.snippet ? "snippet" : null,
    patch.imageAlt ? "imageAlt" : null,
  ].filter((field): field is string => field != null)

  return fields.length > 0
    ? `Ready to apply ${fields.join(", ")} update${fields.length === 1 ? "" : "s"}.`
    : "Ready to apply approved metadata update."
}

function readDraftStringField(
  draft: SharedAgentRunRequest,
  key: string,
): string | undefined {
  const value = draft.fields[key]
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined
}

function getTranslatedMetadataFieldMaxLength(field: string): number {
  switch (field) {
    case "description":
      return 8_000
    case "snippet":
      return 500
    default:
      return 255
  }
}

function buildAgentPrompt(input: {
  definition: SharedAgentDefinition
  draft: SharedAgentRunRequest
  operatorMessage?: string
  videoContext?: Awaited<ReturnType<typeof loadSharedAgentVideoSource>>
}): string {
  const sections = [buildSharedAgentPrompt(input.definition, input.draft)]

  if (input.operatorMessage) {
    sections.push(
      `Operator request:\n${stripPromptInjection(input.operatorMessage)}`,
    )
  }

  if (input.videoContext) {
    sections.push(
      `Current metadata artifacts:\n${buildMetadataArtifactsSummary(
        input.videoContext.metadataArtifacts,
      )}`,
    )

    if (input.videoContext.transcriptExcerpt) {
      sections.push(
        `Trusted transcript excerpt:\n${stripPromptInjection(
          input.videoContext.transcriptExcerpt,
        )}`,
      )
    }

    sections.push(
      input.videoContext.sceneSignals.available &&
        input.videoContext.sceneSignals.summary
        ? `Scene signals:\n${input.videoContext.sceneSignals.summary}`
        : "Scene signals:\nNo scene-analysis summary is currently available.",
    )
  }

  sections.push(
    [
      "Output rules:",
      "- Ground recommendations in the supplied metadata and transcript context only.",
      "- Do not invent people, facts, chapters, or claims that are not present in the source.",
      "- Only include draftPatch when you can justify each changed field from the source video context.",
      input.definition.capabilities.supportsWriteback && input.videoContext
        ? "- Because this run supports approval-gated writeback, prefer returning a concrete draftPatch for the strongest grounded title, description, slug, snippet, or imageAlt improvements."
        : "- Use draftPatch sparingly for advisory-only runs.",
      "- Keep markdown concise and operator-ready.",
    ].join("\n"),
  )

  return sections.join("\n\n")
}

async function generateTranslatedMetadataWorkflowOutput(input: {
  workflowId: SharedAgentWorkflowId
  gatheredPrompt: z.infer<typeof sharedAgentGatheredPromptSchema>
}): Promise<SharedAgentWorkflowOutput | null> {
  if (
    input.gatheredPrompt.agentId !== "translation" ||
    !input.gatheredPrompt.videoMetadata
  ) {
    return null
  }

  const targetLanguage = readDraftStringField(
    input.gatheredPrompt.draft,
    "target_language",
  )
  if (!targetLanguage) {
    throw new SharedAgentValidationError(["Target language is required."])
  }

  const toneNotes = readDraftStringField(
    input.gatheredPrompt.draft,
    "tone_notes",
  )
  let usage: SharedAgentUsage = {
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
  }

  let translationResult
  try {
    translationResult = await translateSharedAgentMetadata(
      {
        source: {
          videoDocumentId: input.gatheredPrompt.videoDocumentId ?? null,
          videoCoreId: input.gatheredPrompt.videoCoreId ?? null,
          sourceLanguage: input.gatheredPrompt.videoMetadata.sourceLanguage,
          title: input.gatheredPrompt.videoMetadata.title,
          description: input.gatheredPrompt.videoMetadata.description,
          slug: input.gatheredPrompt.videoMetadata.slug,
          snippet: input.gatheredPrompt.videoMetadata.snippet,
          imageAlt: input.gatheredPrompt.videoMetadata.imageAlt,
        },
        targetLanguage,
        toneNotes,
      },
      {
        translate: async (request) => {
          const translatedEntries = await Promise.all(
            request.fields.map(async (field) => {
              const maxLength = getTranslatedMetadataFieldMaxLength(field.key)
              const response = await createStructuredOpenrouterOutput({
                context: `shared-agent-${input.workflowId}-translation-${field.key}`,
                name: `shared_agent_translated_${field.key}`,
                schema: z.object({
                  translatedText: z.string().trim().min(1).max(maxLength),
                }),
                jsonSchema: {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    translatedText: { type: "string" },
                  },
                  required: ["translatedText"],
                },
                model: DEFAULT_MODEL,
                messages: [
                  {
                    role: "system",
                    content: [
                      `Translate the provided ${field.label.toLowerCase()} into ${request.targetLanguage}.`,
                      "Return only the translated text for this one field.",
                      "Preserve meaning and avoid adding new facts or claims.",
                      field.key === "slug"
                        ? "Return a localized search-friendly slug with lowercase words separated by hyphens."
                        : `Keep the translated text within ${maxLength} characters.`,
                    ].join(" "),
                  },
                  {
                    role: "user",
                    content: JSON.stringify(
                      {
                        sourceLanguage: request.sourceLanguage,
                        targetLanguage: request.targetLanguage,
                        toneNotes: request.toneNotes,
                        field,
                        video: request.video,
                      },
                      null,
                      2,
                    ),
                  },
                ],
                onUsage: (nextUsage) => {
                  usage = {
                    promptTokens: usage.promptTokens + nextUsage.promptTokens,
                    completionTokens:
                      usage.completionTokens + nextUsage.completionTokens,
                    totalTokens: usage.totalTokens + nextUsage.totalTokens,
                  }
                },
              })

              return [field.key, response.translatedText] as const
            }),
          )

          return Object.fromEntries(translatedEntries)
        },
      },
    )
  } catch (error) {
    if (error instanceof SharedAgentMetadataTranslationError) {
      throw new SharedAgentValidationError([error.message])
    }

    throw error
  }

  return {
    agentId: input.gatheredPrompt.agentId,
    workflowId: input.workflowId,
    videoDocumentId: input.gatheredPrompt.videoDocumentId,
    videoCoreId: input.gatheredPrompt.videoCoreId ?? null,
    output: translationResult.output,
    result: translationResult.result,
    draftPatch: translationResult.draftPatch,
    toolEvents: input.gatheredPrompt.toolEvents,
    usage,
    traceId: null,
    runId: randomUUID(),
  }
}

async function applyVideoMetadataPatch(input: {
  videoDocumentId: string
  patch: SharedAgentDraftPatch
}): Promise<SharedAgentVideoItem> {
  const client = getClient()
  const normalizedPatch = normalizeDraftPatch(input.patch)

  const result = await client.mutate({
    mutation: UPDATE_SHARED_AGENT_VIDEO,
    variables: {
      documentId: input.videoDocumentId,
      data: {
        ...(normalizedPatch.title ? { title: normalizedPatch.title } : {}),
        ...(normalizedPatch.description
          ? { description: normalizedPatch.description }
          : {}),
        ...(normalizedPatch.slug ? { slug: normalizedPatch.slug } : {}),
        ...(normalizedPatch.snippet
          ? { snippet: normalizedPatch.snippet }
          : {}),
        ...(normalizedPatch.imageAlt
          ? { imageAlt: normalizedPatch.imageAlt }
          : {}),
        aiMetadata: true,
      },
    },
  })

  const video = result.data?.updateVideo
  if (!video) {
    throw new Error("Video metadata patch did not return an updated video.")
  }

  return {
    documentId: video.documentId,
    coreId: video.coreId ?? null,
    title: video.title ?? video.slug ?? video.documentId,
    slug: video.slug ?? null,
    description: video.description ?? null,
    primaryLanguage: video.primaryLanguage?.name ?? null,
  }
}

const searchLibraryVideosTool = createTool({
  id: "searchLibraryVideos",
  description: "Search library videos by title or slug.",
  inputSchema: z.object({
    query: z.string().trim().min(2),
  }),
  outputSchema: z.object({
    videos: z.array(sharedAgentVideoItemSchema),
  }),
  requestContextSchema: sharedAgentRequestContextSchema,
  execute: async ({ query }) => ({
    videos: await searchSharedAgentLibraryVideos(query),
  }),
})

const readVideoContextTool = createTool({
  id: "readVideoContext",
  description:
    "Read canonical Manager video context, including metadata and trusted subtitle excerpts when available.",
  inputSchema: z.object({
    agentId: z.string().trim().min(1),
    videoDocumentId: z.string().trim().min(1),
  }),
  outputSchema: z.object({
    video: sharedAgentVideoItemSchema,
    subtitleContextStatus: z.enum(["included", "unavailable", "omitted"]),
    transcriptExcerpt: z.string().nullable(),
  }),
  requestContextSchema: sharedAgentRequestContextSchema,
  execute: async ({ agentId, videoDocumentId }) => {
    const definition = getSharedAgentDefinition(agentId)
    if (!definition) {
      throw new SharedAgentNotFoundError(agentId)
    }

    const source = await loadSharedAgentVideoSource({
      definition,
      videoDocumentId,
    })

    return {
      video: source.video,
      subtitleContextStatus: source.subtitleContextStatus,
      transcriptExcerpt: source.transcriptExcerpt ?? null,
    }
  },
})

const readSceneSignalsTool = createTool({
  id: "readSceneSignals",
  description:
    "Read scene-analysis signals for a video when they are already available.",
  inputSchema: z.object({
    agentId: z.string().trim().min(1),
    videoDocumentId: z.string().trim().min(1),
  }),
  outputSchema: z.object({
    available: z.boolean(),
    summary: z.string().nullable(),
  }),
  requestContextSchema: sharedAgentRequestContextSchema,
  execute: async ({ agentId, videoDocumentId }) => {
    const definition = getSharedAgentDefinition(agentId)
    if (!definition) {
      throw new SharedAgentNotFoundError(agentId)
    }

    const source = await loadSharedAgentVideoSource({
      definition,
      videoDocumentId,
    })

    return source.sceneSignals
  },
})

const readExistingMetadataArtifactsTool = createTool({
  id: "readExistingMetadataArtifacts",
  description:
    "Read the existing metadata artifacts for a library video before recommending changes.",
  inputSchema: z.object({
    agentId: z.string().trim().min(1),
    videoDocumentId: z.string().trim().min(1),
  }),
  outputSchema: z.object({
    title: z.string(),
    description: z.string().nullable(),
    slug: z.string().nullable(),
    snippet: z.string().nullable(),
    imageAlt: z.string().nullable(),
    aiMetadata: z.boolean().nullable(),
  }),
  requestContextSchema: sharedAgentRequestContextSchema,
  execute: async ({ agentId, videoDocumentId }) => {
    const definition = getSharedAgentDefinition(agentId)
    if (!definition) {
      throw new SharedAgentNotFoundError(agentId)
    }

    const source = await loadSharedAgentVideoSource({
      definition,
      videoDocumentId,
    })

    return source.metadataArtifacts
  },
})

const saveDraftRecommendationTool = createTool({
  id: "saveDraftRecommendation",
  description:
    "Persist the latest structured draft recommendation for the current Manager session.",
  inputSchema: z.object({
    sessionId: z.string().trim().min(1),
    summary: z.string().trim().min(1).max(1_500),
  }),
  outputSchema: z.object({
    saved: z.boolean(),
  }),
  requestContextSchema: sharedAgentRequestContextSchema,
  execute: async ({ sessionId, summary }) => ({
    saved:
      saveSharedAgentRecommendationSummary({
        sessionId,
        summary,
        savedAt: new Date().toISOString(),
      }) != null,
  }),
})

const applyVideoMetadataPatchTool = createTool({
  id: "applyVideoMetadataPatch",
  description:
    "Apply an approved metadata patch to a library video through Manager-owned CMS access.",
  requireApproval: true,
  inputSchema: z.object({
    videoDocumentId: z.string().trim().min(1),
    patch: sharedAgentDraftPatchSchema,
  }),
  outputSchema: z.object({
    video: sharedAgentVideoItemSchema,
  }),
  requestContextSchema: sharedAgentRequestContextSchema,
  execute: async ({ videoDocumentId, patch }, context) => {
    const scope = context?.requestContext?.get("allowedToolScope") as
      | string[]
      | undefined

    if (!scope?.includes("apply_video_metadata_patch")) {
      throw new Error("Video metadata write scope is not available.")
    }

    return {
      video: await applyVideoMetadataPatch({
        videoDocumentId,
        patch,
      }),
    }
  },
})

const enqueueEnrichmentOrFollowupTool = createTool({
  id: "enqueueEnrichmentOrFollowup",
  description:
    "Queue a follow-up enrichment workflow for a library video after explicit approval.",
  requireApproval: true,
  inputSchema: z.object({
    videoCoreId: z.string().trim().min(1),
    targetLanguageIds: z.array(z.string().trim().min(1)).max(10).default([]),
  }),
  outputSchema: z.object({
    created: z.number().int().min(0),
  }),
  requestContextSchema: sharedAgentRequestContextSchema,
  execute: async ({ videoCoreId, targetLanguageIds }, context) => {
    const scope = context?.requestContext?.get("allowedToolScope") as
      | string[]
      | undefined

    if (!scope?.includes("enqueue_followup")) {
      throw new Error("Follow-up enqueue scope is not available.")
    }

    const result = await createEnrichmentJobs({
      videoIds: [videoCoreId],
      targetLanguageIds,
    })

    return { created: result.created }
  },
})

const sharedAgentTools = {
  searchLibraryVideos: searchLibraryVideosTool,
  readVideoContext: readVideoContextTool,
  readSceneSignals: readSceneSignalsTool,
  readExistingMetadataArtifacts: readExistingMetadataArtifactsTool,
  saveDraftRecommendation: saveDraftRecommendationTool,
  applyVideoMetadataPatch: applyVideoMetadataPatchTool,
  enqueueEnrichmentOrFollowup: enqueueEnrichmentOrFollowupTool,
}

const sharedAgentModels = Object.fromEntries(
  listSharedAgentDefinitions().map((definition) => [
    definition.id,
    createSharedMastraAgent({
      definition,
      model: getOpenrouterProvider().chat(DEFAULT_MODEL),
      tools: sharedAgentTools,
      memory: sharedAgentMemory,
      requestContextSchema: sharedAgentRequestContextSchema,
      defaultOptions: {
        maxSteps: 1,
      },
    }),
  ]),
) as Record<string, Agent>

function createSharedWorkflow(
  workflowId: SharedAgentWorkflowId,
  allowedAgentIds: string[],
) {
  const gatherPromptStep = createStep({
    id: `${workflowId}_gatherPrompt`,
    description:
      "Gather canonical video context and assemble the agent prompt.",
    inputSchema: sharedAgentWorkflowInputSchema,
    outputSchema: sharedAgentGatheredPromptSchema,
    requestContextSchema: sharedAgentRequestContextSchema,
    execute: async ({ inputData, requestContext }) => {
      const definition = getSharedAgentDefinition(inputData.agentId)
      if (!definition) {
        throw new SharedAgentNotFoundError(inputData.agentId)
      }

      if (!allowedAgentIds.includes(definition.id)) {
        throw new Error(`${definition.id} cannot run inside ${workflowId}.`)
      }

      const toolEvents: SharedAgentToolEvent[] = []
      const operatorMessage = normalizeOperatorMessage(inputData.message)
      let videoContext:
        | Awaited<ReturnType<typeof loadSharedAgentVideoSource>>
        | undefined
      let videoMetadata: z.infer<
        typeof sharedAgentSourceMetadataSchema
      > | null = null
      const toolContext = { requestContext } as never

      if (inputData.videoDocumentId) {
        const readVideoContextResult = await readVideoContextTool.execute?.(
          {
            agentId: definition.id,
            videoDocumentId: inputData.videoDocumentId,
          },
          toolContext,
        )
        const metadataArtifacts =
          await readExistingMetadataArtifactsTool.execute?.(
            {
              agentId: definition.id,
              videoDocumentId: inputData.videoDocumentId,
            },
            toolContext,
          )
        const sceneSignals =
          definition.id === "seo" || definition.id === "video_enhancing"
            ? await readSceneSignalsTool.execute?.(
                {
                  agentId: definition.id,
                  videoDocumentId: inputData.videoDocumentId,
                },
                toolContext,
              )
            : { available: false, summary: null }

        if (
          !readVideoContextResult ||
          !("video" in readVideoContextResult) ||
          !metadataArtifacts ||
          !("title" in metadataArtifacts) ||
          !sceneSignals ||
          !("available" in sceneSignals)
        ) {
          throw new Error(
            "Shared agent tool execution failed while loading video context.",
          )
        }

        const resolvedVideoContext = {
          video: readVideoContextResult.video,
          subtitleContextStatus: readVideoContextResult.subtitleContextStatus,
          transcriptExcerpt:
            readVideoContextResult.transcriptExcerpt ?? undefined,
          metadataArtifacts,
          sceneSignals,
        }
        videoContext = resolvedVideoContext
        videoMetadata = {
          sourceLanguage: resolvedVideoContext.video.primaryLanguage,
          title: metadataArtifacts.title,
          description: metadataArtifacts.description,
          slug: metadataArtifacts.slug,
          snippet: metadataArtifacts.snippet,
          imageAlt: metadataArtifacts.imageAlt,
        }

        toolEvents.push(
          recordToolEvent(
            "readVideoContext",
            `Loaded context for ${resolvedVideoContext.video.title}.`,
          ),
        )
        toolEvents.push(
          recordToolEvent(
            "readExistingMetadataArtifacts",
            "Loaded existing video metadata artifacts.",
          ),
        )

        if (definition.id === "seo" || definition.id === "video_enhancing") {
          toolEvents.push(
            recordToolEvent(
              "readSceneSignals",
              resolvedVideoContext.sceneSignals.available
                ? "Loaded scene-analysis summary."
                : "No stored scene-analysis summary was available.",
            ),
          )
        }
      }

      const draft =
        inputData.draft != null
          ? (() => {
              const validation = validateSharedAgentRunInput(
                definition,
                inputData.draft,
              )
              if (!validation.success) {
                throw new SharedAgentValidationError(validation.errors)
              }
              return validation.data
            })()
          : videoContext
            ? (() => {
                const hydrated = buildSharedAgentDraftFromVideo({
                  definition,
                  source: videoContext,
                })
                return operatorMessage
                  ? { ...hydrated, goal: operatorMessage }
                  : hydrated
              })()
            : (() => {
                const draft = emptyDraft(definition)
                return operatorMessage
                  ? { ...draft, goal: operatorMessage }
                  : draft
              })()

      return {
        sessionId: inputData.sessionId,
        agentId: inputData.agentId,
        workflowId,
        videoDocumentId:
          videoContext?.video.documentId ?? inputData.videoDocumentId,
        videoCoreId: videoContext?.video.coreId ?? null,
        draft,
        userPrompt: buildAgentPrompt({
          definition,
          draft,
          operatorMessage,
          videoContext,
        }),
        videoMetadata,
        toolEvents,
      }
    },
  })

  const generateDraftStep = createStep({
    id: `${workflowId}_generateDraft`,
    description:
      "Generate a structured recommendation and optional metadata patch.",
    inputSchema: sharedAgentGatheredPromptSchema,
    outputSchema: sharedAgentWorkflowOutputSchema,
    requestContextSchema: sharedAgentRequestContextSchema,
    execute: async ({
      inputData,
      requestContext,
    }): Promise<z.infer<typeof sharedAgentWorkflowOutputSchema>> => {
      if (!env.OPENROUTER_API_KEY) {
        throw new Error(
          "OPENROUTER_API_KEY is not configured for shared agent runs.",
        )
      }

      const agent = sharedAgentModels[inputData.agentId]
      if (!agent) {
        throw new SharedAgentNotFoundError(inputData.agentId)
      }
      const definition = getSharedAgentDefinition(inputData.agentId)
      if (!definition) {
        throw new SharedAgentNotFoundError(inputData.agentId)
      }

      const translatedMetadataOutput =
        await generateTranslatedMetadataWorkflowOutput({
          workflowId,
          gatheredPrompt: inputData,
        })
      if (translatedMetadataOutput) {
        return translatedMetadataOutput
      }

      const writebackCapableRun =
        definition.capabilities.supportsWriteback &&
        Boolean(inputData.videoDocumentId)

      const typedRequestContext =
        requestContext as RequestContext<SharedAgentRequestContextValue>
      const actorId = typedRequestContext.get(MASTRA_RESOURCE_ID_KEY) as string
      const threadId =
        (typedRequestContext.get(MASTRA_THREAD_ID_KEY) as string | undefined) ??
        buildThreadId({
          sessionId: inputData.sessionId,
          videoDocumentId: inputData.videoDocumentId,
        })

      const response = await agent.generate(inputData.userPrompt, {
        requestContext,
        structuredOutput: {
          schema: sharedAgentStructuredResultSchema,
        },
        memory: {
          resource: actorId,
          thread: {
            id: threadId,
            title: `${inputData.agentId} session ${inputData.sessionId}`,
          },
        },
      })

      if (response.error) {
        throw response.error
      }

      let structuredResult = response.object
      if (!structuredResult) {
        const responseText = [
          response.text.trim(),
          ...response.steps
            .map((step) =>
              typeof step.text === "string" ? step.text.trim() : "",
            )
            .filter(Boolean),
        ]
          .filter(Boolean)
          .join("\n\n")

        const toolResultsText =
          response.toolResults.length > 0
            ? JSON.stringify(response.toolResults, null, 2)
            : ""

        structuredResult = await createStructuredOpenrouterOutput({
          context: `shared-agent-${workflowId}`,
          name: "shared_agent_structured_result",
          schema: sharedAgentStructuredResultSchema,
          jsonSchema: sharedAgentStructuredResultJsonSchema,
          model: DEFAULT_MODEL,
          messages: [
            {
              role: "system",
              content: `Convert the shared agent response into the required JSON schema. Keep every field grounded in the supplied response and prompt. Do not invent video metadata fields that are not supported by the source response.${writebackCapableRun ? " When the source clearly supports better metadata, prefer returning a concrete draftPatch for the best title, description, slug, snippet, or imageAlt improvements." : ""}`,
            },
            {
              role: "user",
              content: `Agent ID: ${inputData.agentId}\nWorkflow ID: ${workflowId}\n\nOriginal prompt:\n${inputData.userPrompt}\n\nTool results:\n${toolResultsText || "(none)"}\n\nShared agent response:\n${responseText || "(the provider returned no final text; derive the structured result directly from the prompt and tool outputs)"}`,
            },
          ],
        })
      }

      const draftPatch =
        structuredResult.draftPatch != null
          ? normalizeDraftPatch(structuredResult.draftPatch)
          : null

      return {
        agentId: inputData.agentId,
        workflowId,
        videoDocumentId: inputData.videoDocumentId,
        videoCoreId: inputData.videoCoreId ?? null,
        output:
          structuredResult.markdown.trim() ||
          response.text.trim() ||
          structuredResult.summary,
        result: {
          ...structuredResult,
          confidence: structuredResult.confidence ?? "medium",
          recommendations: (structuredResult.recommendations ?? []).map(
            (recommendation) => ({
              ...recommendation,
              appliesTo: recommendation.appliesTo ?? [],
            }),
          ),
          followupActions: structuredResult.followupActions ?? [],
          ...(draftPatch ? { draftPatch } : {}),
        },
        draftPatch,
        toolEvents: inputData.toolEvents,
        usage: toUsage(response.totalUsage),
        traceId: response.traceId ?? null,
        runId: response.runId ?? null,
      }
    },
  })

  return createWorkflow({
    id: workflowId,
    description: `Shared Manager control-plane workflow for ${workflowId}.`,
    inputSchema: sharedAgentWorkflowInputSchema,
    outputSchema: sharedAgentWorkflowOutputSchema,
    requestContextSchema: sharedAgentRequestContextSchema,
  })
    .then(gatherPromptStep)
    .then(generateDraftStep)
    .commit()
}

const translateVideoMetadataWorkflow = createSharedWorkflow(
  "translateVideoMetadataWorkflow",
  ["translation"],
)
const improveVideoSeoWorkflow = createSharedWorkflow(
  "improveVideoSeoWorkflow",
  ["seo"],
)
const sharedVideoAdvisoryWorkflow = createSharedWorkflow(
  "sharedVideoAdvisoryWorkflow",
  ["video_enhancing", "marketing"],
)

const sharedAgentWorkflows = {
  translateVideoMetadataWorkflow,
  improveVideoSeoWorkflow,
  sharedVideoAdvisoryWorkflow,
}

function buildPendingApproval(input: {
  sessionId: string
  run: SharedAgentRunResponse
  video: SharedAgentVideoItem
  owner: SharedAgentSessionOwner
}): SharedAgentPendingApproval | null {
  if (
    !input.run.agent.capabilities.supportsWriteback ||
    !input.run.draftPatch
  ) {
    return null
  }

  return {
    id: randomUUID(),
    sessionId: input.sessionId,
    runId: input.run.runId,
    traceId: input.run.traceId,
    agentId: input.run.agent.id,
    owner: input.owner,
    actionType: "apply_video_metadata_patch",
    target: {
      videoDocumentId: input.video.documentId,
      videoCoreId: input.video.coreId,
    },
    patchSummary: buildPatchSummary(input.run.draftPatch),
    actor: null,
    status: "pending",
    createdAt: input.run.generatedAt,
    resolvedAt: null,
    draftPatch: input.run.draftPatch,
  }
}

function buildAssistantRun(input: {
  sessionId: string
  agent: SharedAgentCatalogItem
  workflowOutput: SharedAgentWorkflowOutput
  video: SharedAgentVideoItem | null
  owner: SharedAgentSessionOwner
}): SharedAgentRunResponse {
  const baseRun: SharedAgentRunResponse = {
    sessionId: input.sessionId,
    agent: input.agent,
    output: input.workflowOutput.output,
    result: input.workflowOutput.result,
    draftPatch: input.workflowOutput.draftPatch,
    pendingApproval: null,
    toolEvents: [...input.workflowOutput.toolEvents],
    usage: input.workflowOutput.usage,
    generatedAt: new Date().toISOString(),
    traceId: input.workflowOutput.traceId,
    runId: input.workflowOutput.runId,
    workflowId: input.workflowOutput.workflowId,
  }

  return input.video
    ? {
        ...baseRun,
        pendingApproval: buildPendingApproval({
          sessionId: input.sessionId,
          run: baseRun,
          video: input.video,
          owner: input.owner,
        }),
      }
    : baseRun
}

function toSessionMessage(
  role: SharedAgentSession["messages"][number]["role"],
  content: string,
) {
  return {
    id: randomUUID(),
    role,
    content,
    createdAt: new Date().toISOString(),
  }
}

export function listSharedAgentCatalog(): SharedAgentCatalogItem[] {
  return listSharedAgentDefinitions().map(toSharedAgentCatalogItem)
}

export async function createSharedAgentSession(input: {
  agentId: string
  videoDocumentId?: string
  actor?: ManagerOverrideActor
}): Promise<SharedAgentSession> {
  const definition = getSharedAgentDefinition(input.agentId)
  if (!definition) {
    throw new SharedAgentNotFoundError(input.agentId)
  }

  let video: SharedAgentVideoItem | null = null
  if (input.videoDocumentId) {
    const source = await loadSharedAgentVideoSource({
      definition,
      videoDocumentId: input.videoDocumentId,
    })
    video = source.video
  }

  const now = new Date().toISOString()
  const session: SharedAgentSession = {
    id: randomUUID(),
    agent: toSharedAgentCatalogItem(definition),
    owner: toSessionOwner(input.actor),
    video,
    workflowId: getWorkflowId(definition.id),
    createdAt: now,
    updatedAt: now,
    latestDraft: null,
    latestRun: null,
    savedRecommendationSummary: null,
    messages: [],
  }

  return saveSharedAgentSession(session)
}

export function getSharedAgentSessionSnapshot(input: {
  sessionId: string
  actor?: ManagerOverrideActor
}): SharedAgentSession {
  const session = getSharedAgentSession(input.sessionId)
  if (!session) {
    throw new SharedAgentSessionNotFoundError(input.sessionId)
  }

  assertActorOwnsRecord({
    owner: session.owner,
    actor: input.actor,
    entityId: session.id,
    entityName: "session",
  })

  return session
}

export async function runSharedAgentSessionMessage(input: {
  sessionId: string
  actor?: ManagerOverrideActor
  locale?: string
  message?: string
  draft?: SharedAgentRunRequest
}): Promise<SharedAgentSession> {
  const session = getSharedAgentSession(input.sessionId)
  if (!session) {
    throw new SharedAgentSessionNotFoundError(input.sessionId)
  }

  assertActorOwnsRecord({
    owner: session.owner,
    actor: input.actor,
    entityId: session.id,
    entityName: "session",
  })

  const userMessageContent =
    normalizeOperatorMessage(input.message) ??
    input.draft?.goal ??
    session.agent.starterPrompt

  appendSharedAgentSessionMessage({
    sessionId: session.id,
    message: toSessionMessage("user", userMessageContent),
  })

  const workflow =
    sharedAgentWorkflows[session.workflowId ?? getWorkflowId(session.agent.id)]
  const requestContext = buildRequestContext({
    sessionId: session.id,
    actor: input.actor,
    locale: input.locale,
    videoDocumentId: session.video?.documentId,
    allowedToolScope: [
      "searchLibraryVideos",
      "readVideoContext",
      "readSceneSignals",
      "readExistingMetadataArtifacts",
      "saveDraftRecommendation",
    ],
  })

  const workflowRun = await workflow.createRun({
    runId: randomUUID(),
    resourceId:
      (requestContext.get(MASTRA_RESOURCE_ID_KEY) as string | undefined) ??
      undefined,
  })

  const workflowResult = await workflowRun.start({
    inputData: {
      sessionId: session.id,
      agentId: session.agent.id,
      videoDocumentId: session.video?.documentId,
      message: normalizeOperatorMessage(input.message),
      draft: input.draft,
    },
    requestContext: requestContext as never,
  })

  if (workflowResult.status !== "success") {
    const workflowErrorMessage =
      workflowResult.status === "failed" &&
      typeof workflowResult.error?.message === "string"
        ? workflowResult.error.message
        : `Shared agent workflow failed with status ${workflowResult.status}.`

    throw new Error(workflowErrorMessage)
  }

  await saveDraftRecommendationTool.execute?.(
    {
      sessionId: session.id,
      summary: workflowResult.result.result.summary,
    },
    { requestContext } as never,
  )

  const toolEvents = [
    ...workflowResult.result.toolEvents,
    recordToolEvent(
      "saveDraftRecommendation",
      "Saved the latest structured recommendation for session review.",
    ),
  ]

  const run = buildAssistantRun({
    sessionId: session.id,
    agent: session.agent,
    workflowOutput: {
      ...workflowResult.result,
      result: {
        ...workflowResult.result.result,
        confidence: workflowResult.result.result.confidence ?? "medium",
        recommendations: (
          workflowResult.result.result.recommendations ?? []
        ).map((recommendation) => ({
          ...recommendation,
          appliesTo: recommendation.appliesTo ?? [],
        })),
        followupActions: workflowResult.result.result.followupActions ?? [],
      },
      toolEvents,
    },
    video: session.video,
    owner: session.owner,
  })

  appendSharedAgentSessionMessage({
    sessionId: session.id,
    message: toSessionMessage("assistant", run.output),
  })

  const updated = recordSharedAgentSessionRun({
    sessionId: session.id,
    run,
    latestDraft: input.draft ?? session.latestDraft,
  })

  if (!updated) {
    throw new SharedAgentSessionNotFoundError(session.id)
  }

  return updated
}

export async function actOnSharedAgentApproval(input: {
  approvalId: string
  action: "approve" | "decline"
  actor: ManagerOverrideActor
  locale?: string
}): Promise<SharedAgentSession> {
  const approval = getSharedAgentApprovalRecord(input.approvalId)
  if (!approval) {
    throw new SharedAgentApprovalNotFoundError(input.approvalId)
  }

  assertActorOwnsRecord({
    owner: approval.owner,
    actor: input.actor,
    entityId: approval.id,
    entityName: "approval",
  })

  if (approval.status !== "pending") {
    throw new SharedAgentApprovalAlreadyResolvedError(input.approvalId)
  }

  const actorLabel = getActorLabel(input.actor)
  const resolvedAt = new Date().toISOString()

  if (
    input.action === "approve" &&
    approval.actionType === "apply_video_metadata_patch"
  ) {
    if (!approval.draftPatch) {
      throw new Error("Approval is missing a draft patch.")
    }

    const requestContext = buildRequestContext({
      sessionId: approval.sessionId,
      actor: input.actor,
      locale: input.locale,
      videoDocumentId: approval.target.videoDocumentId,
      allowedToolScope: ["apply_video_metadata_patch"],
    })

    await applyVideoMetadataPatchTool.execute?.(
      {
        videoDocumentId: approval.target.videoDocumentId,
        patch: approval.draftPatch,
      },
      { requestContext } as never,
    )
  }

  const resolved = resolveSharedAgentPendingApproval({
    approvalId: input.approvalId,
    actor: actorLabel,
    status: input.action === "approve" ? "approved" : "declined",
    resolvedAt,
  })

  if (!resolved?.session) {
    throw new SharedAgentSessionNotFoundError(approval.sessionId)
  }

  const nextSession = {
    ...resolved.session,
    latestRun: resolved.session.latestRun
      ? {
          ...resolved.session.latestRun,
          toolEvents: [
            ...resolved.session.latestRun.toolEvents,
            recordToolEvent(
              approval.actionType === "apply_video_metadata_patch"
                ? "applyVideoMetadataPatch"
                : "enqueueEnrichmentOrFollowup",
              input.action === "approve"
                ? `Approved by ${actorLabel}.`
                : `Declined by ${actorLabel}.`,
              input.action === "approve" ? "approved" : "declined",
            ),
          ],
        }
      : null,
  }

  appendSharedAgentSessionMessage({
    sessionId: nextSession.id,
    message: toSessionMessage(
      "system",
      input.action === "approve"
        ? `Approved by ${actorLabel}.`
        : `Declined by ${actorLabel}.`,
    ),
  })

  return saveSharedAgentSession(nextSession)
}

export async function runSharedAgentCompatibility(input: {
  agentId: string
  payload: SharedAgentRunRequest
}): Promise<SharedAgentRunResponse> {
  const validation = getSharedAgentDefinition(input.agentId)
  if (!validation) {
    throw new SharedAgentNotFoundError(input.agentId)
  }

  const checked = validateSharedAgentRunInput(validation, input.payload)
  if (!checked.success) {
    throw new SharedAgentValidationError(checked.errors)
  }

  const session = await createSharedAgentSession({ agentId: input.agentId })
  const updated = await runSharedAgentSessionMessage({
    sessionId: session.id,
    draft: checked.data,
  })

  if (!updated.latestRun) {
    throw new Error("Shared agent compatibility run did not produce output.")
  }

  return updated.latestRun
}

export async function hydrateSharedAgentSessionVideo(input: {
  agentId: string
  videoDocumentId: string
}) {
  return hydrateSharedAgentVideoDraft(input)
}
