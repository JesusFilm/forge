/**
 * Copy for the Watch product-update page at `/watch/whats-new`.
 *
 * Deliberately NOT in `messages/*.json`. The page is an English-only
 * announcement for Jesus Film staff and ministry partners; adding a
 * namespace obligates all ~230 UI catalogs (the structural-parity gate in
 * `src/i18n/__tests__/messages-parity.test.ts` plus the translated-copy
 * gate, which rejects English placeholders). Localizing this page is a
 * follow-up that should run through `pnpm --filter @forge/web
 * translate:ui-catalogs` once the copy is final. Chrome around the page
 * (floating header, footer, feedback composer) stays localized.
 *
 * Forward-looking capabilities are phrased as direction, never as shipped
 * releases. 4K is qualified because Watch supports 4K sources but
 * availability depends on the individual video asset.
 */

export const WHATS_NEW_HERO = {
  eyebrow: "Watch · Product update",
  title: "Watch is changing. Here's why.",
  deck: "A better way to find, watch, and share the story of Jesus — in the language and format that fits the moment.",
  feedbackCta: "Share feedback",
} as const

/**
 * The page is English-only, so the language switcher is the primary way a
 * partner or non-English reader leaves it for content they can use. It
 * routes to `/watch/{lang}.html/videos` — the full video collection in the
 * chosen language.
 */
export const WHATS_NEW_LANGUAGE_SWITCHER = {
  label: "Read this page in your language",
  /**
   * Always-present escape hatch to the browse-by-region index. Useful in
   * its own right, and it is the working path on the degraded render — if
   * Admin is unreachable when this static page is generated the combobox
   * falls back to the current language alone.
   */
  allLanguages: "Browse all languages",
} as const

export const WHATS_NEW_CONTENTS = [
  { id: "formats", label: "Every format" },
  { id: "improving", label: "What is improving" },
  { id: "why", label: "Why it matters" },
  { id: "next", label: "What's next" },
  { id: "team", label: "The team" },
  { id: "faq", label: "Questions" },
] as const

export const WHATS_NEW_LEDE = {
  eyebrow: "A history of changing formats",
  heading:
    "From a projector in a field, to page one of Google, to answers inside a conversation",
  /**
   * Closing line, rendered AFTER the stage. Every other paragraph of the
   * argument is a `beat` sitting above the era card it introduces, so the
   * section reads as one scroll and each paragraph describes the card
   * directly beneath it.
   */
  closing:
    "So Watch adapts again, the way it always has. A catalog that ranks well is not the same thing as a library an assistant can understand, cite, and hand to someone in the language they actually speak. That is what this redesign is for.",
} as const

/** Icon keys resolved to Lucide components in the page component. */
export type WhatsNewIconKey =
  | "compass"
  | "share"
  | "handshake"
  | "projector"
  | "videotape"
  | "search"
  | "conversation"
  | "home"
  | "play"
  | "globe"
  | "send"

/**
 * The delivery eras, in order. Rendered as the visual spine of the lede so
 * the argument — every era, the same instinct: meet people in the medium
 * they already use, in their own language — is legible without reading the
 * prose. The last entry is marked `current`; it is the one this redesign
 * is aimed at, and it gets the accent rule.
 */
export const WHATS_NEW_ERAS = [
  {
    icon: "projector",
    /**
     * Ambient-glow colour. Sampled from the photograph's lit ground and
     * saturated to a usable glow: the frame is a night screening, so its
     * only colour is tungsten projector light on sand.
     */
    glow: "#c8a552",
    year: "1979",
    kicker: "Where it started",
    title: "A projector and a screen",
    body: "Missionaries carried the film into villages and showed it in the local language — the story in a form anyone could follow.",
    /**
     * Hot-linked from the main jesusfilm.org WordPress library by
     * deliberate decision — not vendored into this repo. The host is
     * allowlisted in `next.config.mjs` under `/wp-content/uploads/**`, so
     * `next/image` fetches and optimizes it server-side rather than the
     * browser hot-linking it directly.
     */
    image: {
      src: "https://www.jesusfilm.org/wp-content/uploads/2026/08/Exposures-1-hi-res.png",
      alt: "A night screening: hundreds of children and adults seated on sand in front of a raised screen showing Jesus among a crowd, with a film projector on a tripod among them.",
      width: 1536,
      height: 1024,
    },
    beat: "The JESUS film did not begin as a website. It began as a screening. Missionaries carried projectors, screens, and generators into villages and towns and showed the life of Jesus in the local language — a visual, media-rich way to tell the story in a form anyone could follow, to any people group, anywhere.",
    current: false,
  },
  {
    icon: "videotape",
    /** Ambient-glow colour — warm timber of the auditorium. */
    glow: "#a35a33",
    year: "1980s",
    kicker: "Then",
    title: "Cassettes and discs",
    body: "VHS, then DVD. Each time the format changed, the film moved with it so partners could keep putting it into people's hands — and keep filling rooms with people watching together.",
    image: {
      src: "https://www.jesusfilm.org/wp-content/uploads/2025/01/Zo.webp?resize=768,512",
      alt: "A packed church auditorium watching the JESUS film together on two large screens beside a cross.",
      width: 768,
      height: 512,
    },
    beat: "The medium kept changing, so we changed with it. When VHS arrived, the film went out on cassettes. When DVDs replaced them, it went out on discs.",
    current: false,
  },
  {
    icon: "search",
    /** Ambient-glow colour — sunlit ground behind the phone. */
    glow: "#caa572",
    year: "2000s",
    kicker: "Then the web",
    title: "Online before YouTube",
    body: "One of the first video sites anywhere to offer free gospel media in many languages. Google rewarded it and sent an audience far beyond our partners — reaching whoever had a screen in their hand.",
    image: {
      src: "https://www.jesusfilm.org/wp-content/uploads/2025/01/App.webp?resize=768,512",
      alt: "Two people leaning over a phone together, watching the JESUS film on the Jesus Film Project app.",
      width: 768,
      height: 512,
    },
    beat: "Then the internet arrived, and Watch became one of the first video websites anywhere to put free Christian gospel media online in many languages — before YouTube existed. Google rewarded that: Watch has ranked on the first page for searches as significant as “Jesus,” and the audience stopped being only our partners.",
    current: false,
  },
  {
    icon: "conversation",
    /** Ambient-glow colour — the rendered panel's own violet. */
    glow: "#7c5cf0",
    year: "Today",
    kicker: "What is next",
    title: "Answers in conversation",
    body: "People increasingly ask an assistant instead of searching. Watch is being rebuilt so the right story, scene, and language can be found, cited, and shared inside that conversation.",
    beat: "Now the medium is changing again. A growing share of people no longer search — they ask. They put their question to ChatGPT and other AI assistants and receive an answer rather than a page of links. The moment of discovery is moving off the results page and into a conversation.",
    current: true,
  },
] as const satisfies readonly {
  icon: WhatsNewIconKey
  /**
   * Dominant colour sampled from the era's own photograph, lifted into a
   * readable range. Drives the YouTube-ambient-mode halo behind the card.
   * Re-derive if an image is swapped: quantise the image, pick the most
   * present colour weighted by saturation and lightness, then raise
   * lightness/saturation so a dark frame still throws a visible glow.
   */
  glow: string
  /**
   * Milestone label on the timeline rail. 1979 is the JESUS film's
   * theatrical release; the rest are deliberately decade-scale rather
   * than invented exact years. Replace with precise dates when the
   * history team confirms them.
   */
  year: string
  kicker: string
  title: string
  body: string
  /** Narrative paragraph rendered AFTER this era's card. */
  beat: string
  image?: { src: string; alt: string; width: number; height: number }
  current: boolean
}[]

/** Glyph keys resolved to hand-authored SVG marks in the diagram. */
export type WhatsNewFormatGlyph =
  | "reel"
  | "broadcast"
  | "cassette"
  | "disc"
  | "globe"
  | "search"
  | "assistant"

export const WHATS_NEW_FORMAT_DIAGRAM = {
  eyebrow: "One story, every format",
  heading: "The medium keeps changing. The story does not.",
  body: "Every time distribution moved, the JESUS film moved with it. The diagram below is the whole journey in one line — from a reel threaded onto a projector to an answer inside a conversation.",
} as const

/**
 * Finer-grained than the four eras on the timeline: it separates the
 * broadcast years, and splits the web into publishing, being found by
 * search, and being answered by an assistant. The last step is marked
 * terminal — it is the one still being built.
 */
export const WHATS_NEW_FORMATS = [
  { id: "reel", glyph: "reel", label: "Film reel", era: "1979" },
  { id: "broadcast", glyph: "broadcast", label: "Broadcast", era: "1980s" },
  { id: "vhs", glyph: "cassette", label: "VHS", era: "1980s" },
  { id: "dvd", glyph: "disc", label: "DVD", era: "1990s" },
  { id: "online", glyph: "globe", label: "Online", era: "2000s" },
  { id: "search", glyph: "search", label: "Search", era: "2000s" },
  { id: "assistant", glyph: "assistant", label: "Assistants", era: "Today" },
] as const satisfies readonly {
  id: string
  glyph: WhatsNewFormatGlyph
  label: string
  era: string
}[]

export const WHATS_NEW_IMPROVEMENTS = [
  {
    icon: "home",
    shot: {
      src: "/watch/images/whats-new/home.webp",
      alt: "The Watch home page: a cinematic featured story with the search bar above it and curated rows below.",
    },
    title: "A more useful place to begin",
    paragraphs: [
      "The Watch home page now provides a clearer and more visual way to discover content, with cinematic featured stories, curated collections, improved layouts, and more opportunities to continue exploring.",
      "The goal is not simply to show more videos. It is to help each person find something relevant more quickly.",
    ],
    points: [],
    featured: false,
  },
  {
    icon: "play",
    shot: {
      src: "/watch/images/whats-new/player.webp",
      alt: "A Watch video page with the rebuilt player and its playback, audio, and subtitle controls.",
    },
    title: "Better playback on more devices",
    paragraphs: [
      "The video experience has been rebuilt around a modern streaming platform. Improvements include:",
    ],
    points: [
      "Higher-quality playback, including 4K when an appropriate source is available",
      "More dependable fullscreen viewing, including on mobile devices",
      "Better audio and subtitle controls",
      "Visual previews while moving through a video",
      "Motion previews that help people understand a video before selecting it",
      "Faster loading and more resilient delivery",
    ],
    closing:
      "These improvements required substantial engineering work that may not always be visible, but they make Watch faster, clearer, and more dependable around the world.",
    featured: false,
  },
  {
    icon: "globe",
    shot: {
      src: "/watch/images/whats-new/language.webp",
      alt: "The Watch language index, listing available languages grouped by region.",
    },
    title: "Language is becoming central to the experience",
    paragraphs: [
      "Jesus Film Project has content in thousands of languages. That is one of the most important things Watch can offer, so language should not feel like an option hidden inside the player.",
      "We are improving how people:",
    ],
    points: [
      "Find content in their own language",
      "Distinguish between spoken-audio and subtitle languages",
      "Change languages without losing their place",
      "Search using words and questions natural to them",
      "Discover content available for their intended audience",
    ],
    closing:
      "Our direction is simple: people should be able to find the story of Jesus in the language they understand best.",
    featured: true,
  },
  {
    icon: "search",
    shot: {
      src: "/watch/images/whats-new/search.webp",
      alt: "Watch search open on the word “hope”, showing suggestions and matching videos.",
    },
    title: "Search that understands more than titles",
    paragraphs: [
      "People do not always know the name of the film they need. They may search for hope, anxiety, forgiveness, a Bible passage, or a question about Jesus.",
      "Watch search is being developed to understand this kind of intent across languages — not only exact film titles. Over time, search results will also become easier to share, revisit, and use as a starting point for ministry.",
    ],
    points: [],
    featured: false,
  },
  {
    icon: "send",
    shot: {
      src: "/watch/images/whats-new/share.webp",
      alt: "A Watch video page scrolled to its share and download controls.",
    },
    title: "Easier sharing and ministry use",
    paragraphs: [
      "Watch should serve the person watching and the person helping someone else watch. We are strengthening Watch as a dependable place for believers and ministry partners to:",
    ],
    points: [
      "Share a trusted link with someone",
      "Find content for a particular topic or language",
      "Embed videos in other experiences",
      "Download available ministry content",
      "Move from a full-length film to a smaller, more relevant scene or Bible passage",
    ],
    closing:
      "Instead of asking someone to begin with a two-hour film, a partner may eventually be able to share the exact scene or passage that fits the conversation.",
    featured: false,
  },
] as const satisfies readonly {
  icon: WhatsNewIconKey
  /**
   * Screenshot of the live Watch surface this improvement is about.
   * Captured by `scripts/capture-whats-new-shots.mjs` — re-run it after a
   * visual change rather than replacing these by hand, or they drift out
   * of step with the product they are describing.
   */
  shot: { src: string; alt: string }
  title: string
  paragraphs: readonly string[]
  points: readonly string[]
  closing?: string
  featured: boolean
}[]

export const WHATS_NEW_AUDIENCES = {
  eyebrow: "Why these changes matter",
  heading: "Watch serves three overlapping audiences",
  /**
   * `tint` drives each card's border, icon ring, and inner wash. Three
   * distinct hues so the audiences read as three different people rather
   * than three paragraphs; all drawn from the palette already on the page
   * (violet and crimson from the accent gradient, amber from the language
   * switcher's chip).
   */
  cards: [
    {
      icon: "compass",
      tint: "#7c5cf0",
      title: "For someone seeking answers",
      body: "Watch should help a person move from a question to a relevant story, teaching, or passage — and then offer a clear, appropriate next step.",
    },
    {
      icon: "share",
      tint: "#f0567c",
      title: "For someone sharing their faith",
      body: "Watch should make it simple to find and share a focused piece of trusted content with a friend, family member, or online community.",
    },
    {
      icon: "handshake",
      tint: "#e0a24c",
      title: "For ministry partners",
      body: "Watch should provide dependable language, playback, sharing, and download tools for ministry in both everyday and challenging contexts.",
    },
  ] as const satisfies readonly {
    icon: WhatsNewIconKey
    tint: string
    title: string
    body: string
  }[],
  closing:
    "Trying to place all three audiences into one generic catalog creates confusion. The new direction gives each person a clearer way into the content while preserving a shared platform underneath.",
} as const

/**
 * Guess-the-number quiz that opens the audiences section.
 *
 * `actualPercent` is Jesus Film Project's own figure for the share of
 * Watch visitors who are professional missionaries. It is a real claim on
 * a public page — re-confirm it against current analytics before launch,
 * and update `sourceNote` if the basis changes.
 */
export const WHATS_NEW_QUIZ = {
  eyebrow: "Before you read on",
  question:
    "What share of Watch visitors do you think are professional missionaries?",
  helper: "Drag to your best guess, then lock it in.",
  sliderLabel: "Your guess, as a percentage of Watch visitors",
  submit: "Lock in my guess",
  /** Dismisses the reveal and returns the reader to the slider. */
  dismiss: "Close",
  guessLabel: "Your guess",
  actualLabel: "Actually",
  actualPercent: 2,
  restLabel: "Seekers and believers",
  revealHeading: "About 2%.",
  revealBody:
    "Ninety-eight out of every hundred people who arrive at Watch are seekers and believers — most of them looking for something, not for us. That is why the experience has to serve them well.",
  revealPartners:
    "And it is why the other 2% matters just as much: missionaries and ministry partners depend on Watch for their work, and none of this is built at their expense.",
  overGuess: "That is {factor}× the real number.",
  closeGuess: "Closer than most people get.",
  underGuess: "Lower than the real figure — but the point still stands.",
} as const

export const WHATS_NEW_DIRECTIONS = {
  eyebrow: "Where Watch is going next",
  heading: "The foundation being built now makes these possible",
  intro: "The work underway provides a foundation for capabilities such as:",
  items: [
    "Shareable search results and topic pages",
    "Dedicated language and Bible-passage experiences",
    "Smaller, shareable video scenes and “video verses”",
    "Clearer next steps involving questions, Bible study, conversation, and connection",
    "Optional accounts that can preserve progress across web, mobile, and TV",
    "More relevant recommendations grounded in trusted content",
    "Expanded metadata, subtitles, and translations",
    "Connected experiences across Watch, mobile, and television",
    "New pages and journeys that can be assembled for particular audiences and ministry needs",
  ],
  noteTitle: "Directions, not release dates",
  notes: [
    "These are directions, not a promise that every capability is available today. We will introduce them carefully, learn from real use, and continue improving the experience.",
    "Watching, searching, and sharing will remain open without requiring an account. When sign-in is useful — for example, to retain progress or support particular tools — we want its purpose to be clear.",
  ],
} as const

/** Icon keys for the upcoming-features vote carousel. */
export type WhatsNewVoteIcon =
  | "search"
  | "language"
  | "passage"
  | "scene"
  | "playlist"
  | "next-step"
  | "account"
  | "recommend"
  | "device"
  | "journey"

/**
 * Vote carousel for the roadmap.
 *
 * IMPORTANT: there is no vote endpoint. Votes are held in this browser
 * only (localStorage) and are never sent anywhere, which is why the panel
 * says so on its face — a public ballot that silently discards input would
 * be worse than no ballot. Wire `POST` to a real collector before treating
 * any of this as signal.
 */
export const WHATS_NEW_VOTES = {
  eyebrow: "Help us prioritise",
  heading: "You have three stickers. Put them on what we should build first.",
  body: "Grab a sticker and drop it anywhere on a feature. All three on one, or spread them out.",
  budget: 3,
  remainingLabel: "Stickers left",
  pileHint: "Grab me to vote",
  armedHint: "Now drop it on a feature",
  placeLabel: "Stick",
  onLabel: "on",
  removeLabel: "Peel",
  fromLabel: "off",
  clear: "Take my stickers back",
  ideaLabel: "Not listed? Tell us your idea",
  previous: "Previous features",
  next: "More features",
  carouselLabel: "Upcoming features",
  localOnlyNote:
    "Votes stay in this browser for now — nothing is sent to us yet. We are building the collector next.",
  /** Three ways to say it — the sticker carries the reason, not just a tally. */
  stickers: [
    { id: "love", emoji: "\u2764\uFE0F", label: "Love this" },
    { id: "yes", emoji: "\uD83D\uDC4D", label: "Useful to me" },
    { id: "need", emoji: "\uD83D\uDE4C", label: "We need this" },
  ],
  features: [
    {
      id: "shareable-search",
      icon: "search",
      title: "Shareable search results",
      body: "Send someone a whole set of results, not just one video — a starting point for a conversation.",
    },
    {
      id: "language-experiences",
      icon: "language",
      title: "Dedicated language experiences",
      body: "A real home for each language, not a filter buried inside the player.",
    },
    {
      id: "bible-passages",
      icon: "passage",
      title: "Bible-passage experiences",
      body: "Go straight from a passage to the moment it is portrayed on screen.",
    },
    {
      id: "video-verses",
      icon: "scene",
      title: "Video verses and short scenes",
      body: "Share the exact scene that fits the conversation instead of a two-hour film.",
    },
    {
      id: "playlists",
      icon: "playlist",
      title: "Custom playlists",
      body: "Line up your own sequence of videos and scenes — for a course, a small group, or a trip — and share the whole thing as one link.",
    },
    {
      id: "next-steps",
      icon: "next-step",
      title: "Clearer next steps",
      body: "Questions, Bible study, conversation, and connection offered at the right moment.",
    },
    {
      id: "accounts",
      icon: "account",
      title: "Optional accounts",
      body: "Keep your place across web, mobile, and TV — only if you want to.",
    },
    {
      id: "recommendations",
      icon: "recommend",
      title: "Better recommendations",
      body: "Suggestions grounded in trusted content rather than raw popularity.",
    },
    {
      id: "connected-devices",
      icon: "device",
      title: "Connected across devices",
      body: "One experience that carries between Watch, mobile, and television.",
    },
    {
      id: "assembled-journeys",
      icon: "journey",
      title: "Journeys built for a purpose",
      body: "Pages assembled for a particular audience, campaign, or ministry need.",
    },
  ],
} as const satisfies {
  eyebrow: string
  heading: string
  body: string
  budget: number
  remainingLabel: string
  pileHint: string
  armedHint: string
  placeLabel: string
  onLabel: string
  removeLabel: string
  fromLabel: string
  clear: string
  ideaLabel: string
  previous: string
  next: string
  carouselLabel: string
  localOnlyNote: string
  stickers: readonly { id: string; emoji: string; label: string }[]
  features: readonly {
    id: string
    icon: WhatsNewVoteIcon
    title: string
    body: string
  }[]
}

export const WHATS_NEW_TEAM = {
  eyebrow: "Built by a broad team",
  heading: "The visible changes represent only part of the work",
  paragraphs: [
    "Developers, designers, product teams, video specialists, translators, content teams, data teams, and ministry partners have contributed to the new foundation.",
    "We want to recognize that work and continue building Watch together.",
  ],
  contributionsLabel: "Contributions include",
  contributions: [
    "Streaming infrastructure",
    "Search",
    "Accessibility",
    "Language support",
    "Performance",
    "Playback controls",
    "Metadata",
    "Downloads",
    "Feedback systems",
    "Watch authoring tools",
  ],
} as const

export const WHATS_NEW_ICEBERG = {
  alt: "An iceberg: a small bright tip above the waterline and a far larger mass below it.",
  tip: "What you see",
  mass: "What holds it up",
} as const

/**
 * FAQ.
 *
 * Answers are deliberately conservative: this page is public, so an
 * over-promise here is a support ticket later. Two need confirming before
 * launch — see the flags in the answers marked NEEDS-CONFIRMATION.
 */
export const WHATS_NEW_FAQ = {
  eyebrow: "Frequently asked",
  heading: "Questions? Answers.",
  expandAll: "Expand all",
  collapseAll: "Collapse all",
  items: [
    {
      id: "removal",
      question: "Is anything being removed from Watch?",
      answer:
        "No. Everything you can do today — find a film, choose a language, play it, share it, download what is available — you can still do. The changes add ways in; they do not close the ones you already use.",
    },
    {
      id: "account",
      question: "Do I need an account to watch or share?",
      answer:
        "No. Watching, searching, and sharing stay open without one. If sign-in becomes useful for something specific, such as keeping your place across web, mobile, and TV, we want its purpose to be obvious rather than assumed.",
    },
    {
      id: "languages",
      question: "Will my language still be available?",
      answer:
        "Yes. Language coverage is not shrinking — it is the thing the new experience is being built around. Finding content in your own language should get easier, not harder.",
    },
    {
      id: "links",
      question: "Will links I have already shared keep working?",
      // NEEDS-CONFIRMATION: phrased as intent, not a guarantee.
      answer:
        "That is the intention. Existing watch links are redirected to their new addresses rather than dropped. If you find one that does not resolve, please tell us — that is exactly the kind of report we want.",
    },
    {
      id: "downloads",
      question: "Can I still download videos for offline ministry use?",
      answer:
        "Yes. Downloads remain available for the content that allows them, and dependable offline use for partners in difficult contexts stays a requirement, not a nice-to-have.",
    },
    {
      id: "timing",
      question: "When will all of this arrive?",
      answer:
        "Some of it is already live — the home page, the playback platform, and much of the language work. The rest is being introduced gradually, which is why the roadmap above is written as direction rather than dates.",
    },
    {
      id: "cost",
      question: "Is Watch still free?",
      answer:
        "Yes. Nothing described on this page introduces a cost to watch, share, or download.",
    },
    {
      id: "feedback",
      question: "How do I report a problem or ask for something?",
      answer:
        "Use the feedback control on any Watch page, or the Share feedback button on this one. Requests and bug reports both land with the team that works on Watch.",
    },
  ],
} as const

export const WHATS_NEW_CLOSING = {
  eyebrow: "Help us improve Watch",
  heading: "If something is unclear, tell us",
  paragraphs: [
    "We know that significant changes need explanation, and we do not want to wait until confusion becomes a problem.",
    "If something is unclear, difficult to use, or missing, please tell us. Your feedback helps us understand what people need and where Watch should improve next.",
  ],
} as const

export const WHATS_NEW_METADATA = {
  title: "Watch is changing. Here's why. | Jesus Film Project",
  description:
    "Why the Jesus Film Project Watch experience is changing: from projectors and VHS, to one of the first free gospel video sites online, to page one of Google, to a library people can find through AI assistants — in their own language.",
} as const
