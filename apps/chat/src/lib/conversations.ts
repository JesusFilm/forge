// Stub conversation model. Lives entirely in the client and resets on refresh
// — no persistence until users + a database land. The Message shape is owned
// by chat-stub.ts (the Mastra wiring seam); a Conversation is just a titled
// list of those messages.

import { type Message } from "./chat-stub"

export type Conversation = {
  id: string
  title: string
  messages: Message[]
}

export const NEW_CONVERSATION_TITLE = "New conversation"

export function createConversation(): Conversation {
  return {
    id: crypto.randomUUID(),
    title: NEW_CONVERSATION_TITLE,
    messages: [],
  }
}

// First user message becomes the sidebar title — trimmed to a single line.
export function deriveTitle(text: string): string {
  const normalized = text.trim().replace(/\s+/g, " ")
  if (normalized.length <= 40) return normalized
  return `${normalized.slice(0, 39).trimEnd()}…`
}
