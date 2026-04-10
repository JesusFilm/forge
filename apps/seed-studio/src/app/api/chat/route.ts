import { spawn } from "node:child_process"
import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"
import type { ChatMessage } from "@/lib/ai/experience-schema"
import { searchVideos } from "@/lib/strapi-client"

type VideoForPrompt = {
  id: number
  documentId: string
  title: string
  slug: string
  streamingUrl: string
  thumbnailUrl?: string
}

function formatVideoCatalog(videos: VideoForPrompt[]): string {
  if (videos.length === 0) {
    return "No videos found in the catalog for this theme. Use placeholder streaming URLs."
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
- You MUST pick videos from the catalog above. Do NOT invent streaming URLs.
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
      "buttonText": "Take the Quiz"
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

export async function POST(request: NextRequest) {
  const body = (await request.json()) as {
    messages: ChatMessage[]
    userMessage: string
  }

  // Fetch real videos from Strapi matching the user's theme
  const videos = await searchVideos(body.userMessage)

  const prompt = buildPrompt(body.messages, body.userMessage, videos)

  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder()

      const proc = spawn(
        "claude",
        [
          "-p",
          prompt,
          "--output-format",
          "text",
          "-c",
          "seed-studio",
          "--model",
          "claude-opus-4-6",
        ],
        {
          env: { ...process.env, LANG: "en_US.UTF-8" },
          stdio: ["ignore", "pipe", "pipe"],
        },
      )

      proc.stdout.on("data", (chunk: Buffer) => {
        const text = chunk.toString("utf-8")
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({ type: "chunk", text })}\n\n`,
          ),
        )
      })

      proc.stderr.on("data", (chunk: Buffer) => {
        const text = chunk.toString("utf-8")
        // Claude CLI prints progress to stderr — forward as status
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({ type: "status", text: text.trim() })}\n\n`,
          ),
        )
      })

      proc.on("close", (code) => {
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ type: "done", code })}\n\n`),
        )
        controller.close()
      })

      proc.on("error", (err) => {
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({ type: "error", text: err.message })}\n\n`,
          ),
        )
        controller.close()
      })
    },
  })

  return new NextResponse(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  })
}
