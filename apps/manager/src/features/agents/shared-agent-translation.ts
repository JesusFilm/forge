import {
  sharedAgentDraftPatchSchema,
  sharedAgentStructuredResultSchema,
  type SharedAgentDraftPatch,
  type SharedAgentStructuredResult,
} from "@forge/agents"

const SHARED_AGENT_TRANSLATABLE_METADATA_FIELDS = [
  { key: "title", label: "Title" },
  { key: "description", label: "Description" },
  { key: "slug", label: "Slug" },
  { key: "snippet", label: "Snippet" },
  { key: "imageAlt", label: "Image alt" },
] as const

export type SharedAgentTranslationFieldKey =
  (typeof SHARED_AGENT_TRANSLATABLE_METADATA_FIELDS)[number]["key"]

export type SharedAgentTranslationSourceMetadata = {
  videoDocumentId?: string | null
  videoCoreId?: string | null
  sourceLanguage?: string | null
  title?: string | null
  description?: string | null
  slug?: string | null
  snippet?: string | null
  imageAlt?: string | null
}

export type SharedAgentMetadataTranslationInput = {
  source: SharedAgentTranslationSourceMetadata
  targetLanguage: string
  toneNotes?: string | null
}

export type SharedAgentMetadataTranslationRequest = {
  sourceLanguage: string | null
  targetLanguage: string
  toneNotes: string | null
  video: {
    documentId: string | null
    coreId: string | null
  }
  fields: Array<{
    key: SharedAgentTranslationFieldKey
    label: string
    value: string
  }>
}

export type SharedAgentMetadataTranslationDraft = Partial<
  Record<SharedAgentTranslationFieldKey, string | null | undefined>
>

export type SharedAgentMetadataTranslationResult = {
  output: string
  draftPatch: SharedAgentDraftPatch
  result: SharedAgentStructuredResult
  translatedFields: SharedAgentTranslationFieldKey[]
}

export type SharedAgentMetadataTranslationDeps = {
  translate: (
    request: SharedAgentMetadataTranslationRequest,
  ) => Promise<SharedAgentMetadataTranslationDraft>
}

export class SharedAgentMetadataTranslationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "SharedAgentMetadataTranslationError"
  }
}

function trimNonBlank(value: unknown): string | null {
  if (typeof value !== "string") {
    return null
  }

  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function formatFieldList(fields: readonly string[]): string {
  if (fields.length === 0) {
    return ""
  }

  if (fields.length === 1) {
    return fields[0]
  }

  if (fields.length === 2) {
    return `${fields[0]} and ${fields[1]}`
  }

  return `${fields.slice(0, -1).join(", ")}, and ${fields.at(-1)}`
}

function toSentenceCaseLabel(
  field: SharedAgentTranslationFieldKey,
): string | undefined {
  return SHARED_AGENT_TRANSLATABLE_METADATA_FIELDS.find(
    (candidate) => candidate.key === field,
  )?.label
}

export function buildSharedAgentMetadataTranslationRequest(
  input: SharedAgentMetadataTranslationInput,
): SharedAgentMetadataTranslationRequest {
  const targetLanguage = trimNonBlank(input.targetLanguage)
  if (!targetLanguage) {
    throw new SharedAgentMetadataTranslationError(
      "Target language is required for metadata translation.",
    )
  }

  const fields = SHARED_AGENT_TRANSLATABLE_METADATA_FIELDS.flatMap((field) => {
    const value = trimNonBlank(input.source[field.key])
    return value
      ? [
          {
            key: field.key,
            label: field.label,
            value,
          },
        ]
      : []
  })

  if (fields.length === 0) {
    throw new SharedAgentMetadataTranslationError(
      "Source metadata must include at least one populated field.",
    )
  }

  return {
    sourceLanguage: trimNonBlank(input.source.sourceLanguage),
    targetLanguage,
    toneNotes: trimNonBlank(input.toneNotes),
    video: {
      documentId: trimNonBlank(input.source.videoDocumentId),
      coreId: trimNonBlank(input.source.videoCoreId),
    },
    fields,
  }
}

export function buildSharedAgentMetadataTranslationResult(input: {
  request: SharedAgentMetadataTranslationRequest
  translatedFields: SharedAgentMetadataTranslationDraft
}): SharedAgentMetadataTranslationResult {
  const translatedEntries = input.request.fields.flatMap((field) => {
    const translatedValue = trimNonBlank(input.translatedFields[field.key])
    return translatedValue ? [[field.key, translatedValue] as const] : []
  })

  if (translatedEntries.length === 0) {
    throw new SharedAgentMetadataTranslationError(
      "Translator did not return any translated metadata fields.",
    )
  }

  const translatedFieldKeys = translatedEntries.map(([field]) => field)
  const translatedFieldLabels = translatedFieldKeys.map((field) =>
    (toSentenceCaseLabel(field) ?? field).toLowerCase(),
  )

  const draftPatch = sharedAgentDraftPatchSchema.parse({
    ...Object.fromEntries(translatedEntries),
    targetLanguage: input.request.targetLanguage,
  })

  const summary = `Translated ${translatedEntries.length} metadata fields into ${input.request.targetLanguage}.`
  const markdown = [
    summary,
    "",
    "## Draft patch",
    ...translatedEntries.map(([field, value]) => {
      const label = toSentenceCaseLabel(field) ?? field
      return `- ${label}: ${value}`
    }),
    input.request.toneNotes ? "" : null,
    input.request.toneNotes ? `Tone notes: ${input.request.toneNotes}` : null,
  ]
    .filter((line): line is string => line != null)
    .join("\n")

  const recommendations = [
    {
      label: "Review localized metadata in context",
      rationale: `Check the translated ${formatFieldList(translatedFieldLabels)} in the final Manager preview before approving writeback.`,
      appliesTo: translatedFieldKeys,
    },
    ...(draftPatch.slug
      ? [
          {
            label: "Confirm localized slug fit",
            rationale:
              "Make sure the translated slug matches how native speakers would search for this video.",
            appliesTo: ["slug"],
          },
        ]
      : []),
  ]

  const result = sharedAgentStructuredResultSchema.parse({
    summary,
    markdown,
    confidence: translatedEntries.length >= 2 ? "high" : "medium",
    recommendations,
    draftPatch,
    followupActions: [
      "Approve the translated metadata patch if the localized wording looks right.",
    ],
  })

  return {
    output: result.markdown,
    draftPatch,
    result,
    translatedFields: translatedFieldKeys,
  }
}

export async function translateSharedAgentMetadata(
  input: SharedAgentMetadataTranslationInput,
  deps: SharedAgentMetadataTranslationDeps,
): Promise<SharedAgentMetadataTranslationResult> {
  const request = buildSharedAgentMetadataTranslationRequest(input)
  const translatedFields = await deps.translate(request)

  return buildSharedAgentMetadataTranslationResult({
    request,
    translatedFields,
  })
}
