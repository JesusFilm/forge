/**
 * `ChatStreamEvent` union — the boundary contract between the chat
 * service and the editor-side panel (U3 of the chat-replacement plan).
 *
 * **Rebase note.** This type is also declared in
 * `apps/admin/src/services/experience-ai/experience-ai-chat.service.ts`
 * on `feat/admin-chat-multi-channel-providers`. When that branch lands
 * on main and this branch rebases, consolidate to ONE source of truth —
 * prefer keeping this file (Mastra-side) as the canonical definition
 * since U10 deletes the old service. The shapes are intentionally
 * identical here so the eventual consolidation is a delete-and-import
 * shuffle, not a contract change.
 *
 * The streaming bridge (`streaming-bridge.ts`) emits values of this
 * union; the panel-side consumer (`experience-chat-panel.tsx`,
 * unmodified) renders them.
 */

/**
 * Error codes the bridge can emit. Closed union so panel-side
 * rendering can exhaustively switch on them.
 */
export type ChatErrorCode =
  | "provider_not_configured"
  | "provider_validation_failed"
  | "validation_failed"
  | "agent_not_found"
  | "tool_failed"
  | "timeout"
  | "unknown"

/**
 * Persisted, JSON-serialisable diff shape applied to the editor
 * canvas. Mirrors the existing `ExperienceChatDiff` shape on the
 * parallel branch.
 *
 * The plan keeps the panel-side `canvasController.applyDiff` /
 * `revertDiff` interface unchanged — that means this diff shape must
 * not gain or rename fields without coordinated UI work.
 */
export type ExperienceChatDiff = {
  scalars: {
    title?: { before: string; after: string }
    metaDescription?: { before: string | null; after: string | null }
    ogImageUrl?: { before: string | null; after: string | null }
  }
  blocks?: ReadonlyArray<unknown>
}

/**
 * Optional draft snapshot emitted alongside a `mutation_proposal`
 * event. The legacy quality-draft path emitted these; preserved at
 * the type level so existing panel code matches even though U2 and
 * later default to direct `mutation_applied` semantics.
 */
export type EditableLocaleState = {
  title: string
  metaDescription: string | null
  ogImageUrl: string | null
  blocks: ReadonlyArray<unknown>
}

export type ChatStreamEvent =
  | { type: "token_delta"; text: string }
  | {
      type: "mutation_proposal"
      messageId: string
      diff: ExperienceChatDiff
      draft: EditableLocaleState
    }
  | {
      type: "mutation_applied"
      messageId: string
      diff: ExperienceChatDiff
    }
  | {
      type: "tool_call_started"
      toolId: string
      callId: string
    }
  | {
      type: "tool_call_completed"
      toolId: string
      callId: string
      durationMs: number
    }
  | { type: "error"; code: ChatErrorCode; message: string }
  | { type: "done"; messageId: string }
