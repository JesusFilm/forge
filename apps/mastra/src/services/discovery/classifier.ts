/**
 * Keyword/heuristic classification — intentionally simple and noisy. It does NOT
 * guarantee content is truly AI-generated or Christian; it only flags keyword
 * signals. An optional LLM confirmation step is deferred follow-up work.
 *
 * Platform-agnostic: it reads only a `{ caption, hashtags }` haystack, so both
 * Instagram posts and YouTube videos (title + description → caption) classify
 * through the same logic.
 *
 * Each keyword is either a plain substring or a `{ word }` token that must match
 * on word boundaries. Word-boundary matching guards short/ambiguous tokens
 * (e.g. "ai", "god") against false positives ("said", "goddess").
 */
type Keyword = string | { word: string }

/** Minimal structural input — any discovered item that exposes text + tags. */
export type ClassifiableContent = {
  caption: string
  hashtags: string[]
}

/** Signals from the keyword classifier for a single piece of content. */
export type MatchSignals = {
  isAiGenerated: boolean
  isChristian: boolean
  /** True when the text reads as commentary/news/tutorial about AI content. */
  isCommentary: boolean
  matchedAi: string[]
  matchedChristian: string[]
  matchedCommentary: string[]
}

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
 * Signals that text is commentary/news/tutorial ABOUT AI content rather than an
 * actual AI-made creation. Kept conservative: only phrases that strongly
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
  // Meme / novelty junk (YouTube noise): clearly not a devotional creation.
  "#funny",
  "#memes",
  "#meme",
  { word: "funny" },
  { word: "meme" },
  { word: "memes" },
  "jousting",
  { word: "buddha" },
  "cutebaby",
  "cute baby",
  // "Talk about AI" teaching / warning clickbait (not a creation).
  "must know",
  "be advised",
  "is using ai",
  "using ai to",
  "trick many",
  "be deceived",
  // News / chart coverage about AI content (not a creation).
  "music charts",
  "hits no",
  "no. 1",
  // News reporting ABOUT someone's AI post (headline/coverage style, not a
  // creation). Targeted at the political/news items Firecrawl surfaces for
  // "AI + Christian" searches (Trump/Pope AI-image stories, viral-video
  // coverage). Kept phrase-specific to avoid dropping genuine devotionals:
  // "warns about ai" (news) but not bare "warns about" (a sermon can warn).
  "breaking:",
  "the president",
  "u.s. president",
  "us president",
  "shared an ai",
  "shares ai",
  "depicting himself",
  "depicting themselves",
  "warns about ai",
  "warns of ai",
  "what do we lose",
  "diplomatic accounts",
  "goes viral",
  "beware of ai",
  "i personally feel",
  "popping up",
  "itunes",
  // NOTE: keep this list conservative. Terms that collide with genuine creation
  // captions were deliberately excluded: "according to" (Gospel attributions),
  // "mocking" (Passion narrative + "mockingbird"), "explains"/"explained"
  // (AI explainer films are legitimate creations), and "viral" (genuine
  // creations sometimes describe themselves as viral).
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

function buildHaystack(content: ClassifiableContent): string {
  return `${content.caption} ${content.hashtags.join(" ")}`.toLowerCase()
}

export function classifyContent(content: ClassifiableContent): MatchSignals {
  const haystack = buildHaystack(content)
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
 * Content qualifies only when it signals BOTH AI-generation and Christian content
 * AND does not read as commentary/news/tutorial about AI content.
 */
export function qualifies(signals: MatchSignals): boolean {
  return signals.isAiGenerated && signals.isChristian && !signals.isCommentary
}
