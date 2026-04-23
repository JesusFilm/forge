"use client"

import { useState, useCallback, useRef } from "react"
import {
  COMPONENT_ALIASES,
  generatedExperienceSchema,
  normalizeComponent,
} from "@forge/experience-templates"
import type {
  ChatMessage,
  GeneratedExperience,
} from "@/lib/ai/experience-schema"
import { DEFAULT_PROVIDER, type AIProvider } from "@/lib/ai/providers"

// Re-export to preserve existing `import { COMPONENT_ALIASES } from ".../use-chat"`
// call sites, should any exist. The local copy is removed — `COMPONENT_ALIASES`
// now lives in @forge/experience-templates.
export { COMPONENT_ALIASES }

/**
 * SSE events emitted by /api/chat. Two streams coexist:
 *
 * - Legacy "chunk" events: free-form text deltas from Claude CLI / Codex /
 *   Ollama / Gemini / Exo. Concatenated and parsed once the stream closes.
 * - Strict "patch" events: a single structured payload from the OpenRouter
 *   strict-JSON-Schema generator. Shape `{ path: string[], value: unknown }`.
 *
 * Any unknown event type is ignored so clients survive a server upgrade
 * without crashing.
 */
type SSEEvent =
  | { type: "chunk"; text: string }
  | { type: "status"; text: string }
  | { type: "done"; code: number }
  | { type: "error"; text: string }

type PatchEvent = {
  path: string[]
  value: unknown
}

type CatalogVideo = {
  id: number
  documentId: string
  title: string
  slug: string
  streamingUrl: string
  thumbnailUrl?: string
}

type ExtractedExperienceResult = {
  experience?: GeneratedExperience
  error?: string
}

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

function canonicalComponent(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined
  return normalizeComponent(raw) ?? undefined
}

function normalizeBlock(
  block: Record<string, unknown>,
): Record<string, unknown> | undefined {
  const rawComponent =
    block.__component ?? block.type ?? block.component ?? block.kind
  const component = canonicalComponent(rawComponent)
  if (!component) return undefined

  const out: Record<string, unknown> = { ...block, __component: component }
  delete out.type
  delete out.component
  delete out.kind

  // heading aliases for sections that need a heading field
  if (
    !out.heading &&
    typeof out.title === "string" &&
    (component === "sections.video-hero" ||
      component === "sections.related-questions" ||
      component === "sections.bible-quotes-carousel")
  ) {
    out.heading = out.title
  }

  // contentParagraphs aliases for text sections
  if (component === "sections.text") {
    if (!Array.isArray(out.contentParagraphs)) {
      if (Array.isArray(out.paragraphs)) {
        out.contentParagraphs = out.paragraphs
      } else if (typeof out.content === "string") {
        out.contentParagraphs = [out.content]
      } else if (typeof out.body === "string") {
        out.contentParagraphs = [out.body]
      } else {
        out.contentParagraphs = []
      }
    }
  }

  // video sections: copy videoRef.streamingUrl / thumbnailUrl to top level if missing
  const videoRef = out.videoRef as Record<string, unknown> | undefined
  if (videoRef && typeof videoRef === "object") {
    if (!out.streamingUrl && typeof videoRef.streamingUrl === "string") {
      out.streamingUrl = videoRef.streamingUrl
    }
  }

  // related-questions: coerce each entry to { question, answer } strings
  if (
    component === "sections.related-questions" &&
    Array.isArray(out.questions)
  ) {
    out.questions = (out.questions as unknown[])
      .map((q) => {
        if (typeof q === "string") return { question: q, answer: "" }
        if (q && typeof q === "object") {
          const obj = q as Record<string, unknown>
          const question =
            (typeof obj.question === "string" && obj.question) ||
            (typeof obj.q === "string" && obj.q) ||
            (typeof obj.title === "string" && obj.title) ||
            ""
          const answer =
            (typeof obj.answer === "string" && obj.answer) ||
            (typeof obj.a === "string" && obj.a) ||
            (typeof obj.response === "string" && obj.response) ||
            ""
          return question ? { question, answer } : undefined
        }
        return undefined
      })
      .filter(Boolean)
  }

  return out
}

function normalizeBlocks(
  blocks: Array<Record<string, unknown>>,
): GeneratedExperience["blocks"] {
  return blocks
    .map(normalizeBlock)
    .filter((b): b is Record<string, unknown> =>
      Boolean(b),
    ) as unknown as GeneratedExperience["blocks"]
}

function unwrapExperience(
  parsed: Record<string, unknown>,
): Record<string, unknown> {
  const WRAPPERS = ["experience", "data", "result", "output"]
  for (const key of WRAPPERS) {
    const inner = parsed[key]
    if (
      inner &&
      typeof inner === "object" &&
      !Array.isArray(inner) &&
      Object.keys(parsed).length === 1
    ) {
      return unwrapExperience(inner as Record<string, unknown>)
    }
  }
  return parsed
}

function normalizeStreamingUrl(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

function toVideoRef(video: CatalogVideo): Record<string, unknown> {
  return {
    id: video.id,
    documentId: video.documentId,
    title: video.title,
    slug: video.slug,
    streamingUrl: video.streamingUrl,
    ...(video.thumbnailUrl ? { thumbnailUrl: video.thumbnailUrl } : {}),
  }
}

function buildCatalogLookups(catalog: CatalogVideo[]) {
  const byId = new Map<number, CatalogVideo>()
  const byDocumentId = new Map<string, CatalogVideo>()
  const bySlug = new Map<string, CatalogVideo>()
  const byStreamingUrl = new Map<string, CatalogVideo>()

  for (const video of catalog) {
    byId.set(video.id, video)
    byDocumentId.set(video.documentId, video)
    bySlug.set(video.slug.toLowerCase(), video)
    byStreamingUrl.set(video.streamingUrl, video)
  }

  return { byId, byDocumentId, bySlug, byStreamingUrl }
}

function matchCatalogVideo(
  node: Record<string, unknown>,
  lookups: ReturnType<typeof buildCatalogLookups>,
): CatalogVideo | undefined {
  const videoRef =
    node.videoRef && typeof node.videoRef === "object"
      ? (node.videoRef as Record<string, unknown>)
      : undefined

  const numericIds = [node.video, videoRef?.id]
  for (const rawId of numericIds) {
    if (typeof rawId === "number") {
      const match = lookups.byId.get(rawId)
      if (match) return match
    }
  }

  const documentIds = [videoRef?.documentId]
  for (const rawDocumentId of documentIds) {
    if (typeof rawDocumentId === "string") {
      const match = lookups.byDocumentId.get(rawDocumentId.trim())
      if (match) return match
    }
  }

  const slugs = [node.slug, videoRef?.slug]
  for (const rawSlug of slugs) {
    if (typeof rawSlug === "string") {
      const match = lookups.bySlug.get(rawSlug.trim().toLowerCase())
      if (match) return match
    }
  }

  const streamingUrls = [node.streamingUrl, videoRef?.streamingUrl]
  for (const rawStreamingUrl of streamingUrls) {
    const normalized = normalizeStreamingUrl(rawStreamingUrl)
    if (!normalized) continue
    const match = lookups.byStreamingUrl.get(normalized)
    if (match) return match
  }

  return undefined
}

function pathString(path: Array<string | number>): string {
  if (path.length === 0) return "experience"

  return path
    .map((part, index) =>
      typeof part === "number" ? `[${part}]` : index === 0 ? part : `.${part}`,
    )
    .join("")
}

function reconcileExperienceWithCatalog(
  candidate: Record<string, unknown>,
  catalog: CatalogVideo[],
): ExtractedExperienceResult {
  if (catalog.length === 0) {
    return {
      error:
        "No Strapi videos matched this query. Refine the theme instead of using external videos.",
    }
  }

  const lookups = buildCatalogLookups(catalog)
  let mismatchPath: string | undefined

  const visit = (node: unknown, path: Array<string | number>): boolean => {
    if (!node || typeof node !== "object") return true

    if (Array.isArray(node)) {
      for (const [index, child] of node.entries()) {
        if (!visit(child, [...path, index])) return false
      }
      return true
    }

    const obj = node as Record<string, unknown>
    const rawComponent =
      obj.__component ?? obj.type ?? obj.component ?? obj.kind
    const component = canonicalComponent(rawComponent)
    if (component) {
      obj.__component = component
      delete obj.type
      delete obj.component
      delete obj.kind
    }

    if (component === "sections.video" || component === "sections.video-hero") {
      const match = matchCatalogVideo(obj, lookups)
      if (!match) {
        mismatchPath = pathString(path)
        return false
      }
      if (component === "sections.video") {
        obj.video = match.id
      }
      obj.streamingUrl = match.streamingUrl
      obj.videoRef = toVideoRef(match)
    }

    if (component === "sections.video-carousel" && Array.isArray(obj.items)) {
      for (const [index, rawItem] of obj.items.entries()) {
        if (!rawItem || typeof rawItem !== "object") continue
        const item = rawItem as Record<string, unknown>
        const match = matchCatalogVideo(item, lookups)
        if (!match) {
          mismatchPath = pathString([...path, "items", index])
          return false
        }
        item.video = match.id
        item.streamingUrl = match.streamingUrl
        item.videoRef = toVideoRef(match)
      }
    }

    if (
      Array.isArray(obj.content) &&
      !visit(obj.content, [...path, "content"])
    ) {
      return false
    }

    if (Array.isArray(obj.slots)) {
      for (const [index, rawSlot] of obj.slots.entries()) {
        if (!rawSlot || typeof rawSlot !== "object") continue
        const slot = rawSlot as Record<string, unknown>
        if (
          Array.isArray(slot.content) &&
          !visit(slot.content, [...path, "slots", index, "content"])
        ) {
          return false
        }
      }
    }

    if (Array.isArray(obj.blocks) && !visit(obj.blocks, [...path, "blocks"])) {
      return false
    }

    return true
  }

  if (!visit(candidate.blocks, ["blocks"])) {
    return {
      error: mismatchPath
        ? `Generated experience referenced a video outside the Strapi catalog at ${mismatchPath}.`
        : "Generated experience referenced a video outside the Strapi catalog.",
    }
  }

  return { experience: candidate as GeneratedExperience }
}

/**
 * Deterministically backfill missing sectionKey on video-shaped nodes.
 *
 * The CMS publish path keys nested `sections.video` relation repair by
 * sectionKey, and deterministic keys also keep generated trees stable for
 * preview/parity work. We walk the whole tree (top-level blocks,
 * `sections.section.content[]`, `sections.container.slots[].content[]`, and
 * `sections.video-carousel.items`) assigning `${slug}-video-${i}` keys as a
 * fallback.
 *
 * Runs mutating because the tree comes from JSON.parse and has no shared
 * references that would make mutation unsafe.
 */
function backfillSectionKeys(
  experience: GeneratedExperience,
): GeneratedExperience {
  const slug = experience.slug || "experience"
  let counter = 0
  const nextKey = () => `${slug}-video-${counter++}`

  const visit = (node: unknown): void => {
    if (!node || typeof node !== "object") return
    if (Array.isArray(node)) {
      for (const child of node) visit(child)
      return
    }
    const obj = node as Record<string, unknown>
    const component = typeof obj.__component === "string" ? obj.__component : ""

    if (component === "sections.video" || component === "sections.video-hero") {
      if (typeof obj.sectionKey !== "string" || obj.sectionKey.length === 0) {
        obj.sectionKey = nextKey()
      }
    }

    // Carousel items carry sectionKey but not __component
    if (component === "sections.video-carousel" && Array.isArray(obj.items)) {
      for (const item of obj.items as Array<Record<string, unknown>>) {
        if (
          item &&
          typeof item === "object" &&
          (typeof item.sectionKey !== "string" || item.sectionKey.length === 0)
        ) {
          item.sectionKey = nextKey()
        }
      }
    }

    // Recurse into known container shapes
    if (Array.isArray(obj.content)) visit(obj.content)
    if (Array.isArray(obj.slots)) {
      for (const slot of obj.slots as Array<Record<string, unknown>>) {
        if (slot && typeof slot === "object" && Array.isArray(slot.content)) {
          visit(slot.content)
        }
      }
    }
    if (Array.isArray(obj.blocks)) visit(obj.blocks)
  }

  visit(experience.blocks)
  return experience
}

/**
 * Validate the parsed object against the shared Zod schema. On failure, log
 * the Zod issues (never the raw user input — see
 * docs/solutions/security-issues/zod-validation-errors-must-not-echo-user-
 * controlled-input-20260420.md) and return the best-effort object anyway so
 * partial previews still render during dev.
 */
function validateExperience(
  candidate: Record<string, unknown>,
): GeneratedExperience | undefined {
  const result = generatedExperienceSchema.safeParse(candidate)
  if (result.success) {
    return result.data as GeneratedExperience
  }
  // Log the Zod issue paths only — echoing the raw input would bounce
  // user-controlled data back to client logs and any error reporter.
  const issues = result.error.issues.map((i) => ({
    path: i.path,
    message: i.message,
    code: i.code,
  }))

  console.warn("[use-chat] generatedExperienceSchema validation failed", issues)
  // Best-effort fall-through: return the candidate as a partial experience so
  // the preview pane still renders something useful while the model retries.
  return candidate as unknown as GeneratedExperience
}

function parseExperienceJson(
  json: string,
  catalog: CatalogVideo[] = [],
): ExtractedExperienceResult {
  try {
    const raw = JSON.parse(json) as Record<string, unknown>
    const parsed = unwrapExperience(raw)
    const blocksRaw = (parsed.blocks ?? parsed.sections ?? parsed.pages) as
      | Array<Record<string, unknown>>
      | undefined
    if (!Array.isArray(blocksRaw)) return {}
    const blocks = normalizeBlocks(blocksRaw)
    if (blocks.length === 0) return {}
    const title =
      (typeof parsed.title === "string" && parsed.title) ||
      (typeof parsed.name === "string" && parsed.name) ||
      "Untitled Experience"
    const slug =
      (typeof parsed.slug === "string" && parsed.slug) ||
      (typeof title === "string" &&
        title
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-|-$/g, "")) ||
      "experience"
    const metaDescription =
      (typeof parsed.metaDescription === "string" && parsed.metaDescription) ||
      (typeof parsed.description === "string" && parsed.description) ||
      undefined

    const candidate: Record<string, unknown> = {
      ...parsed,
      title,
      slug,
      metaDescription,
      blocks,
    }
    const reconciled =
      catalog.length > 0
        ? reconcileExperienceWithCatalog(candidate, catalog)
        : { experience: candidate as GeneratedExperience }
    if (!reconciled.experience) return reconciled

    const validated = validateExperience(
      reconciled.experience as Record<string, unknown>,
    )
    if (!validated) return {}
    return { experience: backfillSectionKeys(validated) }
  } catch {
    return {}
  }
}

/** Find the outermost balanced JSON object starting from a { */
function extractBalancedJson(
  text: string,
  startIdx: number,
): string | undefined {
  let depth = 0
  let inString = false
  let escape = false
  for (let i = startIdx; i < text.length; i++) {
    const ch = text[i]
    if (escape) {
      escape = false
      continue
    }
    if (ch === "\\") {
      escape = true
      continue
    }
    if (ch === '"' && !escape) {
      inString = !inString
      continue
    }
    if (inString) continue
    if (ch === "{") depth++
    if (ch === "}") {
      depth--
      if (depth === 0) return text.slice(startIdx, i + 1)
    }
  }
  return undefined
}

function findRawExperienceJson(text: string): string | undefined {
  // Find { that likely starts an experience object (contains "title" nearby)
  let idx = 0
  while (idx < text.length) {
    const braceIdx = text.indexOf("{", idx)
    if (braceIdx === -1) break
    const json = extractBalancedJson(text, braceIdx)
    if (
      json &&
      json.includes('"title"') &&
      (json.includes('"blocks"') || json.includes('"sections"'))
    ) {
      return json
    }
    idx = braceIdx + 1
  }
  return undefined
}

function extractExperience(
  text: string,
  catalog: CatalogVideo[] = [],
): ExtractedExperienceResult {
  // Try ```experience ... ``` first
  const fenced = text.match(/```experience\n([\s\S]*?)\n```/)
  if (fenced) {
    const result = parseExperienceJson(fenced[1], catalog)
    if (result.experience || result.error) return result
  }

  // Try ```json ... ``` blocks
  const jsonBlock = text.match(/```json\n([\s\S]*?)\n```/)
  if (jsonBlock) {
    const result = parseExperienceJson(jsonBlock[1], catalog)
    if (result.experience || result.error) return result
  }

  // Try raw JSON with bracket counting
  const rawJson = findRawExperienceJson(text)
  if (rawJson) {
    return parseExperienceJson(rawJson, catalog)
  }

  return {}
}

function coerceSuggestion(raw: unknown): string | undefined {
  if (typeof raw === "string") {
    const s = raw.trim()
    return s.length > 0 ? s : undefined
  }
  if (raw && typeof raw === "object") {
    const obj = raw as Record<string, unknown>
    for (const key of [
      "text",
      "label",
      "title",
      "suggestion",
      "content",
      "prompt",
    ]) {
      const v = obj[key]
      if (typeof v === "string" && v.trim().length > 0) return v.trim()
    }
  }
  return undefined
}

function normalizeSuggestions(arr: unknown): string[] {
  if (!Array.isArray(arr)) return []
  return arr
    .map(coerceSuggestion)
    .filter((s): s is string => typeof s === "string")
    .slice(0, 6)
}

function extractSuggestions(text: string): string[] {
  const defaults = ["Add more sections", "Change the theme", "Publish"]

  // Try ```suggestions ... ```
  const fenced = text.match(/```suggestions\n([\s\S]*?)\n```/)
  if (fenced) {
    try {
      const normalized = normalizeSuggestions(JSON.parse(fenced[1]))
      if (normalized.length > 0) return normalized
    } catch {
      // fall through
    }
  }

  // Try "suggestions": [...] inside JSON
  const inJson = text.match(/"suggestions"\s*:\s*\[([\s\S]*?)\]/)
  if (inJson) {
    try {
      const normalized = normalizeSuggestions(JSON.parse(`[${inJson[1]}]`))
      if (normalized.length > 0) return normalized
    } catch {
      // fall through
    }
  }

  return defaults
}

function cleanMessage(text: string): string {
  // Remove fenced code blocks
  let cleaned = text
    .replace(/```experience\n[\s\S]*?\n```/g, "")
    .replace(/```json\n[\s\S]*?\n```/g, "")
    .replace(/```suggestions\n[\s\S]*?\n```/g, "")

  // Remove raw JSON experience object
  const rawJson = findRawExperienceJson(cleaned)
  if (rawJson) {
    cleaned = cleaned.replace(rawJson, "")
  }

  return cleaned.trim()
}

function extractCodexVisibleMessage(text: string): string {
  const rolePattern = /(?:^|\n)codex\r?\n/gi
  let match: RegExpExecArray | null
  let bodyStart = -1

  while ((match = rolePattern.exec(text)) !== null) {
    bodyStart = match.index + match[0].length
  }

  if (bodyStart === -1) return ""

  let body = text.slice(bodyStart)
  const tokensUsed = body.search(/\n+tokens used\r?\n/i)
  if (tokensUsed !== -1) {
    body = body.slice(0, tokensUsed)
  }

  const cleaned = cleanMessage(body)
  if (
    cleaned.includes("<query>") ||
    cleaned.includes("<catalog>") ||
    cleaned.includes("OpenAI Codex") ||
    cleaned.includes("User:")
  ) {
    return ""
  }

  return cleaned
}

function getVisibleAssistantMessage(
  text: string,
  provider: AIProvider,
  opts?: { streaming?: boolean },
): string {
  if (provider === "codex") {
    if (opts?.streaming) {
      return ""
    }
    return extractCodexVisibleMessage(text)
  }
  return cleanMessage(text)
}

export function useChat(
  provider: AIProvider = DEFAULT_PROVIDER,
  model?: string,
) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [experience, setExperience] = useState<GeneratedExperience | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [streamingText, setStreamingText] = useState("")
  const [statusText, setStatusText] = useState("")
  const abortRef = useRef<AbortController | null>(null)
  const sendingRef = useRef(false)

  const sendMessage = useCallback(
    async (content: string) => {
      if (sendingRef.current) return
      sendingRef.current = true

      setError(null)
      setStreamingText("")
      setStatusText(`Connecting to ${provider}...`)

      const userMessage: ChatMessage = {
        id: generateId(),
        role: "user",
        content,
      }
      setMessages((prev) => [...prev, userMessage])
      setIsLoading(true)

      abortRef.current = new AbortController()
      let fullText = ""
      let currentCatalog: CatalogVideo[] = []
      let strictExperience: GeneratedExperience | undefined
      let strictError: string | undefined

      try {
        const response = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            messages,
            userMessage: content,
            provider,
            model,
          }),
          signal: abortRef.current.signal,
        })
        if (!response.ok || !response.body) {
          throw new Error(`Request failed: ${response.status}`)
        }

        setStatusText(`${provider} is thinking...`)

        const reader = response.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ""
        let pendingEvent: string | undefined

        while (true) {
          const { done, value } = await reader.read()
          if (done) break

          buffer += decoder.decode(value, { stream: true })
          const frames = buffer.split("\n\n")
          buffer = frames.pop() ?? ""

          for (const frame of frames) {
            // Parse SSE frame — an event name line and/or a data line.
            let eventName: string | undefined
            let dataLine: string | undefined
            for (const rawLine of frame.split("\n")) {
              if (rawLine.startsWith(":")) continue // comment / heartbeat
              if (rawLine.startsWith("event: ")) {
                eventName = rawLine.slice(7).trim()
              } else if (rawLine.startsWith("data: ")) {
                // Multi-line data: concatenate per SSE spec.
                const chunk = rawLine.slice(6)
                dataLine =
                  dataLine === undefined ? chunk : `${dataLine}\n${chunk}`
              }
            }

            if (dataLine === undefined) continue
            if (eventName === undefined && pendingEvent !== undefined) {
              eventName = pendingEvent
              pendingEvent = undefined
            }

            // Strict-JSON-Schema path: server emits `event: patch` + JSON body.
            if (eventName === "patch") {
              let patch: PatchEvent | undefined
              try {
                patch = JSON.parse(dataLine) as PatchEvent
              } catch {
                continue
              }
              if (!patch || !Array.isArray(patch.path)) continue
              const [head] = patch.path
              if (head === "catalog") {
                if (Array.isArray(patch.value)) {
                  currentCatalog = patch.value.filter(
                    (video): video is CatalogVideo =>
                      Boolean(video) &&
                      typeof video === "object" &&
                      typeof (video as CatalogVideo).id === "number" &&
                      typeof (video as CatalogVideo).documentId === "string" &&
                      typeof (video as CatalogVideo).title === "string" &&
                      typeof (video as CatalogVideo).slug === "string" &&
                      typeof (video as CatalogVideo).streamingUrl === "string",
                  )
                }
              } else if (head === "experience") {
                // The generator already ran Zod validation + sectionKey
                // backfill, but we defensively re-run here so a misbehaving
                // provider can't bypass it.
                const candidate = patch.value as Record<string, unknown>
                const validated = validateExperience(candidate)
                if (validated) {
                  strictExperience = backfillSectionKeys(validated)
                  setExperience(strictExperience)
                  setStatusText("")
                }
              } else if (head === "error") {
                const err = patch.value as { code?: string; message?: string }
                strictError = err.message ?? "Generator failed"
              }
              continue
            }

            if (eventName === "done") {
              // Stream will close naturally; nothing to do per-event.
              continue
            }

            // Legacy path: default event name, JSON body with `type` field.
            let event: SSEEvent
            try {
              event = JSON.parse(dataLine) as SSEEvent
            } catch {
              continue
            }

            if (event.type === "chunk") {
              fullText += event.text
              const visibleText = getVisibleAssistantMessage(
                fullText,
                provider,
                {
                  streaming: true,
                },
              )
              setStreamingText(visibleText)
              setStatusText(
                visibleText.length > 0
                  ? ""
                  : `Using ${provider} (${model ?? "default"})...`,
              )

              // Try to extract experience as it streams in
              const parsed = extractExperience(fullText, currentCatalog)
              if (parsed.experience) {
                setExperience(parsed.experience)
              }
            } else if (event.type === "status") {
              if (event.text) setStatusText(event.text)
            } else if (event.type === "error") {
              throw new Error(event.text)
            }
            // "done" is handled by the loop ending
          }
        }

        if (strictError) {
          throw new Error(strictError)
        }

        // Finalize the assistant message. Prefer strict-path experience when
        // present (it already ran through Zod). Fall back to the legacy
        // free-form extractor.
        const parsedExperience = strictExperience
          ? ({
              experience: strictExperience,
            } satisfies ExtractedExperienceResult)
          : extractExperience(fullText, currentCatalog)
        if (parsedExperience.error) {
          throw new Error(parsedExperience.error)
        }
        const exp = parsedExperience.experience
        const suggestions = extractSuggestions(fullText)
        const cleanText = getVisibleAssistantMessage(fullText, provider)
        const fallbackContent =
          provider === "codex" && !exp
            ? "Generation finished. Refine the theme and try again."
            : "Experience generated! Check the preview panel."

        const assistantMessage: ChatMessage = {
          id: generateId(),
          role: "assistant",
          content: cleanText || fallbackContent,
          experienceSnapshot: exp,
          suggestions,
        }

        setMessages((prev) => [...prev, assistantMessage])
        if (exp) setExperience(exp)
      } catch (err) {
        if ((err as Error).name !== "AbortError") {
          const msg =
            err instanceof Error ? err.message : "Failed to send message"
          setError(msg)
        }
      } finally {
        setIsLoading(false)
        setStreamingText("")
        setStatusText("")
        abortRef.current = null
        sendingRef.current = false
      }
    },
    [messages, provider, model],
  )

  const stopGenerating = useCallback(() => {
    abortRef.current?.abort()
  }, [])

  const clearChat = useCallback(() => {
    abortRef.current?.abort()
    setMessages([])
    setExperience(null)
    setError(null)
    setStreamingText("")
    setStatusText("")
  }, [])

  return {
    messages,
    experience,
    isLoading,
    error,
    streamingText,
    statusText,
    sendMessage,
    stopGenerating,
    clearChat,
  } as const
}
