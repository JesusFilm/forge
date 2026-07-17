import { classifyContent } from "../discovery/classifier"
import type { InstagramPost } from "./types"

/**
 * Instagram-facing wrapper over the shared discovery classifier. The keyword
 * lists, commentary filter, and matching logic live in `services/discovery/classifier`
 * and are shared with the YouTube discovery workflow.
 */
export {
  AI_KEYWORDS,
  CHRISTIAN_KEYWORDS,
  COMMENTARY_KEYWORDS,
  classifyContent,
  qualifies,
} from "../discovery/classifier"
export type { MatchSignals } from "../discovery/classifier"

/** Classify an Instagram post (delegates to the shared classifier). */
export function classifyPost(post: InstagramPost) {
  return classifyContent(post)
}
