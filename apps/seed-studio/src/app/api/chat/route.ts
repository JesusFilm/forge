import { spawn } from "node:child_process"
import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"

import type { ChatMessage } from "@/lib/ai/experience-schema"
import {
  generateExperience,
  type GeneratorCandidate,
} from "@/lib/ai/generator.server"
import {
  DEFAULT_MODELS,
  SUPPORTS_STRICT_JSON_SCHEMA,
  type AIProvider,
} from "@/lib/ai/providers"

// -----------------------------------------------------------------------------
// Video catalog: single /api/search call per request
// -----------------------------------------------------------------------------

type SearchVideo = {
  id: number
  documentId: string
  title: string
  slug: string
  streamingUrl: string | null
  thumbnailUrl: string | null
}

type VideoForPrompt = {
  id: number
  documentId: string
  title: string
  slug: string
  streamingUrl: string
  thumbnailUrl?: string
}

const SEARCH_DEFAULT_LOCALE = "en"
const SEARCH_LIMIT = 20

/**
 * Call the CMS seed-studio search endpoint which returns fully-resolved
 * video rows (streamingUrl + documentId) in one hop. We tried the public
 * `/api/search` briefly — it exposes `playbackId` only on scene rows, not on
 * video summaries, so every candidate had no streaming URL and the chat
 * rejected every theme. The seed-studio endpoint already handles locale +
 * ILIKE + streaming-url enrichment and is the right boundary.
 */
const SEARCH_STOP_WORDS = new Set([
  "a",
  "an",
  "the",
  "about",
  "for",
  "with",
  "and",
  "or",
  "but",
  "in",
  "on",
  "of",
  "to",
  "is",
  "it",
  "that",
  "this",
  "was",
  "are",
  "be",
  "been",
  "being",
  "have",
  "has",
  "had",
  "do",
  "does",
  "did",
  "will",
  "would",
  "could",
  "should",
  "may",
  "might",
  "can",
  "shall",
  "create",
  "make",
  "build",
  "generate",
  "new",
  "experience",
  "theme",
  "exploring",
  "explore",
  "through",
  "stories",
  "story",
  "scripture",
  "scriptures",
  "verses",
  "verse",
  "families",
  "children",
  "people",
])

function extractSearchKeywords(query: string): string[] {
  return Array.from(
    new Set(
      query
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, " ")
        .split(/\s+/)
        .filter((w) => w.length > 2 && !SEARCH_STOP_WORDS.has(w)),
    ),
  )
}

async function searchVideosOnce(
  query: string,
  signal?: AbortSignal,
): Promise<SearchVideo[]> {
  const strapiUrl = process.env.STRAPI_URL ?? "http://localhost:1337"
  const token = process.env.STRAPI_SEED_STUDIO_TOKEN ?? ""
  try {
    const response = await fetch(`${strapiUrl}/api/seed-studio/search-videos`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Seed-Studio-Token": token,
      },
      body: JSON.stringify({ query, locale: SEARCH_DEFAULT_LOCALE }),
      signal,
    })
    if (!response.ok) return []
    const payload = (await response.json().catch(() => null)) as {
      videos?: SearchVideo[]
    } | null
    return payload?.videos ?? []
  } catch {
    return []
  }
}

async function fetchCandidateVideos(
  query: string,
  signal?: AbortSignal,
): Promise<VideoForPrompt[]> {
  // The CMS search uses ILIKE on the whole query string. A free-form theme
  // like "Exploring forgiveness through stories and scripture" never matches
  // a video title verbatim, so we fan out across extracted keywords and
  // fuse the results. Dedup by video id.
  const keywords = extractSearchKeywords(query)
  const probes = keywords.length > 0 ? keywords.slice(0, 4) : [query]

  const results = await Promise.all(
    probes.map((kw) => searchVideosOnce(kw, signal)),
  )

  const seen = new Map<number, VideoForPrompt>()
  for (const batch of results) {
    for (const v of batch) {
      if (!v.streamingUrl) continue
      if (seen.has(v.id)) continue
      seen.set(v.id, {
        id: v.id,
        documentId: v.documentId,
        title: v.title,
        slug: v.slug,
        streamingUrl: v.streamingUrl,
        thumbnailUrl: v.thumbnailUrl ?? undefined,
      })
      if (seen.size >= SEARCH_LIMIT) break
    }
    if (seen.size >= SEARCH_LIMIT) break
  }
  return [...seen.values()]
}

// -----------------------------------------------------------------------------
// Legacy free-form prompt (kept for non-strict providers)
// -----------------------------------------------------------------------------

function formatVideoCatalog(videos: VideoForPrompt[]): string {
  if (videos.length === 0) {
    return "No videos found in the Strapi catalog for this theme. Do NOT invent or use placeholder/external video URLs. Ask the user to refine the theme instead."
  }
  return videos
    .map(
      (v) =>
        `- id: ${v.id} | "${v.title}" | streamingUrl: ${v.streamingUrl} | thumbnailUrl: ${v.thumbnailUrl ?? "none"} | slug: ${v.slug} | documentId: ${v.documentId}`,
    )
    .join("\n")
}

function buildPrompt(
  history: ChatMessage[],
  userMessage: string,
  videos: VideoForPrompt[],
): string {
  const videoCatalog = formatVideoCatalog(videos)

  const systemContext = `You are the Seed Studio Assistant — an expert at creating themed Christian experiences for JesusFilm.

## Available Videos from Strapi Catalog
${videoCatalog}

IMPORTANT RULES:
- You MUST pick videos from the catalog above. Do NOT invent streaming URLs or use external video URLs.
- If the catalog above is empty or not relevant enough, ask the user to refine the theme. Do not generate an experience with fallback or placeholder videos.
- For every video section, include a "videoRef" object with the real id, documentId, title, slug, streamingUrl, and thumbnailUrl from the catalog.
- Text content (headings, paragraphs, bible quotes, Q&A) should be AI-generated to match the theme.
- For bible quote imageUrl fields, use real Unsplash photo URLs (https://images.unsplash.com/photo-...) that match the quote mood.

When asked to create an experience, you MUST include a JSON code block with the complete experience data in this exact format:

\`\`\`experience
{
  "title": "Experience Title",
  "slug": "experience-slug",
  "metaDescription": "Brief description",
  "blocks": [
    {
      "__component": "sections.video-hero",
      "sectionKey": "hero/english",
      "streamingUrl": "REAL_URL_FROM_CATALOG",
      "heading": "Hero Heading",
      "videoRef": {
        "id": 123,
        "documentId": "abc123",
        "title": "Real Video Title",
        "slug": "real-video-slug",
        "streamingUrl": "REAL_URL_FROM_CATALOG",
        "thumbnailUrl": "REAL_THUMBNAIL_FROM_CATALOG"
      }
    },
    {
      "__component": "sections.text",
      "heading": "Section Heading",
      "contentParagraphs": ["Paragraph 1", "Paragraph 2"]
    },
    {
      "__component": "sections.video",
      "sectionKey": "video-1/english",
      "video": 123,
      "streamingUrl": "REAL_URL_FROM_CATALOG",
      "title": "Video Title",
      "subtitle": "Video Subtitle",
      "videoRef": {
        "id": 123,
        "documentId": "abc123",
        "title": "Real Video Title",
        "slug": "real-video-slug",
        "streamingUrl": "REAL_URL_FROM_CATALOG",
        "thumbnailUrl": "REAL_THUMBNAIL_FROM_CATALOG"
      }
    },
    {
      "__component": "sections.related-questions",
      "heading": "Questions to Explore",
      "questions": [
        { "question": "Q1?", "answer": "A1." },
        { "question": "Q2?", "answer": "A2." }
      ]
    },
    {
      "__component": "sections.bible-quotes-carousel",
      "heading": "Scripture",
      "sectionKey": "quotes/english",
      "quotes": [
        {
          "reference": "John 3:16",
          "text": "For God so loved the world...",
          "imageUrl": "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=900",
          "backgroundColor": "#1e3a5f"
        }
      ]
    },
    {
      "__component": "sections.quiz-button",
      "buttonText": "Take the Quiz",
      "iframeSrc": "https://your.nextstep.is/embed/default?expand=false"
    }
  ],
  "platformOrdering": {
    "web": [1, 0, 2, 3, 4, 5],
    "mobile": [0, 2, 1, 3, 4, 5]
  }
}
\`\`\`

Section types: sections.video-hero, sections.video, sections.video-carousel, sections.text, sections.container, sections.related-questions, sections.bible-quotes-carousel, sections.quiz-button.

Platform ordering: mobile leads with video sections, web leads with text/context.

Always end with suggestion chips:
\`\`\`suggestions
["Suggestion 1", "Suggestion 2", "Suggestion 3"]
\`\`\``

  const parts = [systemContext, ""]
  for (const msg of history) {
    const prefix = msg.role === "user" ? "User" : "Assistant"
    parts.push(`${prefix}: ${msg.content}`)
  }
  parts.push(`User: ${userMessage}`)
  return parts.join("\n\n")
}

function buildOllamaMessages(
  history: ChatMessage[],
  userMessage: string,
  videos: VideoForPrompt[],
): Array<{ role: string; content: string }> {
  const videoCatalog = formatVideoCatalog(videos)

  const systemPrompt = `You are the Seed Studio Assistant — an expert at creating themed Christian experiences for JesusFilm.

## Available Videos from Strapi Catalog
${videoCatalog}

IMPORTANT RULES:
- You MUST pick videos from the catalog above. Do NOT invent streaming URLs or use external video URLs.
- If the catalog above is empty or not relevant enough, ask the user to refine the theme. Do not generate an experience with fallback or placeholder videos.
- For every video section, include a "videoRef" object with the real id, documentId, title, slug, streamingUrl, and thumbnailUrl from the catalog.
- Text content (headings, paragraphs, bible quotes, Q&A) should be AI-generated to match the theme.
- For bible quote imageUrl fields, use real Unsplash photo URLs (https://images.unsplash.com/photo-...) that match the quote mood.

When asked to create an experience, include a JSON code block with experience data using \`\`\`experience ... \`\`\` format.
Section types: sections.video-hero, sections.video, sections.video-carousel, sections.text, sections.container, sections.related-questions, sections.bible-quotes-carousel, sections.quiz-button.
Always end with suggestion chips in \`\`\`suggestions ... \`\`\` format.`

  const messages: Array<{ role: string; content: string }> = [
    { role: "system", content: systemPrompt },
  ]
  for (const msg of history) {
    messages.push({ role: msg.role, content: msg.content })
  }
  messages.push({ role: "user", content: userMessage })
  return messages
}

// -----------------------------------------------------------------------------
// SSE helpers
// -----------------------------------------------------------------------------

function safeEnqueue(
  controller: ReadableStreamDefaultController,
  data: Uint8Array,
) {
  try {
    controller.enqueue(data)
  } catch {
    // controller already closed
  }
}

function safeClose(controller: ReadableStreamDefaultController) {
  try {
    controller.close()
  } catch {
    // controller already closed
  }
}

/**
 * 15-second heartbeat — emits an SSE comment (`: ping\n\n`) that browsers
 * ignore but keeps the Railway gateway from closing an idle stream. Returns
 * a cleanup callback the route must call when the stream ends.
 */
function startHeartbeat(
  controller: ReadableStreamDefaultController,
  encoder: TextEncoder,
): () => void {
  const timer = setInterval(() => {
    safeEnqueue(controller, encoder.encode(`: ping\n\n`))
  }, 15_000)
  return () => clearInterval(timer)
}

// -----------------------------------------------------------------------------
// Theme slug derivation
// -----------------------------------------------------------------------------

/**
 * Produce a URL-safe theme slug from the user's query. V1 does not depend on
 * the CMS' sanitizeSlug deny-list — collisions are resolved at publish time
 * by the seed-studio service, which runs the authoritative sanitizer.
 */
function deriveThemeSlug(query: string): string {
  const base = query
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40)
  return base || `experience-${Date.now().toString(36)}`
}

// -----------------------------------------------------------------------------
// Legacy provider shims (streaming)
// -----------------------------------------------------------------------------

function streamClaude(
  prompt: string,
  model: string,
  controller: ReadableStreamDefaultController,
  encoder: TextEncoder,
) {
  const container = process.env.CLAUDE_CONTAINER ?? "devcontainer-app-1"
  // Security: the previous implementation passed the user-controlled prompt
  // as a single argv element, which meant a long prompt risked hitting the
  // OS ARG_MAX and any shell metacharacters in it sat in `/proc/$$/cmdline`.
  // We now spawn claude with `-p -` (read from stdin), write the prompt to
  // the child's stdin, and close it — no shell, no argv injection surface.
  const proc = spawn(
    "docker",
    [
      "exec",
      "-i",
      container,
      "claude",
      "-p",
      "-",
      "--output-format",
      "text",
      "--model",
      model,
    ],
    {
      env: { ...process.env, LANG: "en_US.UTF-8" },
      stdio: ["pipe", "pipe", "pipe"],
    },
  )

  try {
    proc.stdin.write(prompt)
    proc.stdin.end()
  } catch (err) {
    safeEnqueue(
      controller,
      encoder.encode(
        `data: ${JSON.stringify({ type: "error", text: err instanceof Error ? err.message : "stdin write failed" })}\n\n`,
      ),
    )
  }

  proc.stdout.on("data", (chunk: Buffer) => {
    const text = chunk.toString("utf-8")
    safeEnqueue(
      controller,
      encoder.encode(`data: ${JSON.stringify({ type: "chunk", text })}\n\n`),
    )
  })

  proc.stderr.on("data", (chunk: Buffer) => {
    const text = chunk.toString("utf-8")
    safeEnqueue(
      controller,
      encoder.encode(
        `data: ${JSON.stringify({ type: "status", text: text.trim() })}\n\n`,
      ),
    )
  })

  proc.on("close", (code) => {
    safeEnqueue(
      controller,
      encoder.encode(`data: ${JSON.stringify({ type: "done", code })}\n\n`),
    )
    safeClose(controller)
  })

  proc.on("error", (err) => {
    safeEnqueue(
      controller,
      encoder.encode(
        `data: ${JSON.stringify({ type: "error", text: err.message })}\n\n`,
      ),
    )
    safeClose(controller)
  })
}

function streamCodex(
  prompt: string,
  model: string,
  controller: ReadableStreamDefaultController,
  encoder: TextEncoder,
) {
  const isFast = model.endsWith(":fast")
  const actualModel = model.replace(/:fast$/, "")
  const args = ["exec", "-m", actualModel, "--sandbox", "read-only"]
  if (isFast) args.push("-c", 'service_tier="fast"')
  args.push("-")
  const proc = spawn("codex", args, {
    env: { ...process.env, LANG: "en_US.UTF-8" },
    stdio: ["pipe", "pipe", "pipe"],
  })
  proc.stdin.write(prompt)
  proc.stdin.end()

  proc.stdout.on("data", (chunk: Buffer) => {
    const text = chunk.toString("utf-8")
    safeEnqueue(
      controller,
      encoder.encode(`data: ${JSON.stringify({ type: "chunk", text })}\n\n`),
    )
  })

  proc.stderr.on("data", (chunk: Buffer) => {
    const text = chunk.toString("utf-8")
    safeEnqueue(
      controller,
      encoder.encode(
        `data: ${JSON.stringify({ type: "status", text: text.trim() })}\n\n`,
      ),
    )
  })

  proc.on("close", (code) => {
    safeEnqueue(
      controller,
      encoder.encode(`data: ${JSON.stringify({ type: "done", code })}\n\n`),
    )
    safeClose(controller)
  })

  proc.on("error", (err) => {
    safeEnqueue(
      controller,
      encoder.encode(
        `data: ${JSON.stringify({ type: "error", text: err.message })}\n\n`,
      ),
    )
    safeClose(controller)
  })
}

async function streamGemini(
  messages: Array<{ role: string; content: string }>,
  model: string,
  controller: ReadableStreamDefaultController,
  encoder: TextEncoder,
) {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) {
    safeEnqueue(
      controller,
      encoder.encode(
        `data: ${JSON.stringify({ type: "error", text: "GEMINI_API_KEY not set in .env.local" })}\n\n`,
      ),
    )
    safeClose(controller)
    return
  }

  const systemMsg = messages.find((m) => m.role === "system")
  const chatMsgs = messages
    .filter((m) => m.role !== "system")
    .map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    }))

  const body: Record<string, unknown> = {
    contents: chatMsgs,
    generationConfig: { temperature: 0.7 },
  }
  if (systemMsg) {
    body.systemInstruction = { parts: [{ text: systemMsg.content }] }
  }

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse&key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
    )

    if (!response.ok || !response.body) {
      const errorText = await response.text().catch(() => "unknown error")
      throw new Error(`Gemini API error ${response.status}: ${errorText}`)
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ""

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split("\n")
      buffer = lines.pop() ?? ""

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue
        const jsonStr = line.slice(6).trim()
        if (!jsonStr) continue
        try {
          const parsed = JSON.parse(jsonStr) as {
            candidates?: Array<{
              content?: { parts?: Array<{ text?: string }> }
            }>
          }
          const text = parsed.candidates?.[0]?.content?.parts?.[0]?.text
          if (text) {
            safeEnqueue(
              controller,
              encoder.encode(
                `data: ${JSON.stringify({ type: "chunk", text })}\n\n`,
              ),
            )
          }
        } catch {
          // skip malformed lines
        }
      }
    }

    safeEnqueue(
      controller,
      encoder.encode(`data: ${JSON.stringify({ type: "done", code: 0 })}\n\n`),
    )
    safeClose(controller)
  } catch (err) {
    safeEnqueue(
      controller,
      encoder.encode(
        `data: ${JSON.stringify({ type: "error", text: err instanceof Error ? err.message : "Gemini connection failed" })}\n\n`,
      ),
    )
    safeClose(controller)
  }
}

async function streamExo(
  messages: Array<{ role: string; content: string }>,
  model: string,
  controller: ReadableStreamDefaultController,
  encoder: TextEncoder,
) {
  const exoUrl = process.env.EXO_API_URL ?? "http://localhost:52415"

  try {
    const response = await fetch(`${exoUrl}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, messages, stream: true }),
    })

    if (!response.ok || !response.body) {
      const errorText = await response.text().catch(() => "unknown error")
      throw new Error(`Exo API error ${response.status}: ${errorText}`)
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ""

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split("\n")
      buffer = lines.pop() ?? ""

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue
        const jsonStr = line.slice(6).trim()
        if (!jsonStr || jsonStr === "[DONE]") continue
        try {
          const parsed = JSON.parse(jsonStr) as {
            choices?: Array<{ delta?: { content?: string } }>
          }
          const text = parsed.choices?.[0]?.delta?.content
          if (text) {
            safeEnqueue(
              controller,
              encoder.encode(
                `data: ${JSON.stringify({ type: "chunk", text })}\n\n`,
              ),
            )
          }
        } catch {
          // skip malformed lines
        }
      }
    }

    safeEnqueue(
      controller,
      encoder.encode(`data: ${JSON.stringify({ type: "done", code: 0 })}\n\n`),
    )
    safeClose(controller)
  } catch (err) {
    safeEnqueue(
      controller,
      encoder.encode(
        `data: ${JSON.stringify({ type: "error", text: err instanceof Error ? err.message : "Exo connection failed" })}\n\n`,
      ),
    )
    safeClose(controller)
  }
}

async function streamOllama(
  messages: Array<{ role: string; content: string }>,
  model: string,
  controller: ReadableStreamDefaultController,
  encoder: TextEncoder,
) {
  const ollamaUrl = process.env.OLLAMA_URL ?? "http://localhost:11434"

  try {
    const response = await fetch(`${ollamaUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, messages, stream: true }),
    })

    if (!response.ok || !response.body) {
      throw new Error(`Ollama request failed: ${response.status}`)
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ""

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split("\n")
      buffer = lines.pop() ?? ""

      for (const line of lines) {
        if (!line.trim()) continue
        try {
          const parsed = JSON.parse(line) as {
            message?: { content?: string }
            done?: boolean
          }
          if (parsed.message?.content) {
            safeEnqueue(
              controller,
              encoder.encode(
                `data: ${JSON.stringify({ type: "chunk", text: parsed.message.content })}\n\n`,
              ),
            )
          }
        } catch {
          // skip malformed lines
        }
      }
    }

    safeEnqueue(
      controller,
      encoder.encode(`data: ${JSON.stringify({ type: "done", code: 0 })}\n\n`),
    )
    safeClose(controller)
  } catch (err) {
    safeEnqueue(
      controller,
      encoder.encode(
        `data: ${JSON.stringify({ type: "error", text: err instanceof Error ? err.message : "Ollama connection failed" })}\n\n`,
      ),
    )
    safeClose(controller)
  }
}

// -----------------------------------------------------------------------------
// Strict JSON-schema route (OpenRouter)
// -----------------------------------------------------------------------------

async function runStrictGenerator(
  query: string,
  videos: VideoForPrompt[],
  model: string,
  signal: AbortSignal,
  controller: ReadableStreamDefaultController,
  encoder: TextEncoder,
) {
  const themeSlug = deriveThemeSlug(query)
  const candidates: GeneratorCandidate[] = videos.map((v) => ({
    id: v.id,
    documentId: v.documentId,
    title: v.title,
    slug: v.slug,
    streamingUrl: v.streamingUrl,
    thumbnailUrl: v.thumbnailUrl,
  }))

  const result = await generateExperience({
    query,
    themeSlug,
    candidates,
    model,
    signal,
  })

  if (result.ok) {
    safeEnqueue(
      controller,
      encoder.encode(
        `event: patch\ndata: ${JSON.stringify({ path: ["experience"], value: result.experience })}\n\n`,
      ),
    )
    safeEnqueue(controller, encoder.encode(`event: done\ndata: {}\n\n`))
  } else {
    const { code, message } = result.error
    safeEnqueue(
      controller,
      encoder.encode(
        `event: patch\ndata: ${JSON.stringify({ path: ["error"], value: { code, message } })}\n\n`,
      ),
    )
    safeEnqueue(controller, encoder.encode(`event: done\ndata: {}\n\n`))
  }
  safeClose(controller)
}

// -----------------------------------------------------------------------------
// POST
// -----------------------------------------------------------------------------

export async function POST(request: NextRequest) {
  const body = (await request.json()) as {
    messages: ChatMessage[]
    userMessage: string
    provider?: AIProvider
    model?: string
  }

  const provider: AIProvider = body.provider ?? "openrouter"
  const model = body.model ?? DEFAULT_MODELS[provider]
  const useStrict = SUPPORTS_STRICT_JSON_SCHEMA[provider]

  // Single search call — replaces the previous keyword-loop fanout which
  // starved the CMS search rate-limit bucket.
  const videos = await fetchCandidateVideos(body.userMessage, request.signal)
  console.log(
    `[api/chat] query=${JSON.stringify(body.userMessage)} provider=${body.provider} candidates=${videos.length}`,
  )

  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder()
      const stopHeartbeat = startHeartbeat(controller, encoder)

      safeEnqueue(
        controller,
        encoder.encode(
          `data: ${JSON.stringify({ type: "status", text: `Using ${provider} (${model})...` })}\n\n`,
        ),
      )
      const wrapClose = () => {
        stopHeartbeat()
      }

      safeEnqueue(
        controller,
        encoder.encode(
          `event: patch\ndata: ${JSON.stringify({ path: ["catalog"], value: videos })}\n\n`,
        ),
      )

      if (videos.length === 0) {
        safeEnqueue(
          controller,
          encoder.encode(
            `event: patch\ndata: ${JSON.stringify({
              path: ["error"],
              value: {
                code: "NO_CANDIDATES",
                message:
                  "No Strapi videos matched this query. Refine the theme instead of using external videos.",
              },
            })}\n\n`,
          ),
        )
        safeEnqueue(controller, encoder.encode(`event: done\ndata: {}\n\n`))
        wrapClose()
        safeClose(controller)
        return
      }

      if (useStrict) {
        // Single-shot OpenRouter call with strict-JSON-Schema; emit one
        // `event: patch` frame.
        runStrictGenerator(
          body.userMessage,
          videos,
          model,
          request.signal,
          controller,
          encoder,
        )
          .catch((err) => {
            safeEnqueue(
              controller,
              encoder.encode(
                `event: patch\ndata: ${JSON.stringify({
                  path: ["error"],
                  value: {
                    code: "UPSTREAM_ERROR",
                    message:
                      err instanceof Error ? err.message : "Generator failed",
                  },
                })}\n\n`,
              ),
            )
            safeClose(controller)
          })
          .finally(wrapClose)
        return
      }

      // Legacy free-form streaming providers.
      const prompt = buildPrompt(body.messages, body.userMessage, videos)
      const messages = buildOllamaMessages(
        body.messages,
        body.userMessage,
        videos,
      )

      let fired: Promise<void> | undefined
      if (provider === "exo") {
        fired = streamExo(messages, model, controller, encoder)
      } else if (provider === "ollama") {
        fired = streamOllama(messages, model, controller, encoder)
      } else if (provider === "gemini") {
        fired = streamGemini(messages, model, controller, encoder)
      } else if (provider === "codex") {
        streamCodex(prompt, model, controller, encoder)
      } else {
        // Default to claude (legacy docker-exec CLI). `openrouter` was
        // handled above in the useStrict branch, so reaching this path
        // means an unrecognized provider slipped through — fall back to
        // claude which is the closest "remote chat" analog for now.
        streamClaude(prompt, model, controller, encoder)
      }

      if (fired) {
        fired.finally(wrapClose)
      } else {
        // child-process streamers close the controller inside their event
        // handlers, so we hook the heartbeat cleanup to the controller via
        // a best-effort check on close. If the child never emits close
        // (e.g. process crash), the 60s Vercel gateway timeout will tear
        // the connection down and finalize cleanup with the response.
        const originalClose = controller.close.bind(controller)
        controller.close = () => {
          wrapClose()
          originalClose()
        }
      }
    },
    cancel() {
      // Client aborted — no-op; the underlying fetch/process already saw
      // the shared AbortSignal.
    },
  })

  return new NextResponse(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  })
}
