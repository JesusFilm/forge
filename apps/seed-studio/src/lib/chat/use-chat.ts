"use client"

import { useState, useCallback, useRef } from "react"
import type {
  ChatMessage,
  GeneratedExperience,
} from "@/lib/ai/experience-schema"

type SSEEvent =
  | { type: "chunk"; text: string }
  | { type: "status"; text: string }
  | { type: "done"; code: number }
  | { type: "error"; text: string }

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

function extractExperience(text: string): GeneratedExperience | undefined {
  const match = text.match(/```experience\n([\s\S]*?)\n```/)
  if (!match) return undefined
  try {
    return JSON.parse(match[1]) as GeneratedExperience
  } catch {
    return undefined
  }
}

function extractSuggestions(text: string): string[] {
  const match = text.match(/```suggestions\n([\s\S]*?)\n```/)
  if (!match) return ["Add more sections", "Change the theme", "Publish"]
  try {
    return JSON.parse(match[1]) as string[]
  } catch {
    return ["Add more sections", "Change the theme", "Publish"]
  }
}

function cleanMessage(text: string): string {
  return text
    .replace(/```experience\n[\s\S]*?\n```/g, "")
    .replace(/```suggestions\n[\s\S]*?\n```/g, "")
    .trim()
}

export function useChat() {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [experience, setExperience] = useState<GeneratedExperience | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [streamingText, setStreamingText] = useState("")
  const [statusText, setStatusText] = useState("")
  const abortRef = useRef<AbortController | null>(null)

  const sendMessage = useCallback(
    async (content: string) => {
      setError(null)
      setStreamingText("")
      setStatusText("Connecting to Claude...")

      const userMessage: ChatMessage = {
        id: generateId(),
        role: "user",
        content,
      }
      setMessages((prev) => [...prev, userMessage])
      setIsLoading(true)

      abortRef.current = new AbortController()
      let fullText = ""

      try {
        const response = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ messages, userMessage: content }),
          signal: abortRef.current.signal,
        })

        if (!response.ok || !response.body) {
          throw new Error(`Request failed: ${response.status}`)
        }

        setStatusText("Claude is thinking...")

        const reader = response.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ""

        while (true) {
          const { done, value } = await reader.read()
          if (done) break

          buffer += decoder.decode(value, { stream: true })
          const lines = buffer.split("\n\n")
          buffer = lines.pop() ?? ""

          for (const line of lines) {
            if (!line.startsWith("data: ")) continue
            const jsonStr = line.slice(6)

            let event: SSEEvent
            try {
              event = JSON.parse(jsonStr) as SSEEvent
            } catch {
              continue
            }

            if (event.type === "chunk") {
              fullText += event.text
              setStreamingText(cleanMessage(fullText))
              setStatusText("")

              // Try to extract experience as it streams in
              const exp = extractExperience(fullText)
              if (exp) {
                setExperience(exp)
              }
            } else if (event.type === "status") {
              if (event.text) setStatusText(event.text)
            } else if (event.type === "error") {
              throw new Error(event.text)
            }
            // "done" is handled by the loop ending
          }
        }

        // Finalize the assistant message
        const exp = extractExperience(fullText)
        const suggestions = extractSuggestions(fullText)
        const cleanText = cleanMessage(fullText)

        const assistantMessage: ChatMessage = {
          id: generateId(),
          role: "assistant",
          content:
            cleanText || "Experience generated! Check the preview panel.",
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
      }
    },
    [messages],
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
