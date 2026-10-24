import type { ExperienceEditorAuthoredDubSelector } from "@/services/experience-editor-video.service"

type BlockRecord = Record<string, unknown>

export const EXPERIENCE_EDITOR_MAX_AUTHORED_DUB_SELECTORS = 2_000

export class ExperienceEditorDubSelectorLimitError extends Error {
  constructor() {
    super(
      `An experience may reference at most ${EXPERIENCE_EDITOR_MAX_AUTHORED_DUB_SELECTORS} distinct video audio selections.`,
    )
    this.name = "ExperienceEditorDubSelectorLimitError"
  }
}

function asRecord(value: unknown): BlockRecord | null {
  return value != null && typeof value === "object" && !Array.isArray(value)
    ? (value as BlockRecord)
    : null
}

function selectorText(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null
}

/**
 * Finds every distinct authored video/Dub identity in an experience draft.
 * The traversal intentionally tolerates partial editor state so one malformed
 * item cannot hide otherwise valid selectors from save-time validation.
 */
export function extractAuthoredVideoDubSelectors(
  blocks: unknown,
): ExperienceEditorAuthoredDubSelector[] {
  const selectors: ExperienceEditorAuthoredDubSelector[] = []
  const seen = new Set<string>()

  const add = (value: BlockRecord) => {
    const videoId = selectorText(value.videoId)
    if (!videoId) return

    const languageId = selectorText(value.languageId)
    const legacyStreamingUrl = selectorText(value.streamingUrl)
    const identity = JSON.stringify([videoId, languageId, legacyStreamingUrl])
    if (seen.has(identity)) return
    seen.add(identity)
    selectors.push({ videoId, languageId, legacyStreamingUrl })
  }

  const visitBlock = (value: unknown) => {
    const block = asRecord(value)
    if (!block) return

    const type = selectorText(block.t)
    if (type === "video" || type === "videoHero") add(block)

    if (type === "videoCarousel" || type === "mediaCollection") {
      for (const item of Array.isArray(block.items) ? block.items : []) {
        const record = asRecord(item)
        if (record) add(record)
      }
    }

    if (type === "section" || type === "container") {
      for (const item of Array.isArray(block.content) ? block.content : []) {
        visitBlock(item)
      }
    }
  }

  for (const block of Array.isArray(blocks) ? blocks : []) visitBlock(block)
  return selectors
}

export function boundedAuthoredVideoDubSelectors(blocks: unknown) {
  const selectors = extractAuthoredVideoDubSelectors(blocks)
  if (selectors.length > EXPERIENCE_EDITOR_MAX_AUTHORED_DUB_SELECTORS) {
    throw new ExperienceEditorDubSelectorLimitError()
  }
  return selectors
}
