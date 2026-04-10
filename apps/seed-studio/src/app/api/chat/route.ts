import { spawn } from "node:child_process"
import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"
import type { ChatMessage } from "@/lib/ai/experience-schema"

function buildPrompt(history: ChatMessage[], userMessage: string): string {
  const systemContext = `You are the Seed Studio Assistant — an expert at creating themed Christian experiences for JesusFilm.

IMPORTANT: When asked to create an experience, you MUST include a JSON code block with the complete experience data in this exact format:

\`\`\`experience
{
  "title": "Experience Title",
  "slug": "experience-slug",
  "metaDescription": "Brief description",
  "blocks": [
    {
      "__component": "sections.video-hero",
      "sectionKey": "hero/english",
      "streamingUrl": "https://stream.mux.com/example.m3u8",
      "heading": "Hero Heading"
    },
    {
      "__component": "sections.text",
      "heading": "Section Heading",
      "contentParagraphs": ["Paragraph 1", "Paragraph 2"]
    },
    {
      "__component": "sections.video",
      "sectionKey": "video-1/english",
      "video": 0,
      "streamingUrl": "https://stream.mux.com/example.m3u8",
      "title": "Video Title",
      "subtitle": "Video Subtitle"
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

  const prompt = buildPrompt(body.messages, body.userMessage)

  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder()

      const proc = spawn(
        "claude",
        ["-p", prompt, "--output-format", "text", "-c", "seed-studio"],
        {
          env: { ...process.env, LANG: "en_US.UTF-8" },
          stdio: ["pipe", "pipe", "pipe"],
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
