export const SHARED_AGENT_CATEGORIES = [
  "localization",
  "video",
  "growth",
  "marketing",
] as const

export type SharedAgentCategory = (typeof SHARED_AGENT_CATEGORIES)[number]

export type SharedAgentField = {
  key: string
  label: string
  kind: "text" | "textarea"
  required: boolean
  placeholder?: string
  description?: string
}

export type SharedAgentDefinition = {
  id: string
  name: string
  summary: string
  category: SharedAgentCategory
  starterPrompt: string
  description: string
  instructions: string
  fields: readonly SharedAgentField[]
  capabilities: {
    supportsSessions: boolean
    supportsWriteback: boolean
    supportsVideoContext: boolean
  }
}

export const SHARED_AGENT_DEFINITIONS = [
  {
    id: "translation",
    name: "Translation Agent",
    summary: "Translate and adapt content for a target language and audience.",
    category: "localization",
    starterPrompt: "Translate this content with cultural clarity.",
    description:
      "Specialist for translation, localization notes, tone preservation, and audience-fit rewrites.",
    instructions: [
      "You are Forge's Translation Agent.",
      "Translate faithfully, but adapt phrasing so it feels native in the target language.",
      "Keep proper nouns, citations, and structured references intact unless the user asks to localize them.",
      "When the source is ambiguous, explain the ambiguity briefly and choose the clearest translation.",
      "Return a grounded summary, operator-ready markdown, and a metadata patch only when the source supports it.",
    ].join(" "),
    fields: [
      {
        key: "source_text",
        label: "Source text",
        kind: "textarea",
        required: true,
        placeholder: "Paste the original text to translate.",
      },
      {
        key: "target_language",
        label: "Target language",
        kind: "text",
        required: true,
        placeholder: "Spanish, Arabic, French...",
      },
      {
        key: "tone_notes",
        label: "Tone notes",
        kind: "textarea",
        required: false,
        placeholder: "Warm, pastoral, concise, formal...",
      },
    ],
    capabilities: {
      supportsSessions: true,
      supportsWriteback: true,
      supportsVideoContext: true,
    },
  },
  {
    id: "video_enhancing",
    name: "Video Enhancing Agent",
    summary:
      "Improve video packaging with stronger hooks, metadata, and editorial upgrade ideas.",
    category: "video",
    starterPrompt: "Upgrade this video so it is clearer and more compelling.",
    description:
      "Specialist for stronger titles, descriptions, hooks, chapter ideas, thumbnails, and editorial polish suggestions.",
    instructions: [
      "You are Forge's Video Enhancing Agent.",
      "Improve how a video will perform for discovery, comprehension, and completion.",
      "Prefer actionable editorial changes over vague advice.",
      "If the source material is thin, say what additional context would most improve the recommendation.",
      "Return a grounded summary, operator-ready markdown, and only propose metadata edits when they are clearly supported by the source.",
    ].join(" "),
    fields: [
      {
        key: "video_context",
        label: "Video context",
        kind: "textarea",
        required: true,
        placeholder:
          "Transcript, description, chapters, or notes about the video.",
      },
      {
        key: "distribution_surface",
        label: "Distribution surface",
        kind: "text",
        required: false,
        placeholder: "YouTube, watch page, app feed, TV app...",
      },
      {
        key: "target_audience",
        label: "Target audience",
        kind: "text",
        required: false,
        placeholder: "New believers, youth leaders, pastors...",
      },
    ],
    capabilities: {
      supportsSessions: true,
      supportsWriteback: false,
      supportsVideoContext: true,
    },
  },
  {
    id: "seo",
    name: "SEO Agent",
    summary:
      "Strengthen search-facing titles, descriptions, keyword targeting, and internal-link ideas.",
    category: "growth",
    starterPrompt: "Turn this draft into stronger search-facing content.",
    description:
      "Specialist for SEO-focused page rewrites, metadata, keyword strategy, and content structure.",
    instructions: [
      "You are Forge's SEO Agent.",
      "Improve search relevance without sounding spammy or robotic.",
      "Prefer natural language, clear headings, and credible keyword coverage.",
      "When useful, suggest title tags, meta descriptions, FAQs, and internal-link opportunities.",
      "Return a grounded summary, operator-ready markdown, and a metadata patch only when the source supports it.",
    ].join(" "),
    fields: [
      {
        key: "source_copy",
        label: "Source copy",
        kind: "textarea",
        required: true,
        placeholder: "Paste the current page, article, or landing copy.",
      },
      {
        key: "target_keyword",
        label: "Target keyword",
        kind: "text",
        required: false,
        placeholder: "Primary keyword or query family.",
      },
      {
        key: "search_intent",
        label: "Search intent",
        kind: "text",
        required: false,
        placeholder: "Informational, navigational, comparative...",
      },
    ],
    capabilities: {
      supportsSessions: true,
      supportsWriteback: true,
      supportsVideoContext: true,
    },
  },
  {
    id: "marketing",
    name: "Marketing Agent",
    summary:
      "Shape sharper campaigns, messaging, CTAs, and channel-specific variants.",
    category: "marketing",
    starterPrompt: "Create clear campaign-ready messaging from this brief.",
    description:
      "Specialist for campaign messaging, audience framing, copy variants, CTAs, and launch angles.",
    instructions: [
      "You are Forge's Marketing Agent.",
      "Turn raw product or content context into clear, audience-specific messaging.",
      "Offer specific message options instead of generic brand-language summaries.",
      "Prefer concise, channel-aware copy that sounds human.",
      "Return a grounded summary, operator-ready markdown, and keep recommendations tied to the source video context.",
    ].join(" "),
    fields: [
      {
        key: "offer_or_content",
        label: "Offer or content",
        kind: "textarea",
        required: true,
        placeholder: "Describe the thing being promoted.",
      },
      {
        key: "audience",
        label: "Audience",
        kind: "text",
        required: true,
        placeholder: "Who is this for?",
      },
      {
        key: "channel",
        label: "Channel",
        kind: "text",
        required: false,
        placeholder: "Email, app push, social, landing page...",
      },
    ],
    capabilities: {
      supportsSessions: true,
      supportsWriteback: false,
      supportsVideoContext: true,
    },
  },
] as const satisfies readonly SharedAgentDefinition[]
