export const WORKFLOW_STATES = [
  "author_draft",
  "ai_processing",
  "ai_draft_ready",
  "in_review",
  "approved",
  "published",
  "changes_requested",
] as const

export type WorkflowState = (typeof WORKFLOW_STATES)[number]

export const MODERATION_STATES = ["pending", "flagged", "passed"] as const
export type ModerationState = (typeof MODERATION_STATES)[number]

export const CREATED_BY_TYPES = ["human", "ai"] as const
export type CreatedByType = (typeof CREATED_BY_TYPES)[number]
