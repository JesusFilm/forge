/**
 * Prompt registry — admin Experience-AI chat (U4).
 *
 * Each agent's system prompt lives in its own module as either a
 * static string or a `({ requestContext }) => string` dynamic
 * function (per Mastra's `Agent.instructions` contract verified in
 * U1). Static prompts compose the rules the model should always
 * follow; dynamic prompts inject per-call canvas state, candidate
 * videos, locale, and principal.
 *
 * Why a registry-style module instead of inline strings in agent
 * files: the plan (G3 / U4) calls for moving prompts out of TS
 * string builders into addressable, versionable assets. The registry
 * is the addressable surface — agents in U6+ import by name.
 *
 * Rebase note: this content supersedes the parallel branch's
 * `apps/admin/src/services/experience-ai/experience-ai-chat-prompts.ts`
 * builder. The constraints below are extracted from that file's test
 * assertions (the disabled-brief-flow rules, candidate videoId hints,
 * strict block-schema rules); detailed wording can be tuned in U6+
 * once the agents are wired to a real provider.
 */

export { DRAFT_EXPERIENCE_PROMPT } from "./draft-experience-prompt"
export { ADD_SECTION_PROMPT } from "./add-section-prompt"
export { REWRITE_COPY_PROMPT } from "./rewrite-copy-prompt"
export { AUTO_ENRICH_PROMPT } from "./auto-enrich-prompt"
export { PLAN_EXPERIENCE_PROMPT } from "./plan-experience-prompt"
export { CRITIQUE_EXPERIENCE_PROMPT } from "./critique-experience-prompt"
export { REVISE_EXPERIENCE_PROMPT } from "./revise-experience-prompt"
export { SKELETON_EXPERIENCE_PROMPT } from "./skeleton-prompt"
export { FILL_EXPERIENCE_PROMPT } from "./fill-prompt"
export { GENERATE_VIDEO_SECTION_PROMPT } from "./generate-video-section-prompt"

export type PromptId =
  | "draft-experience"
  | "add-section"
  | "rewrite-copy"
  | "auto-enrich"
  | "plan-experience"
  | "critique-experience"
  | "revise-experience"
  | "skeleton-experience"
  | "fill-experience"
  | "generate-video-section"
