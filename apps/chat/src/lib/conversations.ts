// Stub conversation model. Lives entirely in the client and resets on refresh
// — no persistence until users + a database land. A Conversation is just a
// titled list of messages.

// The message shape. Owned here (not in chat-stub.ts) so it survives the
// eventual deletion of the stub seam — both this file and the UI keep
// importing it from a module that outlives the Mastra swap. The
// `id`/`role`/`content` shape is AI-SDK-aligned so that swap renames nothing.
export type Message = {
  id: string
  role: "user" | "assistant"
  content: string
}

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
