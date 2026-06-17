// Client-side stub for assistant replies. This module is the seam the
// eventual Mastra wiring replaces — keep the UI free of reply-generation
// logic so the swap stays contained here. The Message type lives in
// conversations.ts (not here) so it survives this file's deletion.

export const STUB_REPLY_DELAY_MS = 800

export function buildStubReply(userText: string): string {
  return `Stubbed reply — no agent is connected yet. You said: "${userText}"`
}
