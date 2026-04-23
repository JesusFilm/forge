import "server-only"

import {
  ARCHETYPE_SHAPES,
  buildSectionKey,
  computePlatformOrdering,
  EASTER_SHAPED_TEMPLATE_LAYOUT,
  generatedExperienceSchema,
  type ArchetypeName,
  type GeneratedExperience,
  type TemplateLayoutEntry,
  type VideoRef,
} from "@forge/experience-templates"

const DEFAULT_QUIZ_IFRAME_SRC =
  "https://your.nextstep.is/embed/default?expand=false"

// -----------------------------------------------------------------------------
// Public shapes
// -----------------------------------------------------------------------------

export type GeneratorCandidate = {
  id: number
  documentId: string
  title: string
  slug: string
  streamingUrl: string
  thumbnailUrl?: string
  similarityScore?: number
}

export type GenerateInput = {
  query: string
  themeSlug: string
  candidates: GeneratorCandidate[]
  model: string
  signal?: AbortSignal
}

export type GeneratorError =
  | { code: "NOT_CONFIGURED"; message: string }
  | { code: "INSUFFICIENT_CANDIDATES"; message: string }
  | { code: "UPSTREAM_ERROR"; message: string }
  | { code: "SCHEMA_MISMATCH"; message: string; details?: string }
  | { code: "ABORTED"; message: string }

export type GenerateResult =
  | { ok: true; experience: GeneratedExperience }
  | { ok: false; error: GeneratorError }

// -----------------------------------------------------------------------------
// Constants
// -----------------------------------------------------------------------------

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"
const REQUEST_TIMEOUT_MS = 45_000
const RETRY_DELAY_MS = 500
const MIN_CANDIDATES = 4
const CAROUSEL_ITEMS_PER_SLOT = 3

// -----------------------------------------------------------------------------
// Archetype → slot manifest
// -----------------------------------------------------------------------------

type SlotAssignment = {
  /** Position in the final blocks[] array. */
  index: number
  layoutEntry: TemplateLayoutEntry
  archetype: ArchetypeName
  sectionKey: string
  /** Candidate ids allowed for this slot's videoId field (JSON Schema enum). */
  allowedVideoIds: number[]
  /** For carousels, multiple video assignments. */
  carouselSlotCount?: number
  /** Carousel slot allowed id pools (length === carouselSlotCount). */
  carouselAllowedVideoIds?: number[][]
  /** The primary candidate chosen for this slot (used for videoRef). */
  primaryCandidate: GeneratorCandidate
  /** For carousels, one candidate per carousel slot. */
  carouselCandidates?: GeneratorCandidate[]
}

/**
 * Greedy round-robin partition of candidates across the layout. Hero gets
 * candidate[0]; each non-hero VIDEO_CENTRIC gets one distinct candidate from
 * the remainder; carousels get `CAROUSEL_ITEMS_PER_SLOT` each.
 *
 * Unused candidates are not wasted — we still expose 3–5 ids as the enum for
 * each slot so the model has some freedom while staying bounded.
 */
function assignCandidates(
  themeSlug: string,
  candidates: GeneratorCandidate[],
): SlotAssignment[] {
  const slots: SlotAssignment[] = []
  let cursor = 0
  const take = (): GeneratorCandidate => {
    const pick = candidates[cursor % candidates.length]!
    cursor += 1
    return pick
  }

  const enumFor = (primary: GeneratorCandidate, extraCount = 4): number[] => {
    const ids = new Set<number>([primary.id])
    let probe = 0
    while (
      ids.size < Math.min(extraCount + 1, candidates.length) &&
      probe < candidates.length * 2
    ) {
      const c = candidates[probe % candidates.length]!
      ids.add(c.id)
      probe += 1
    }
    return [...ids]
  }

  EASTER_SHAPED_TEMPLATE_LAYOUT.forEach((entry, index) => {
    const sectionKey = buildSectionKey(themeSlug, entry.sectionKeySuffix)
    if (entry.archetype === "VIDEO_HERO") {
      const primary = candidates[0]!
      slots.push({
        index,
        layoutEntry: entry,
        archetype: entry.archetype,
        sectionKey,
        allowedVideoIds: enumFor(primary),
        primaryCandidate: primary,
      })
      // consume one position of the cursor so subsequent picks don't clash
      cursor = Math.max(cursor, 1)
      return
    }

    if (entry.archetype === "VIDEO_CAROUSEL") {
      const carouselCandidates: GeneratorCandidate[] = []
      const carouselAllowed: number[][] = []
      for (let i = 0; i < CAROUSEL_ITEMS_PER_SLOT; i++) {
        const pick = take()
        carouselCandidates.push(pick)
        carouselAllowed.push(enumFor(pick))
      }
      slots.push({
        index,
        layoutEntry: entry,
        archetype: entry.archetype,
        sectionKey,
        allowedVideoIds: enumFor(carouselCandidates[0]!),
        carouselSlotCount: CAROUSEL_ITEMS_PER_SLOT,
        carouselAllowedVideoIds: carouselAllowed,
        primaryCandidate: carouselCandidates[0]!,
        carouselCandidates,
      })
      return
    }

    // VIDEO_CENTRIC / INTRODUCTION / MEDIA_COLLECTION — single primary video
    const pick = take()
    slots.push({
      index,
      layoutEntry: entry,
      archetype: entry.archetype,
      sectionKey,
      allowedVideoIds: enumFor(pick),
      primaryCandidate: pick,
    })
  })

  return slots
}

// -----------------------------------------------------------------------------
// Dynamic JSON Schema builder
// -----------------------------------------------------------------------------

type JsonSchema = Record<string, unknown>

/**
 * Strict JSON schemas (additionalProperties: false everywhere) for each
 * archetype. `videoId` fields are constrained to an enum per slot so the
 * model cannot invent ids.
 */
function schemaForArchetype(slot: SlotAssignment): JsonSchema {
  const base: JsonSchema = {
    type: "object",
    additionalProperties: false,
  }

  switch (slot.archetype) {
    case "VIDEO_HERO":
      return {
        ...base,
        required: ["heading", "videoId"],
        properties: {
          heading: { type: "string" },
          subtitle: { type: "string" },
          ctaLabel: { type: "string" },
          ctaLink: { type: "string" },
          videoId: { type: "integer", enum: slot.allowedVideoIds },
        },
      }

    case "VIDEO_CENTRIC":
      return {
        ...base,
        required: [
          "heading",
          "videoTitle",
          "videoSubtitle",
          "videoId",
          "intro",
        ],
        properties: {
          heading: { type: "string" },
          intro: { type: "string" },
          videoTitle: { type: "string" },
          videoSubtitle: { type: "string" },
          videoId: { type: "integer", enum: slot.allowedVideoIds },
          quizButtonText: { type: "string" },
        },
      }

    case "VIDEO_CAROUSEL": {
      const itemsSchema = (slot.carouselAllowedVideoIds ?? []).map((ids) => ({
        type: "object",
        additionalProperties: false,
        required: ["title", "videoId"],
        properties: {
          title: { type: "string" },
          subtitle: { type: "string" },
          videoId: { type: "integer", enum: ids },
        },
      }))
      return {
        ...base,
        required: ["title", "items"],
        properties: {
          title: { type: "string" },
          subtitle: { type: "string" },
          description: { type: "string" },
          items: {
            type: "array",
            minItems: itemsSchema.length,
            maxItems: itemsSchema.length,
            prefixItems: itemsSchema,
            items: false,
          },
        },
      }
    }

    case "INTRODUCTION":
      return {
        ...base,
        required: ["heading", "intro", "videoId", "questions", "quotes"],
        properties: {
          heading: { type: "string" },
          intro: { type: "string" },
          videoTitle: { type: "string" },
          videoSubtitle: { type: "string" },
          videoId: { type: "integer", enum: slot.allowedVideoIds },
          questions: {
            type: "array",
            minItems: 2,
            maxItems: 5,
            items: {
              type: "object",
              additionalProperties: false,
              required: ["question", "answer"],
              properties: {
                question: { type: "string" },
                answer: { type: "string" },
              },
            },
          },
          quotes: {
            type: "array",
            minItems: 1,
            maxItems: 4,
            items: {
              type: "object",
              additionalProperties: false,
              required: ["reference", "text"],
              properties: {
                reference: { type: "string" },
                text: { type: "string" },
                attribution: { type: "string" },
              },
            },
          },
          quizButtonText: { type: "string" },
        },
      }

    case "MEDIA_COLLECTION":
      return {
        ...base,
        required: ["title", "videoId"],
        properties: {
          title: { type: "string" },
          subtitle: { type: "string" },
          description: { type: "string" },
          videoId: { type: "integer", enum: slot.allowedVideoIds },
          ctaLabel: { type: "string" },
          ctaLink: { type: "string" },
        },
      }

    default:
      return { ...base, properties: {} }
  }
}

function buildResponseSchema(slots: SlotAssignment[]): JsonSchema {
  const blocksSchema = slots.map(schemaForArchetype)
  return {
    type: "object",
    additionalProperties: false,
    required: ["title", "metaDescription", "blocks"],
    properties: {
      title: { type: "string" },
      metaDescription: { type: "string" },
      blocks: {
        type: "array",
        minItems: blocksSchema.length,
        maxItems: blocksSchema.length,
        prefixItems: blocksSchema,
        items: false,
      },
    },
  }
}

// -----------------------------------------------------------------------------
// Prompt
// -----------------------------------------------------------------------------

function formatCatalog(candidates: GeneratorCandidate[]): string {
  return candidates
    .map(
      (c, i) =>
        `[${i}] id=${c.id} title="${c.title}" slug="${c.slug}"` +
        (c.similarityScore != null
          ? ` similarity=${c.similarityScore.toFixed(3)}`
          : ""),
    )
    .join("\n")
}

function formatLayout(slots: SlotAssignment[]): string {
  return slots
    .map((s) => {
      const enumStr = s.carouselAllowedVideoIds
        ? `items=[${s.carouselAllowedVideoIds.map((ids) => `[${ids.join(",")}]`).join(", ")}]`
        : `videoId∈{${s.allowedVideoIds.join(",")}}`
      return `[${s.index}] ${s.archetype} (sectionKey="${s.sectionKey}", bg=${s.layoutEntry.backgroundColor ?? "default"}) ${enumStr}`
    })
    .join("\n")
}

function buildSystemPrompt(): string {
  return [
    "You are a content curator for JesusFilm, a Christian ministry.",
    "You compose themed experiences from an existing catalog of videos.",
    "",
    "RULES:",
    "- You MUST only choose videoId values from the enum allowed for each slot.",
    "- Never invent numeric ids. Never invent video metadata.",
    "- Fill every required field. Keep copy short, warm, and inviting.",
    "- Return JSON that matches the schema exactly. No prose, no code fences.",
  ].join("\n")
}

function buildUserPrompt(
  query: string,
  candidates: GeneratorCandidate[],
  slots: SlotAssignment[],
): string {
  return [
    `<query>${query}</query>`,
    "",
    "<catalog>",
    formatCatalog(candidates),
    "</catalog>",
    "",
    "<layout>",
    formatLayout(slots),
    "</layout>",
    "",
    "Return the JSON object matching the supplied schema. Use `blocks[i].videoId`",
    "values drawn only from the enum for that slot. Populate `items[]` for the",
    "carousel slots matching the given per-item enums. Populate `questions[]` and",
    "`quotes[]` for the INTRODUCTION block.",
  ].join("\n")
}

// -----------------------------------------------------------------------------
// HTTP call
// -----------------------------------------------------------------------------

async function callOpenRouter(
  model: string,
  systemPrompt: string,
  userPrompt: string,
  schema: JsonSchema,
  signal: AbortSignal,
): Promise<
  { ok: true; content: string } | { ok: false; status: number; body: string }
> {
  const apiKey = process.env.OPENROUTER_API_KEY
  const body = {
    model,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "experience",
        strict: true,
        schema,
      },
    },
    provider: { require_parameters: true },
    temperature: 0.4,
    max_tokens: 4000,
  }

  const response = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "http://localhost:3200",
      "X-Title": "Seed Studio",
    },
    body: JSON.stringify(body),
    signal,
  })

  if (!response.ok) {
    const text = await response.text().catch(() => "")
    return { ok: false, status: response.status, body: text }
  }

  const json = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>
  }
  const content = json.choices?.[0]?.message?.content
  if (typeof content !== "string" || content.length === 0) {
    return { ok: false, status: 502, body: "Upstream returned empty content" }
  }
  return { ok: true, content }
}

/**
 * Combine the caller's AbortSignal (if any) with a request-level timeout so a
 * hung OpenRouter response can't leak compute. Uses AbortSignal.any() —
 * available in Node 20+ / Next.js edge runtimes.
 */
function combineSignals(external?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  if (external == null) return timeout
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const anyFn = (AbortSignal as any).any as
    | ((signals: AbortSignal[]) => AbortSignal)
    | undefined
  if (typeof anyFn === "function") {
    return anyFn([external, timeout])
  }
  // Fallback — unify via a manual controller.
  const ctrl = new AbortController()
  const onAbort = () => ctrl.abort()
  external.addEventListener("abort", onAbort, { once: true })
  timeout.addEventListener("abort", onAbort, { once: true })
  return ctrl.signal
}

// -----------------------------------------------------------------------------
// Assemble the GeneratedExperience from the model's compressed JSON
// -----------------------------------------------------------------------------

type ModelBlock = {
  heading?: string
  intro?: string
  subtitle?: string
  videoTitle?: string
  videoSubtitle?: string
  videoId?: number
  ctaLabel?: string
  ctaLink?: string
  quizButtonText?: string
  title?: string
  description?: string
  items?: Array<{ title?: string; subtitle?: string; videoId?: number }>
  questions?: Array<{ question: string; answer: string }>
  quotes?: Array<{ reference: string; text: string; attribution?: string }>
}

type ModelPayload = {
  title: string
  metaDescription: string
  blocks: ModelBlock[]
}

function navigationTitleForSlot(
  slot: SlotAssignment,
  block: ModelBlock,
  primary: GeneratorCandidate,
): string {
  switch (slot.archetype) {
    case "VIDEO_CAROUSEL":
    case "MEDIA_COLLECTION":
      return block.title ?? primary.title
    case "VIDEO_CENTRIC":
    case "INTRODUCTION":
      return block.videoTitle ?? block.heading ?? primary.title
    case "VIDEO_HERO":
      return block.heading ?? primary.title
    default:
      return primary.title
  }
}

function navigationCategoryForSlot(slot: SlotAssignment): string {
  switch (slot.archetype) {
    case "VIDEO_CAROUSEL":
      return "Playlist"
    case "MEDIA_COLLECTION":
      return "Collection"
    default:
      return "Video"
  }
}

function buildIntroductionNavigationItems(
  candidates: GeneratorCandidate[],
  slots: SlotAssignment[],
  payload: ModelPayload,
  afterIndex: number,
): Array<{
  contentId: string
  title: string
  category: string
  imageUrl?: string
}> {
  return slots
    .filter((slot) => slot.index > afterIndex)
    .map((slot) => {
      const block = payload.blocks[slot.index] ?? ({} as ModelBlock)
      const primary = candidateById(
        candidates,
        block.videoId,
        slot.primaryCandidate,
      )

      return {
        contentId: slot.sectionKey,
        title: navigationTitleForSlot(slot, block, primary),
        category: navigationCategoryForSlot(slot),
        imageUrl: primary.thumbnailUrl,
      }
    })
}

function candidateById(
  candidates: GeneratorCandidate[],
  id: number | undefined,
  fallback: GeneratorCandidate,
): GeneratorCandidate {
  if (typeof id !== "number") return fallback
  return candidates.find((c) => c.id === id) ?? fallback
}

function toVideoRef(c: GeneratorCandidate): VideoRef {
  return {
    id: c.id,
    documentId: c.documentId,
    title: c.title,
    slug: c.slug,
    streamingUrl: c.streamingUrl,
    thumbnailUrl: c.thumbnailUrl,
  }
}

function assembleExperience(
  input: GenerateInput,
  slots: SlotAssignment[],
  payload: ModelPayload,
): GeneratedExperience {
  const candidates = input.candidates
  const themeSlug = input.themeSlug

  const blocks: GeneratedExperience["blocks"] = slots.map((slot, i) => {
    const block = payload.blocks[i] ?? ({} as ModelBlock)
    const primary = candidateById(
      candidates,
      block.videoId,
      slot.primaryCandidate,
    )
    const primaryRef = toVideoRef(primary)

    switch (slot.archetype) {
      case "VIDEO_HERO": {
        return {
          __component: "sections.video-hero",
          sectionKey: slot.sectionKey,
          streamingUrl: primary.streamingUrl,
          heading: block.heading ?? primary.title,
          ctaLabel: block.ctaLabel,
          ctaLink: block.ctaLink,
          videoRef: primaryRef,
        }
      }

      case "VIDEO_CENTRIC": {
        return {
          __component: "sections.section",
          sectionKey: slot.sectionKey,
          backgroundColor: slot.layoutEntry.backgroundColor,
          content: [
            {
              __component: "sections.video",
              sectionKey: `${slot.sectionKey}-video`,
              video: primary.id,
              streamingUrl: primary.streamingUrl,
              title: block.videoTitle ?? primary.title,
              subtitle: block.videoSubtitle ?? "",
              videoRef: primaryRef,
            },
            {
              __component: "sections.container",
              slots: [
                {
                  gridSpan: 12,
                  content: [
                    {
                      __component: "sections.text",
                      heading: block.heading ?? "",
                      contentParagraphs: block.intro ? [block.intro] : [],
                    },
                  ],
                },
              ],
            },
            {
              __component: "sections.quiz-button",
              buttonText: block.quizButtonText ?? "Take the quiz",
              iframeSrc: DEFAULT_QUIZ_IFRAME_SRC,
            },
          ],
        } as unknown as GeneratedExperience["blocks"][number]
      }

      case "VIDEO_CAROUSEL": {
        const rawItems = block.items ?? []
        const carouselCandidates = slot.carouselCandidates ?? []
        const items = rawItems.map((item, idx) => {
          const itemCandidate = candidateById(
            candidates,
            item.videoId,
            carouselCandidates[idx] ?? slot.primaryCandidate,
          )
          return {
            sectionKey: `${slot.sectionKey}-item-${idx}`,
            video: itemCandidate.id,
            streamingUrl: itemCandidate.streamingUrl,
            title: item.title ?? itemCandidate.title,
            subtitle: item.subtitle,
            videoRef: toVideoRef(itemCandidate),
          }
        })
        return {
          __component: "sections.section",
          sectionKey: slot.sectionKey,
          backgroundColor: slot.layoutEntry.backgroundColor,
          content: [
            {
              __component: "sections.video-carousel",
              sectionKey: `${slot.sectionKey}-carousel`,
              title: block.title ?? "Explore more",
              subtitle: block.subtitle,
              description: block.description,
              items,
            },
          ],
        } as unknown as GeneratedExperience["blocks"][number]
      }

      case "INTRODUCTION": {
        const navigationItems = buildIntroductionNavigationItems(
          candidates,
          slots,
          payload,
          slot.index,
        )

        return {
          __component: "sections.section",
          sectionKey: slot.sectionKey,
          backgroundColor: slot.layoutEntry.backgroundColor,
          content: [
            {
              __component: "sections.navigation-carousel",
              sectionKey: `${slot.sectionKey}-navigation`,
              items: navigationItems,
            },
            {
              __component: "sections.container",
              slots: [
                {
                  gridSpan: 12,
                  content: [
                    {
                      __component: "sections.text",
                      heading: block.heading ?? "",
                      contentParagraphs: block.intro ? [block.intro] : [],
                    },
                  ],
                },
              ],
            },
            {
              __component: "sections.video",
              sectionKey: `${slot.sectionKey}-video`,
              video: primary.id,
              streamingUrl: primary.streamingUrl,
              title: block.videoTitle ?? primary.title,
              subtitle: block.videoSubtitle ?? "",
              videoRef: primaryRef,
            },
            {
              __component: "sections.container",
              slots: [
                {
                  gridSpan: 12,
                  content: [
                    {
                      __component: "sections.related-questions",
                      heading: "Related questions",
                      questions: block.questions ?? [],
                    },
                  ],
                },
              ],
            },
            {
              __component: "sections.bible-quotes-carousel",
              sectionKey: `${slot.sectionKey}-quotes`,
              heading: "Scripture",
              quotes: (block.quotes ?? []).map((q) => ({
                reference: q.reference,
                text: q.text,
                attribution: q.attribution,
                imageUrl: "",
                backgroundColor: "#1e3a5f",
              })),
            },
            {
              __component: "sections.quiz-button",
              buttonText: block.quizButtonText ?? "Take the quiz",
              iframeSrc: DEFAULT_QUIZ_IFRAME_SRC,
            },
          ],
        } as unknown as GeneratedExperience["blocks"][number]
      }

      case "MEDIA_COLLECTION": {
        return {
          __component: "sections.section",
          sectionKey: slot.sectionKey,
          backgroundColor: slot.layoutEntry.backgroundColor,
          content: [
            {
              __component: "sections.media-collection",
              sectionKey: `${slot.sectionKey}-media`,
              variant: "carousel",
              title: block.title ?? "More to explore",
              subtitle: block.subtitle,
              description: block.description,
              ctaLabel: block.ctaLabel,
              ctaLink: block.ctaLink,
              items: [
                {
                  video: {
                    id: primary.id,
                    documentId: primary.documentId,
                    slug: primary.slug,
                  },
                },
              ],
            },
          ],
        } as unknown as GeneratedExperience["blocks"][number]
      }

      default:
        // Never reached — ARCHETYPE_SHAPES covers every case. Included to keep
        // the switch exhaustive for TS without an @ts-expect-error.
        void ARCHETYPE_SHAPES
        return {
          __component: "sections.video-hero",
          sectionKey: slot.sectionKey,
          streamingUrl: primary.streamingUrl,
          heading: primary.title,
          videoRef: primaryRef,
        }
    }
  })

  return {
    title: payload.title,
    slug: themeSlug,
    metaDescription: payload.metaDescription,
    blocks,
    platformOrdering: computePlatformOrdering(blocks.length),
  }
}

// -----------------------------------------------------------------------------
// Public entry point
// -----------------------------------------------------------------------------

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Aborted", "AbortError"))
      return
    }
    const t = setTimeout(resolve, ms)
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(t)
        reject(new DOMException("Aborted", "AbortError"))
      },
      { once: true },
    )
  })
}

function zodIssuePaths(error: {
  issues: Array<{ path: PropertyKey[]; message: string }>
}): string {
  return JSON.stringify(
    error.issues.slice(0, 8).map((i) => ({
      path: i.path.map((p) => String(p)),
      message: i.message,
    })),
  )
}

export async function generateExperience(
  input: GenerateInput,
): Promise<GenerateResult> {
  const apiKey = process.env.OPENROUTER_API_KEY
  if (!apiKey || apiKey.length === 0) {
    return {
      ok: false,
      error: {
        code: "NOT_CONFIGURED",
        message: "OPENROUTER_API_KEY is not set",
      },
    }
  }

  if (input.candidates.length < MIN_CANDIDATES) {
    return {
      ok: false,
      error: {
        code: "INSUFFICIENT_CANDIDATES",
        message: `Need at least ${MIN_CANDIDATES} candidate videos, got ${input.candidates.length}.`,
      },
    }
  }

  const slots = assignCandidates(input.themeSlug, input.candidates)
  const schema = buildResponseSchema(slots)
  const systemPrompt = buildSystemPrompt()
  let userPrompt = buildUserPrompt(input.query, input.candidates, slots)
  const combinedSignal = combineSignals(input.signal)

  // ---- First HTTP call (with one retry on 5xx / network) --------------------
  let upstream = await callOpenRouter(
    input.model,
    systemPrompt,
    userPrompt,
    schema,
    combinedSignal,
  ).catch((err: unknown) => ({
    ok: false as const,
    status: 0,
    body: err instanceof Error ? err.message : String(err),
  }))

  if (!upstream.ok && upstream.status >= 500) {
    try {
      await sleep(RETRY_DELAY_MS, combinedSignal)
    } catch {
      return {
        ok: false,
        error: { code: "ABORTED", message: "Request aborted before retry" },
      }
    }
    upstream = await callOpenRouter(
      input.model,
      systemPrompt,
      userPrompt,
      schema,
      combinedSignal,
    ).catch((err: unknown) => ({
      ok: false as const,
      status: 0,
      body: err instanceof Error ? err.message : String(err),
    }))
  }

  if (!upstream.ok) {
    if (combinedSignal.aborted) {
      return {
        ok: false,
        error: { code: "ABORTED", message: "Request aborted" },
      }
    }
    return {
      ok: false,
      error: {
        code: "UPSTREAM_ERROR",
        message: `OpenRouter returned ${upstream.status}: ${upstream.body.slice(0, 200)}`,
      },
    }
  }

  // ---- Parse + Zod validate (with one JSON-only retry) ---------------------
  const tryParse = (
    raw: string,
  ):
    | { ok: true; payload: ModelPayload; experience: GeneratedExperience }
    | { ok: false; reason: "not-json" | "schema"; details: string } => {
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch (err) {
      return {
        ok: false,
        reason: "not-json",
        details: err instanceof Error ? err.message : String(err),
      }
    }
    const assembled = assembleExperience(input, slots, parsed as ModelPayload)
    const zod = generatedExperienceSchema.safeParse(assembled)
    if (!zod.success) {
      return {
        ok: false,
        reason: "schema",
        details: zodIssuePaths(zod.error),
      }
    }
    return {
      ok: true,
      payload: parsed as ModelPayload,
      experience: zod.data as GeneratedExperience,
    }
  }

  let parseResult = tryParse(upstream.content)
  if (!parseResult.ok) {
    // Retry once with the validation error appended to the user message.
    userPrompt = `${userPrompt}\n\nPrevious response was invalid: ${parseResult.details}. Return only JSON matching the schema.`
    const retry = await callOpenRouter(
      input.model,
      systemPrompt,
      userPrompt,
      schema,
      combinedSignal,
    ).catch((err: unknown) => ({
      ok: false as const,
      status: 0,
      body: err instanceof Error ? err.message : String(err),
    }))

    if (!retry.ok) {
      if (combinedSignal.aborted) {
        return {
          ok: false,
          error: { code: "ABORTED", message: "Request aborted" },
        }
      }
      return {
        ok: false,
        error: {
          code: "UPSTREAM_ERROR",
          message: `OpenRouter returned ${retry.status}: ${retry.body.slice(0, 200)}`,
        },
      }
    }
    parseResult = tryParse(retry.content)
  }

  if (!parseResult.ok) {
    return {
      ok: false,
      error: {
        code: "SCHEMA_MISMATCH",
        message:
          parseResult.reason === "not-json"
            ? "Response was not valid JSON"
            : "Response did not match the expected schema",
        details: parseResult.details,
      },
    }
  }

  return { ok: true, experience: parseResult.experience }
}
