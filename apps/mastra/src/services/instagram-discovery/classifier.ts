import type { InstagramPost, MatchSignals } from "./types"

/**
 * Keyword/heuristic classification — intentionally simple and noisy. It does NOT
 * guarantee a post is truly AI-generated or Christian; it only flags keyword
 * signals. An optional LLM confirmation step is deferred follow-up work.
 *
 * Each keyword is either a plain substring or a `{ word }` token that must match
 * on word boundaries. Word-boundary matching guards short/ambiguous tokens
 * (e.g. "ai", "god") against false positives ("said", "goddess").
 */
type Keyword = string | { word: string }

export const AI_KEYWORDS: Keyword[] = [
  { word: "ai" },
  "ai-generated",
  "aigenerated",
  "ai generated",
  "made with ai",
  "generative",
  "gen ai",
  "genai",
  "midjourney",
  "sora",
  "runway",
  "veo",
  "kling",
  "pika",
  "stable diffusion",
  "#aiart",
  "#aivideo",
]

export const CHRISTIAN_KEYWORDS: Keyword[] = [
  "jesus",
  "christ",
  "christian",
  "gospel",
  "bible",
  "biblical",
  "scripture",
  "faith",
  { word: "god" },
  "prayer",
  "pray",
  "holy spirit",
  "church",
  "psalm",
  "salvation",
  "savior",
  "saviour",
  "worship",
  "lord",
]

/**
 * Signals that a caption is commentary/news/tutorial ABOUT AI content rather
 * than an actual AI-made creation. Kept conservative: only phrases that strongly
 * indicate talking-about (not making), to avoid dropping genuine creations.
 */
export const COMMENTARY_KEYWORDS: Keyword[] = [
  "reaction",
  "my thoughts",
  "should we",
  "is it ok",
  "is it okay",
  "debate",
  "controversy",
  "going viral",
  "went viral",
  { word: "trend" },
  "here's how",
  "heres how",
  "here's my",
  "heres my",
  "prompt to make",
  "chatgpt conversation",
  "conversation with chatgpt",
  "breaking news",
  { word: "blogger" },
  "tutorial",
  "how i made",
  "how to make",
  "react to",
  "reacting to",
  "expressed concern",
  "raises concern",
  "speaks out",
  "speaking out",
  "weighs in",
  "satirical",
  // NOTE: keep this list conservative. Terms that collide with genuine creation
  // captions were deliberately excluded: "according to" (Gospel attributions),
  // "mocking" (Passion narrative + "mockingbird"), "explains"/"explained"
  // (AI explainer films are legitimate creations).
]

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function keywordMatches(keyword: Keyword, haystack: string): string | null {
  if (typeof keyword === "string") {
    return haystack.includes(keyword) ? keyword : null
  }
  const pattern = new RegExp(`\\b${escapeRegExp(keyword.word)}\\b`)
  return pattern.test(haystack) ? keyword.word : null
}

function matchAll(keywords: Keyword[], haystack: string): string[] {
  const matched = new Set<string>()
  for (const keyword of keywords) {
    const hit = keywordMatches(keyword, haystack)
    if (hit) matched.add(hit)
  }
  return [...matched]
}

function buildHaystack(post: InstagramPost): string {
  return `${post.caption} ${post.hashtags.join(" ")}`.toLowerCase()
}

export function classifyPost(post: InstagramPost): MatchSignals {
  const haystack = buildHaystack(post)
  const matchedAi = matchAll(AI_KEYWORDS, haystack)
  const matchedChristian = matchAll(CHRISTIAN_KEYWORDS, haystack)
  const matchedCommentary = matchAll(COMMENTARY_KEYWORDS, haystack)
  return {
    isAiGenerated: matchedAi.length > 0,
    isChristian: matchedChristian.length > 0,
    isCommentary: matchedCommentary.length > 0,
    matchedAi,
    matchedChristian,
    matchedCommentary,
  }
}

/**
 * A post qualifies only when it signals BOTH AI-generation and Christian content
 * AND does not read as commentary/news/tutorial about AI content.
 */
export function qualifies(signals: MatchSignals): boolean {
  return signals.isAiGenerated && signals.isChristian && !signals.isCommentary
}
