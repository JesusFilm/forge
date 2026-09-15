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

/**
 * The deck deliberately does NOT sell the redesign. Most readers who reach
 * this page arrive irritated — something they relied on moved or broke — and
 * to that reader "a better way to find, watch and share" (the previous deck)
 * is the claim under dispute, asserted before anything has been conceded.
 * So the first screen names their situation and lists what the page will
 * answer, in the order they care about it.
 *
 * `lastUpdated` is a hand-maintained date, printed under the deck. A page
 * titled "what's new" carrying no date reads stale on its second day, and
 * the leadership audience checks it before the copy. Nothing updates it
 * automatically: move it by hand whenever any claim on this page moves,
 * and treat a stale date as worse than none — it dates the wrong copy.
 */
export const WHATS_NEW_HERO = {
  eyebrow: "Jesus Film Watch · Product update",
  title: "Jesus Film Watch is changing. Here's why.",
  // Promises only what the page still delivers. An earlier draft also
  // offered "what has not changed" and "what we have already fixed",
  // which were two sections that have since been removed — a deck that
  // lists contents the page does not have is a worse first screen than a
  // vague one, because the reader goes looking.
  deck: "If Jesus Film Watch has changed under you, this page is for you: why it changed, what is coming next, and where to tell us when something breaks.",
  lastUpdatedLabel: "Last updated",
  lastUpdated: "31 August 2026",
  /**
   * The same day as `lastUpdated`, for the rendered `<time datetime>`. Two
   * fields for one fact is a drift hazard, so a test in
   * `__tests__/whats-new-content.test.ts` parses this and asserts it names
   * the day the prose above names. Update both, or that test fails.
   */
  lastUpdatedIso: "2026-08-31",
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
} as const

/**
 * The page's fragment anchors, in render order. Nothing renders this as a
 * nav today; it is the registry the page test walks to prove every id it
 * names is a section that actually exists.
 */
export const WHATS_NEW_CONTENTS = [
  { id: "why", label: "Why it matters" },
  { id: "partners", label: "For partners" },
  { id: "formats", label: "Every format" },
  { id: "assistants", label: "The AI shift" },
  { id: "improving", label: "What is improving" },
  { id: "board", label: "The board" },
  { id: "faq", label: "Questions" },
] as const

export const WHATS_NEW_LEDE = {
  eyebrow: "A history of changing formats",
  heading:
    "From a projector in a field, to the first page of Google, to an answer inside ChatGPT",
  /**
   * Closing line, rendered AFTER the stage. Every other paragraph of the
   * argument is a `beat` sitting above the era card it introduces, so the
   * section reads as one scroll and each paragraph describes the card
   * directly beneath it.
   */
  closing:
    "So Jesus Film Watch adapts again, the way it always has. A catalog that ranks well is not the same thing as a library an assistant can understand, cite, and hand to someone in the language they actually speak. That is what this redesign is for.",
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
    beat: "Then the internet arrived, and Jesus Film Watch became one of the first video websites anywhere to put free Christian gospel media online in many languages — before YouTube existed. Google rewarded that: Jesus Film Watch has ranked on the first page for searches as significant as “Jesus,” and the audience stopped being only our partners.",
    current: false,
  },
  {
    icon: "conversation",
    /** Ambient-glow colour — the rendered panel's own violet. */
    glow: "#7c5cf0",
    year: "Today",
    kicker: "What is next",
    title: "Answers in conversation",
    body: "People increasingly ask an assistant instead of searching. Jesus Film Watch is being rebuilt so the right story, scene, and language can be found, cited, and shared inside that conversation.",
    /**
     * Split out of `beat` so it can be rendered bold: this is the sentence
     * the whole section turns on, and the eras before it are setup for it.
     * The renderer emits it as a `<strong>` ahead of the rest of the beat.
     */
    beatLead: "Now the medium is changing again.",
    beat: "A growing share of people no longer search — they ask. They put their question to ChatGPT and other AI assistants and receive an answer rather than a page of links. The moment of discovery is moving off the results page and into a conversation.",
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
  /**
   * Opening sentence split out of `beat` so the renderer can bold it.
   * Optional, and deliberately used once: the emphasis marks the pivot the
   * earlier eras build to, and it stops meaning anything if they all have
   * one.
   */
  beatLead?: string
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

/**
 * The AI-assistant section: the traffic chart, the argument for why that
 * traffic is worth chasing, and the published research behind it.
 *
 * Everything in `SOURCES` is a real, checkable claim on a public page.
 * Rules for editing it:
 *
 * - `quote` is verbatim from the linked source, or from that source's own
 *   published summary. If you cannot find the sentence at the URL, do not
 *   paraphrase it into quotation marks — move it into `finding` instead.
 * - `finding` is our own one-line reading of the study, in our words.
 * - Re-check the whole block before any major re-publication of this
 *   page. Three of the four studies are annual or repeated, so the
 *   headline numbers move.
 */
export const WHATS_NEW_ASSISTANTS = {
  eyebrow: "The shift already underway",
  heading:
    "The fastest-growing way people reach Jesus Film Watch is AI conversations",
  intro: [
    "The chart below is referrals to our site from AI assistants — people who asked ChatGPT, Gemini, Copilot, or Perplexity a question and arrived here from the answer. For most of the period it is a flat, noisy line. Then it is not.",
    "Nothing about our catalog changed to produce the right-hand side of that curve. What changed is where people go first when they have a question.",
  ],
  /**
   * NEEDS-CONFIRMATION before launch: the metric label and the period.
   *
   * The chart carries NO axes at all — no vertical scale, no time labels.
   * The shape is the claim, not the magnitude, so no number on this page
   * depends on the series being exact. `metric` and `period` are the only
   * statements of fact the figure makes; confirm both against the
   * analytics export. If real figures ever land in the component's
   * `SERIES`, label the axis then.
   */
  chart: {
    metric: "Visits to our site referred by AI assistants",
    period: "Internal analytics",
    /** Screen-reader description; the chart carries no readable numbers. */
    alt: "A line chart of visits referred to our site by AI assistants. The line holds a low, noisy, roughly flat level across the first two thirds of the period, then climbs steeply and repeatedly to its highest point at the right-hand edge.",
  },
  /**
   * The phone: the moment this section is about, shown once.
   *
   * It used to sit beside a "why this traffic matters" heading and three
   * reason cards making the same case in prose. Those were removed — the
   * transcript IS the argument, and showing it once beat asserting it
   * three times beside it.
   *
   * This is a REAL exchange, captured from a public ChatGPT share link
   * (`sourceHref`) — someone asks which Jesus film is most accurate, and
   * the assistant answers with our catalogue, cited by name and linked.
   * It replaced an invented mock-up, which is a meaningful upgrade: the
   * section's whole claim is that this already happens, and an invented
   * transcript could not evidence that.
   *
   * Rules for editing it:
   *
   * - It is abridged, not paraphrased. Every line here appears verbatim
   *   in the source. Trim whole sentences; never reword one, or the quote
   *   marks on the page start lying.
   * - `disclaimer` and `sourceLabel` stay. Showing a branded, real-looking
   *   transcript without saying it is abridged and without a link to the
   *   original is the difference between evidence and an advert.
   * - If the share link dies, this block has to go or be re-captured. An
   *   unverifiable transcript in a vendor's chrome is worse than no
   *   illustration at all.
   *
   * Captured 2026-08-26.
   */
  phone: {
    appLabel: "ChatGPT",
    messages: [
      {
        from: "person",
        text: "What is the most accurate movie about Jesus that I can watch online for free?",
      },
      {
        from: "assistant",
        text: "If by \u201Caccurate\u201D you mean closest to the biblical text rather than the most entertaining adaptation, I\u2019d recommend LUMO\u2019s Gospel films, especially The Gospel of Luke.",
        /** Rendered as ChatGPT's inline source chips. */
        sources: ["LUMO", "Jesus Film Project"],
      },
      {
        from: "assistant",
        text: "You can watch the LUMO Gospel films free through Jesus Film Project, including Matthew, Mark, Luke, and John.",
        citation: {
          title: "Watch LUMO Gospel films free on Jesus Film Project",
          source: "jesusfilm.org",
          /**
           * The production thumbnail for the exact film the answer
           * recommends — LUMO's Gospel of Luke — pulled from our own
           * Cloudflare Images delivery, the same asset
           * `/watch/lumo-the-gospel-of-luke.html` renders. Not a stand-in:
           * pairing a real title with someone else's still would
           * misrepresent what the card previews.
           *
           * `imagedelivery.net` is already allowlisted in
           * `next.config.mjs`, so `next/image` optimises it server-side
           * rather than the browser hot-linking it.
           */
          thumbnail: {
            src: "https://imagedelivery.net/tMY86qEHFACTO8_0kAeRFA/6_GOLuke2601.mobileCinematicHigh.jpg/f=jpg,w=640,h=300,q=95",
            alt: "",
            width: 640,
            height: 300,
          },
        },
      },
    ],
    /** Placeholder in the mocked composer; never a real input. */
    composer: "Ask ChatGPT",
    /**
     * The question again, pre-split into the lines the composer types it
     * on. Two constraints, both guarded by tests:
     *
     * 1. Joined with single spaces these MUST equal `messages[0].text`.
     *    The composer types one thing and the bubble sends another the
     *    moment they drift, and nothing about the rendered page would
     *    look wrong — the two are never on screen at the same time.
     * 2. Each line is set `white-space: nowrap`, so its height is exactly
     *    one line-height and the typing reveal stays exact. That means a
     *    line too long to fit is CLIPPED rather than wrapped: keep them
     *    to 22 characters or fewer.
     *
     * The 22 is MEASURED, not guessed — an earlier 28 put "What is the
     * most accurate" straight under the send button with its tail cut off.
     * The line's type size is proportional to the device width (`cqw`), so
     * a line that fits at one phone size fits at all of them, which is
     * what makes a fixed character budget meaningful here at all.
     */
    typedLines: [
      "What is the most",
      "accurate movie about",
      "Jesus that I can watch",
      "online for free?",
    ],
    disclaimer: "A real ChatGPT conversation, abridged to fit.",
    sourcesLabel: "Sources",
    sourceLabel: "See the full exchange",
    sourceHref:
      "https://chatgpt.com/share/6a8eed41-73d4-83ea-8c51-9876a0bb00bd",
    /**
     * Screen-reader description. The device is one image to assistive
     * tech; a reader who cannot see it should still get the point it is
     * making rather than a bare "image".
     */
    alt: "A phone showing a ChatGPT conversation. Someone asks which film about Jesus is the most accurate one they can watch online for free. ChatGPT recommends the LUMO Gospel films, cites Jesus Film Project as a source, and links to watch them free on jesusfilm.org.",
  },
  researchEyebrow: "What people actually talk about",
  researchHeading:
    "The published research says these conversations are personal",
  researchIntro: [
    "The reason this matters for a ministry is not the traffic number. It is the subject matter. Study after study now finds that the single largest thing people bring to an AI assistant is not code, or email, or homework — it is themselves.",
  ],
  /**
   * Summary on the disclosure that holds the three studies.
   *
   * The studies are the page's strongest material for a leadership reader
   * and its heaviest for the partner it is written for — a working number
   * of paragraphs about an NBER paper, between them and the answer they
   * came for. Collapsed, the plain-language claim in `researchIntro` above
   * still carries the argument; open, nothing is abridged.
   *
   * `researchIntro` therefore has to stand ALONE, and `closing` must not
   * point at the list as though the reader can see it. The first closing
   * line used to open "Put those findings next to each other" — which
   * dangles the moment the list is shut.
   */
  sourcesToggleLabel: "Read the three studies",
  sources: [
    {
      id: "hbr",
      finding:
        "“Therapy/companionship” was the number-one use of generative AI for the second year running, roughly doubling its share of the dataset.",
      quote: "Therapy/companionship",
      quoteNote: "the study's own label for its top-ranked use case",
      attribution: "Marc Zao-Sanders, “How People Are Really Using AI in 2026”",
      publication: "Harvard Business Review",
      date: "June 2026",
      href: "https://hbr.org/2026/06/how-people-are-really-using-ai-in-2026",
    },
    {
      id: "nber",
      finding:
        "Across a representative sample of ChatGPT conversations, the great majority of messages had nothing to do with work.",
      quote: "More than 70% of all usage",
      quoteNote: "is non-work-related",
      attribution:
        "Chatterji, Cunningham, Deming, Hitzig, Ong, Shan & Wadman, “How People Use ChatGPT”",
      publication: "NBER Working Paper 34255",
      date: "September 2025",
      href: "https://www.nber.org/papers/w34255",
    },
    {
      id: "common-sense",
      finding:
        "Seventy-two percent of US teenagers had used an AI companion, and about one in three of those users had taken something serious to it rather than to a person.",
      quote:
        "Have chosen to discuss important or serious matters with AI companions instead of real people.",
      quoteNote: "about one in three teen AI-companion users",
      attribution: "“Talk, Trust, and Trade-offs”",
      publication: "Common Sense Media",
      date: "July 2025",
      href: "https://www.commonsensemedia.org/press-releases/nearly-3-in-4-teens-have-used-ai-companions-new-national-survey-finds",
    },
  ],
  /** The turn: from what the research says to what we owe it. */
  closingEyebrow: "What we owe it",
  closingHeading:
    "People are already having the conversation. We should be findable inside it.",
  closing: [
    "The studies count different things and point the same way. Millions of people are describing loneliness, grief, guilt, fear, and the search for meaning to a machine, at three in the morning, because it is available and it does not judge them. Some of them are asking directly about Jesus. Many more are circling the questions the story of Jesus answers, without ever using a word that would have matched a search query.",
    "We are not going to be the therapist in that conversation, and we should not try to be. But when someone asks what forgiveness means, or why they cannot stop feeling ashamed, or who Jesus actually was, there is a two-hour film, and thousands of scenes inside it, in thousands of languages — and an assistant can only offer any of that if it can find it, understand it, and cite it.",
    "That is the whole reason for the work described on this page. Search that understands intent rather than titles. Scenes small enough to be handed to one person at one moment. Language treated as a first-class part of the library rather than a setting inside a player. Metadata and transcripts written so a machine can tell what a video is actually about. None of it is chasing a trend. It is the same instinct that put a projector in a field: go where people already are, in the language they already speak.",
  ],
} as const

export const WHATS_NEW_IMPROVEMENTS = [
  {
    shot: {
      src: "/watch/images/whats-new/home.webp",
      alt: "The Jesus Film Watch home page: a cinematic featured story with the search bar above it and curated rows below.",
    },
    clip: {
      webm: "/watch/assets/whats-new/home.webm",
      mp4: "/watch/assets/whats-new/home.mp4",
    },
    tint: { from: "#4f46e5", to: "#a855f7" },
    title: "A more useful place to begin",
    paragraphs: [
      "The home page now opens on a featured story, with search above it and curated rows below — so someone who arrives without a title in mind still has somewhere to start.",
      "The goal is not to show more videos. It is to get each person to something relevant sooner.",
    ],
    points: [],
    featured: false,
  },
  {
    shot: {
      src: "/watch/images/whats-new/player.webp",
      alt: "A Jesus Film Watch video page with the rebuilt player and its playback, audio, and subtitle controls.",
    },
    clip: {
      webm: "/watch/assets/whats-new/player.webm",
      mp4: "/watch/assets/whats-new/player.mp4",
    },
    tint: { from: "#0e7490", to: "#38bdf8" },
    title: "Better playback on more devices",
    paragraphs: [
      "The player has been rebuilt on a new video service. What that means where you are watching:",
    ],
    points: [
      "Sharper picture, up to 4K where the film itself was made at that quality",
      "Fullscreen that works properly, including on phones",
      "Audio and subtitle controls that are easier to find and to change",
      "A preview of the picture as you drag through a video",
      "Short moving previews, so you can tell what a video is before you open it",
      "Faster starts, and fewer failures on a weak connection",
    ],
    featured: false,
  },
  {
    shot: {
      src: "/watch/images/whats-new/language.webp",
      alt: "The Jesus Film Watch language index, listing available languages grouped by region.",
    },
    clip: {
      webm: "/watch/assets/whats-new/language.webm",
      mp4: "/watch/assets/whats-new/language.mp4",
    },
    tint: { from: "#db2777", to: "#fb923c" },
    title: "Language is becoming central to the experience",
    paragraphs: [
      "Jesus Film Project has content in thousands of languages. That is one of the most important things Jesus Film Watch can offer, so language should not feel like an option hidden inside the player.",
      "We are improving how people:",
    ],
    points: [
      "Find content in their own language",
      "Distinguish between spoken-audio and subtitle languages",
      "Change languages without losing their place",
      "Search using words and questions natural to them",
      "See at a glance what exists in a language before they go looking for it",
    ],
    closing:
      "Our direction is simple: people should be able to find the story of Jesus in the language they understand best.",
    featured: true,
  },
  {
    shot: {
      src: "/watch/images/whats-new/search.webp",
      alt: "Jesus Film Watch search open on the word “hope”, showing suggestions and matching videos.",
    },
    clip: {
      webm: "/watch/assets/whats-new/search.webm",
      mp4: "/watch/assets/whats-new/search.mp4",
    },
    tint: { from: "#047857", to: "#34d399" },
    title: "Search that understands more than titles",
    paragraphs: [
      "People do not always know the name of the film they need. They may search for hope, anxiety, forgiveness, a Bible passage, or a question about Jesus.",
      "Jesus Film Watch search is being developed to understand this kind of intent across languages — not only exact film titles. Over time, search results will also become easier to share, revisit, and use as a starting point for ministry.",
    ],
    points: [],
    featured: false,
  },
  {
    shot: {
      src: "/watch/images/whats-new/share.webp",
      alt: "A Jesus Film Watch video page scrolled to its share and download controls.",
    },
    clip: {
      webm: "/watch/assets/whats-new/share.webm",
      mp4: "/watch/assets/whats-new/share.mp4",
    },
    tint: { from: "#b45309", to: "#fbbf24" },
    title: "Easier sharing and ministry use",
    paragraphs: [
      "Jesus Film Watch should serve the person watching and the person helping someone else watch. We are strengthening Jesus Film Watch as a dependable place for believers and ministry partners to:",
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
  /**
   * Screenshot of the live Watch surface this improvement is about.
   * Captured by `scripts/capture-whats-new-shots.mjs` — re-run it after a
   * visual change rather than replacing these by hand, or they drift out
   * of step with the product they are describing.
   */
  shot: { src: string; alt: string }
  /**
   * Looping screencast of the same surface being used, recorded by
   * `scripts/capture-whats-new-clips.mjs`. The still above is its poster,
   * so a card is never blank while the clip loads — and stays the whole
   * story under reduced motion, where the clip is never fetched.
   */
  clip: { webm: string; mp4: string }
  /**
   * The two stops of the gradient mat the clip sits on. Five distinct hue
   * pairs so the grid has a rhythm as you scroll rather than five identical
   * dark rectangles; adjacent cells never share a family (the two-up rows
   * are indigo/cyan and emerald/amber, the full-width language cell takes
   * the warmest pair). Same `tint`-in-content convention as
   * WHATS_NEW_AUDIENCES — the hex lives here, the mixing lives in the
   * component.
   */
  tint: { from: string; to: string }
  title: string
  paragraphs: readonly string[]
  points: readonly string[]
  closing?: string
  featured: boolean
}[]

/**
 * The platform move, told for the people who feel it most: partners
 * working where connections are slow and languages are small.
 *
 * Cut to a single paragraph on request. What it used to carry, and why it
 * is not coming back piecemeal:
 *
 * - Three bullet points and a separate downloads sub-block. The downloads
 *   story now lives in the letter's `future.shipped` list, where a partner
 *   meets it as a commitment rather than as a spec.
 * - A hand-counted support-ticket KPI pair (5 playback complaints in the
 *   five months before the June 2026 update, 0 in the 881 tickets of the
 *   twelve weeks after, 2.0 per 1,000 across the 21 months before) plus the
 *   method note that made it honest. Removed with its note, together: the
 *   figures were only publishable BECAUSE the note said they were
 *   hand-counted and measured against an update that shipped the migration
 *   and the redesign at once. If any of those numbers ever comes back, its
 *   window and its method come back with it — a bare "0" reads as "zero
 *   complaints, ever", which is not what was measured.
 *
 * Both vendor names stay. "We moved the whole library" means nothing
 * without the two ends of the move, and a reader who knows the industry
 * can only judge the claim if they know what we left and what we chose.
 */
export const WHATS_NEW_DELIVERY = {
  eyebrow: "Under the hood",
  icon: "videotape",
  heading:
    "Videos now start faster and download more reliably — especially in smaller languages",
  paragraph:
    "Stalled playback, videos that would not start until something had warmed up, and downloads that failed in the places our partners actually work were mostly not ours to fix — they belonged to the company whose video service we were renting. So we moved the whole library to a different one (from Brightcove to Mux, if the names mean anything to you), which stores every film at several quality levels and picks one for each viewer. None of that is visible on the page, which is the point: in the field it shows up as a video that starts, plays, and finishes downloading.",
} as const

export const WHATS_NEW_AUDIENCES = {
  eyebrow: "Why these changes matter",
  heading: "Jesus Film Watch Library serves three overlapping audiences",
  /**
   * `tint` drives each card's border, icon ring, and inner wash. Three
   * distinct hues so the audiences read as three different people rather
   * than three paragraphs; all drawn from the palette already on the page
   * (violet and crimson from the accent gradient, amber from the language
   * switcher's chip).
   */
  /**
   * ORDER IS LOAD-BEARING, in two ways.
   *
   * Ministry partners leads. It is the card the estimate stage keeps —
   * the one still on screen when the question about it arrives — so it
   * starts in the left column and stays there while the other two clear
   * away. It also renumbers the set: partners is `01`.
   *
   * And the ordinals are rendered from this array's index, so reordering
   * here renumbers the cards on the page. That is intended; what must not
   * happen is the numbers drifting out of step with the columns.
   */
  cards: [
    {
      icon: "handshake",
      tint: "#e0a24c",
      title: "For ministry partners",
      body: "Jesus Film Watch should provide dependable language, playback, sharing, and download tools for ministry in both everyday and challenging contexts.",
    },
    {
      icon: "share",
      tint: "#f0567c",
      title: "For someone sharing their faith",
      body: "Jesus Film Watch should make it simple to find and share a focused piece of trusted content with a friend, family member, or online community.",
    },
    {
      icon: "compass",
      tint: "#7c5cf0",
      title: "For someone seeking answers",
      body: "Jesus Film Watch should help a person move from a question to a relevant story, teaching, or passage — and then offer a clear, appropriate next step.",
    },
  ] as const satisfies readonly {
    icon: WhatsNewIconKey
    tint: string
    title: string
    body: string
  }[],
} as const

/**
 * The share of Jesus Film Watch visitors who are there for ministry work.
 *
 * Declared once, above the quiz, because three separate sentences print it —
 * the reveal heading, the reveal's note to partners, and the letter's
 * pull-quote via the quiz's `actualPercent`. Two of those used to carry
 * their own literal "2%", so a corrected figure would have left the page
 * printing two different numbers about the same audience and discrediting
 * both.
 */
const MINISTRY_SHARE_PERCENT = 2

/**
 * Guess-the-number quiz that opens the audiences section.
 *
 * `actualPercent` is Jesus Film Project's own figure for the share of
 * Jesus Film Watch visitors who are there for ministry work. It is a real
 * claim on a public page — re-confirm it against current analytics before
 * launch, and update the wording if the basis changes.
 *
 * The question deliberately does NOT say "professional missionaries", which
 * is what it asked first. Most of the people this page is written for are
 * volunteers, pastors, church planters, translators and radio hosts — read
 * the ministry board at the foot of the page — and none of them would count
 * themselves in that noun. A reader who excludes themselves from the
 * category reads the answer as being about somebody else, which loses the
 * one number the whole section exists to land. The noun here MUST match
 * whatever the analytics figure actually measures; if the measure is
 * narrower than "using it for ministry work", narrow this line to match
 * rather than leaving the broader claim standing.
 */
export const WHATS_NEW_QUIZ = {
  eyebrow: "Before you read on",
  question:
    "What share of Jesus Film Watch visitors do you think are using it for ministry work?",
  helper: "Drag to your best guess, then lock it in.",
  sliderLabel: "Your guess, as a percentage of Jesus Film Watch visitors",
  submit: "Lock in my guess",
  /** Dismisses the reveal and returns the reader to the slider. */
  dismiss: "Close",
  guessLabel: "Your guess",
  actualLabel: "Actually",
  actualPercent: MINISTRY_SHARE_PERCENT,
  restLabel: "Seekers and believers",
  revealHeading: `About ${MINISTRY_SHARE_PERCENT}%.`,
  revealBody:
    "Ninety-eight out of every hundred people who arrive at Jesus Film Watch are seekers and believers — most of them looking for something, not for us. That is why the experience has to serve them well.",
  // Interpolated, never retyped: this line used to carry its own literal
  // "2%", so editing the share above would have left two different numbers
  // on the same panel.
  revealPartners: `And it is why the other ${MINISTRY_SHARE_PERCENT}% matters just as much: missionaries and ministry partners depend on Jesus Film Watch for their work, and none of this is built at their expense.`,
  overGuess: "That is {factor}× the real number.",
  closeGuess: "Closer than most people get.",
  underGuess: "Lower than the real figure — but the point still stands.",
} as const

/**
 * A signed letter to missionaries and field partners.
 *
 * The letter exists to land ONE fact: they are about 2% of Watch's
 * visitors, and almost none of them know it. It gets there through the
 * video-store parable rather than by argument, because the belief being
 * corrected is not a mistake of reasoning — it is what Watch honestly
 * looks like from inside their circle. The store is what makes the
 * arithmetic feel obvious instead of insulting: a shop built for the
 * people who know which box they came for is a bewildering place for
 * whoever just wandered in.
 *
 * Do not soften the figure into "you are our main focus". That was an
 * early draft and it is the belief the letter is meant to correct — a
 * partner who keeps it reads every layout decision as a betrayal instead
 * of as arithmetic.
 *
 * The letter carries its own proof rather than promising it: the
 * `future.shipped` list below names work a reader can go and use today,
 * and the platform move behind the playback and download claims is in
 * `WHATS_NEW_DELIVERY`, further down the page. Keep proof in the letter,
 * not in a forward reference — the reader who needs this letter most is
 * the one least willing to extend credit for evidence arriving later.
 *
 * The letter still sits after the audiences section, because it answers
 * the question the estimate stage has just put to the reader and quotes
 * that stage's figure.
 *
 * First person singular on purpose: the rest of the page speaks as "we",
 * and this one place does not, because a sentence like "you are 2%" is
 * only worth printing if someone is standing behind it. `signature.name`
 * is a real person on a public page — if the signer changes, change the
 * voice with it.
 *
 * Deliberately NOT printing a reply address: the closing action is the
 * shared feedback composer, so reports land where the team already reads
 * them and no inbox gets scraped off a public page.
 *
 * The share of visitors is interpolated from the quiz above, never
 * retyped: two different numbers on one page would discredit both.
 */
export const WHATS_NEW_PARTNER_LETTER = {
  eyebrow: "A note to missionaries and field partners",
  // The question the letter exists to answer, in the reader's own terms.
  // It was "Tell me if this sounds about right." — the letter's ASK, not
  // its subject, which made the section look like a survey; that line
  // still closes the letter in `ask` below, where it belongs.
  //
  // Leading "Why" is added to the phrase as briefed: without it the
  // heading is a sentence fragment, and with it the heading IS the
  // question the first paragraph then answers.
  heading: "Why we are changing it at all, when it was working for you",
  // "Hey there —" was the first draft. It is a register that belongs to one
  // country and one generation: a good share of the people this letter is
  // written for are reading in their second or third language, or come from
  // places where a stranger opening that way reads as unserious. The letter
  // is asking them to accept an unflattering number from someone they have
  // never met, so it opens the way a letter does.
  greeting: "Dear friends —",
  beforeFigure: [
    "We are rebuilding Jesus Film Watch, and by now you will have noticed — a few of the things you reach for have moved. A release note can tell you what moved. It cannot tell you this.",
    "To answer that, let me ask you to picture a Christian video store in a busy city centre. It was opened for people like you — partners and missionaries who use media to serve God. You came in and got what you needed: VHS tapes, DVDs, a projector, video files to take with you on a mission trip.",
    "Then, slowly, other people started coming through the door. Ordinary believers, and people who were not believers at all, wandering in to see what was on the shelves and watch a film about Jesus. Especially people whose language has almost nothing else online — for them, this shop is very nearly the only one. Google noticed that the people it sent here found what they came for, and started sending more of them. Then more again.",
    "Today, if you stood by the door and counted:",
  ],
  /**
   * The pull-quote. It is the whole reason the letter exists, so it is set
   * as a figure rather than buried in a paragraph — and `value` comes from
   * the quiz, so the page can never print two different shares.
   */
  figure: {
    value: `${WHATS_NEW_QUIZ.actualPercent}%`,
    claim:
      "of the people in the shop are professionals doing ministry work. The other ninety-eight in every hundred walked in off the street.",
  },
  afterFigure: [
    "To serve the people now filling the store, we have to change how the store is laid out: what goes in the window, what sits at the front, how the shelves are grouped, which films we put on display and how we describe them. A shop arranged for someone who knows exactly which box they came for is a bewildering place for someone who wandered in because a film about Jesus came up in a Google search.",
    "You see the Jesus Film library the way you use it — as ministry equipment — and so does everyone you talk to about it. From inside that circle it looks like a tool for people like you, with some visitors passing through. It is the other way around.",
    "It changes what the front door has to do. When we have to choose between a front page that assumes you know what you are looking for and one that assumes you do not, we have to build the second one, because ninety-eight times out of a hundred that is the person standing there. Language, downloads, sharing, embedding — none of it goes away. It stops being the first thing every visitor sees.",
  ],
  /**
   * The letter's turn from explanation to loyalty.
   *
   * It replaces a single paragraph that pointed at one fixed bug as proof.
   * One fix reads as an exception; a list of shipped work reads as a
   * direction, which is the thing a partner is actually trying to work out
   * — not "did they fix my thing" but "are they still on my side".
   *
   * `shipped` is what a reader can go and use TODAY, and every claim in it
   * has to survive them clicking through. `coming` is direction and is
   * phrased as direction: no dates, no "soon", nothing a partner could
   * plan a trip around. Keep that seam — the moment an unshipped item
   * migrates into `shipped` to sound better, the whole list stops being
   * worth reading.
   *
   * Links are declared as route KINDS rather than strings, and the page
   * resolves them through the builders in `src/lib/routes.ts`. Two reasons:
   * the app has a `/watch` basePath, so a hand-typed href here would send
   * a reader to the site root, and the per-language page needs the slug the
   * reader arrived under, which content cannot know.
   */
  future: {
    loyalty:
      "None of that is a reason to think we have stopped building for you. The opposite: the same work that makes the front door easier for a stranger is putting things in your hands that were not there a year ago, and more of them, faster than we have managed before.",
    shippedLead: "Already there, today:",
    shipped: [
      {
        text: "Playback and downloads are faster and steadier — most of all in the smaller languages, where they used to fail.",
      },
      {
        text: "One page that lists every language we have, instead of a picker buried in the player.",
        link: { label: "Browse every language", to: "languages" },
      },
      {
        text: "One page that holds every video in a single language, so you can see the whole shelf at once.",
        link: {
          label: "See everything in your language",
          to: "language-videos",
        },
      },
      {
        text: "Whole collections downloadable in one go, rather than one file at a time.",
      },
      {
        text: "Vertical videos, cut for the phone screens most people are actually holding.",
      },
    ],
    comingLead: "Being built now:",
    coming: [
      "Automated translation, so every language gets more of the library — subtitles first, and increasingly automated voiceover.",
      "Optional accounts, with your own collections and playlists to assemble and share.",
    ],
    pledge:
      "So: more is coming for missionaries and partners, and it is coming at a rate we have not managed before. Where that shows up as something rough or something moved, we are asking for your patience — and for your report, because that is what tells us which of it to fix first.",
  },
  ask: "So — tell me if this sounds about right. If it does not, or if something we shipped made your work harder, say so plainly. That is the report we act on fastest.",
  signature: {
    name: "Vlad Mitkovsky",
    /** Printed under the name; a title change is a one-line edit here. */
    role: "Watch Project Lead, Jesus Film Project",
  },
  feedbackCta: "Tell me how it is going",
} as const

/** Icon keys for the upcoming-features vote carousel. */
export type WhatsNewVoteIcon =
  | "search"
  | "language"
  | "subtitles"
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
 * Votes ARE collected. `src/lib/whats-new-votes.ts` reads
 * `whatsNewFeatureVoteTallies` and writes `castWhatsNewFeatureVote` /
 * `retractWhatsNewFeatureVote` against Admin's public GraphQL surface;
 * localStorage holds the ballot id so a reader can peel their own sticker
 * back off, not the votes themselves.
 *
 * This comment previously said the opposite — "there is no vote endpoint,
 * votes are held in this browser only" — which was true when the panel was
 * built and stopped being true when the collector landed. It is recorded
 * here rather than quietly deleted because a stale "nothing is collected"
 * note is the dangerous direction of drift: it invites someone to add a
 * privacy line to the panel that would be false, or to rebuild a collector
 * that already exists.
 */
export const WHATS_NEW_VOTES = {
  eyebrow: "Vote for features",
  /**
   * Frames the ask around the reader's own use of Watch, not around our
   * backlog. "The three" is the only place the budget appears in the heading —
   * `body` below is what names the stickers and the mechanic, so the two have
   * to keep travelling together.
   */
  heading: "Pick the three that would change how you use Jesus Film Watch",
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
  /**
   * The only way back once a sticker is in hand: a held sticker leaves the
   * pile entirely, so there is no slot left to click a second time.
   */
  putBack: "Put it back",
  ideaLabel: "Not listed? Tell us your idea",
  previous: "Previous features",
  next: "More features",
  carouselLabel: "Upcoming features",
  voteLabel: "vote",
  votesLabel: "votes",
  noVotesLabel: "No votes yet",
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
      id: "dual-subtitles",
      icon: "subtitles",
      title: "Two subtitle languages at once",
      body: "Follow along in your own language and a second one together — for learning, for teaching, and for rooms where people do not share a language.",
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
      body: "One experience that carries between Jesus Film Watch, mobile, and television.",
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
  putBack: string
  ideaLabel: string
  previous: string
  next: string
  carouselLabel: string
  voteLabel: string
  votesLabel: string
  noVotesLabel: string
  stickers: readonly { id: string; emoji: string; label: string }[]
  features: readonly {
    id: string
    icon: WhatsNewVoteIcon
    title: string
    body: string
  }[]
}

export const WHATS_NEW_FAQ = {
  eyebrow: "Frequently asked",
  heading: "Questions? Answers.",
  expandAll: "Expand all",
  collapseAll: "Collapse all",
  items: [
    {
      id: "removal",
      question: "Is anything being removed from Jesus Film Watch?",
      // Deliberately NOT a flat "No." The reader asking this is usually
      // holding a task they could do last month and cannot do today, and
      // answering "nothing changed for you" contradicts their own week in
      // the first word — after which nothing further down the page is
      // believed. Moved-not-removed is both the true answer and the one
      // that leaves the reader somewhere to go.
      answer:
        "Nothing is being removed on purpose. Some things have moved — where you choose a language, where downloads and sharing live — and a few things broke on the way. If you cannot do something today that you could do before, treat that as a bug rather than a decision, and tell us: that is the report we act on fastest.",
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
        "Yes — every language in the catalog is still there, and coverage is not shrinking. If you cannot find yours, then finding is what broke, not the language: report it and we will fix the path to it. The full list lives at jesusfilm.org/watch/languages.",
    },
    {
      id: "classic",
      question: "Can I go back to the old version of the site?",
      // Grounded rather than aspirational: legacy `/watch/*.html` URLs were
      // confirmed still resolving in production. There is no separate
      // "classic" site to send anyone to, and a support note on the cork
      // board shows at least one reader believes there is — so the answer
      // says so plainly instead of leaving them hunting for it.
      answer:
        "No — the previous version has been replaced rather than kept alongside the new one. The links from it still work: old addresses, including the older .html ones, resolve to the page they now live at. If something you did on the old site has no equivalent on this one, that is worth telling us about, because it means we missed it.",
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
      question: "Is Jesus Film Watch still free?",
      answer:
        "Yes. Nothing described on this page introduces a cost to watch, share, or download.",
    },
    {
      id: "feedback",
      question: "How do I report a problem or ask for something?",
      answer:
        "Use the feedback control on any Jesus Film Watch page, or the Share feedback button on this one. Requests and bug reports both land with the team that works on Jesus Film Watch.",
    },
  ],
} as const

export const WHATS_NEW_CLOSING = {
  eyebrow: "Help us improve Jesus Film Watch",
  heading: "If something is unclear, tell us",
  paragraphs: [
    "If something is unclear, harder than it was, or missing, please tell us. What you send is what decides which of it we fix next.",
  ],
} as const

export const WHATS_NEW_METADATA = {
  title: "Jesus Film Watch is changing. Here's why. | Jesus Film Project",
  description:
    "Why the Jesus Film Watch experience is changing: from projectors and VHS, to one of the first free gospel video sites online, to first page in Google search, to a library people can find through AI assistants — in their own language.",
} as const

/**
 * The pin board — three cork boards behind file tabs, each holding notes
 * the reader can write, colour, and drag anywhere.
 *
 * The starter notes are REAL messages sent to the JF Information support
 * inbox, pulled from Help Scout and condensed. Four rules govern them:
 *
 * 1. Watch WEBSITE feedback only. Nothing about the mobile app — those
 *    arrive through the app's own feedback form and are a different
 *    product. Grep the source for "App version:" / "OS version:" /
 *    "the app" and drop every hit before selecting.
 * 2. First name and country ONLY. No surname, organisation, address,
 *    email, phone, or date. A country is used only where the writer
 *    stated their OWN location ("I am from...", "greetings from...") —
 *    never a destination they mentioned travelling to, which named the
 *    wrong country for most of the corpus. Anything harvested fresh goes
 *    through `sanitizeSupportConversation` in apps/mastra AND a human
 *    pass: the sanitiser redacts contact details but leaves names intact.
 * 3. Condensed, never invented. Each note compresses what someone
 *    actually wrote; none of it is authored to sound good.
 * 4. Keep every `text` at or under 95 characters. A note is a fixed
 *    square with hidden overflow and now also carries a credit line, so
 *    what decides the fit is how a sentence WRAPS, not its raw length.
 *    The bound in `WhatsNewNoteBoard.test.tsx` is a coarse guard; the
 *    real check is rendering every starter at a 320px viewport and
 *    asserting its text does not overflow.
 */
export const WHATS_NEW_BOARD = {
  eyebrow: "Share your opinion",
  heading: "Grab a pen. Put something on the board.",
  body: "Three boards, one pad of paper. Write a note, pick your colour, and stick it wherever you like — drag it around until it sits right.",
  provenance:
    "The notes already up are real messages people sent our support inbox about the Jesus Film Watch site, shortened. Names are stand-ins — the words and the country are theirs.",
  // This sat directly above a button reading "Send this to the team", which
  // made the panel contradict itself on its own face — and a public board
  // that announces it collects nothing undercuts every "tell us" elsewhere
  // on the page. Both halves are true and the note now says which is which:
  // pinning is local, the button opens the shared feedback composer, which
  // does deliver. If a collector is ever wired up, this is the line that
  // has to change with it.
  localOnlyNote:
    "Notes you pin stay in this browser — the board is yours to arrange, and we do not read it. Press “Send this to the team” on a note to put it in front of us for real.",
  boardsLabel: "Pin boards",
  writeLabel: "Write a note",
  paperLabel: "Paper",
  pinLabel: "Pin it up",
  fullLabel: "Board full — take one down first",
  unpinLabel: "Take this note down",
  moveHint: "Drag it anywhere. Arrow keys nudge, Delete takes it down.",
  moveLabel: "Note",
  countLabel: "pinned by you",
  clearLabel: "Clear my notes",
  sendLabel: "Send this to the team",
  emptyLabel: "Nothing pinned here yet. Be first.",
  /** Sticky-note paper. Ids resolve to Tailwind classes in the component. */
  papers: [
    { id: "butter", label: "Butter yellow" },
    { id: "rose", label: "Rose pink" },
    { id: "sky", label: "Sky blue" },
    { id: "mint", label: "Mint green" },
    { id: "peach", label: "Peach orange" },
  ],
  boards: [
    {
      id: "praise",
      tab: "Praise",
      title: "What is working",
      prompt: "What has Jesus Film Watch done well for you?",
      notes: [
        {
          id: "praise-1",
          p: "butter",
          name: "Yousaf",
          country: "Pakistan",
          text: "It is a great privilege to explore your work on your website.",
        },
        {
          id: "praise-2",
          p: "sky",
          name: "Thabo",
          country: "Botswana",
          text: "I am pleased to come across this resourceful website, especially for outreaches.",
        },
        {
          id: "praise-3",
          p: "rose",
          name: "Mateo",
          text: "I was blessed hearing the testimonies of lives changed from watching the film.",
        },
        {
          id: "praise-4",
          p: "mint",
          name: "Elias",
          text: "You have helped a lot of churches and communities. People change when they watch.",
        },
        {
          id: "praise-5",
          p: "peach",
          name: "Anselmo",
          country: "Portugal",
          text: "I have followed your work for over 40 years. It has been a blessing to many lives.",
        },
        {
          id: "praise-6",
          p: "rose",
          name: "Efraín",
          country: "Venezuela",
          text: "On your website we can download these videos for free. Thank you very much.",
        },
        {
          id: "praise-7",
          p: "butter",
          name: "Marika",
          text: "Your website was recommended to me, and it had the specifications I needed.",
        },
        {
          id: "praise-8",
          p: "peach",
          name: "Devan",
          text: "I was confused about how to watch the film. Now I can watch it — thank you.",
        },
        {
          id: "praise-9",
          p: "sky",
          name: "Colin",
          text: "I volunteer with an online ministry. We recommend seekers to your website.",
        },
        {
          id: "praise-10",
          p: "butter",
          name: "Mwangi",
          country: "Kenya",
          text: "Thank you for sharing with us. We ask your prayers for God's work here.",
        },
        {
          id: "praise-11",
          p: "mint",
          name: "Marilou",
          country: "Philippines",
          text: "I find all your videos helpful.",
        },
        {
          id: "praise-12",
          p: "rose",
          name: "Maureen",
          text: "I found the information I needed. Thank you.",
        },
        {
          id: "praise-13",
          p: "sky",
          name: "Emmett",
          country: "Liberia",
          text: "I learned on your website of your vision and your global impact.",
        },
        {
          id: "praise-14",
          p: "peach",
          name: "Bishal",
          country: "Nepal",
          text: "I got your email from your website, and I am doing church ministry here.",
        },
        {
          id: "praise-15",
          p: "mint",
          name: "Charlene",
          text: "Thank you for the work you do.",
        },
      ],
    },
    {
      id: "requests",
      tab: "Feature requests",
      title: "What we should build",
      prompt: "What is missing? What would you build next?",
      notes: [
        {
          id: "requests-1",
          p: "butter",
          name: "Rosalind",
          text: "I can't find it anywhere online. Can you please help me find it?",
        },
        {
          id: "requests-2",
          p: "sky",
          name: "Gordon",
          text: "Where can I find the sign language film? The old link no longer works.",
        },
        {
          id: "requests-3",
          p: "rose",
          name: "Marjorie",
          text: "I'm looking through your website and can't find where I select the language.",
        },
        {
          id: "requests-4",
          p: "mint",
          name: "Nuwan",
          text: "I am not able to search for the Sinhala videos on your current or classic site.",
        },
        {
          id: "requests-5",
          p: "peach",
          name: "Marlene",
          text: "I have been all over your site and cannot find a list of the films.",
        },
        {
          id: "requests-6",
          p: "rose",
          name: "Colin",
          text: "Your FAQ invites me to search for languages, but the search does not get me there.",
        },
        {
          id: "requests-7",
          p: "butter",
          name: "Marilou",
          country: "Philippines",
          text: "I am waiting for a Tagalog translation of the page, for people with less English.",
        },
        {
          id: "requests-8",
          p: "peach",
          name: "Willem",
          text: "To find the language is more difficult now, and when I pick one it changes back.",
        },
        {
          id: "requests-9",
          p: "sky",
          name: "Ochanya",
          country: "Nigeria",
          text: "The video could not be downloaded, and it is too long to be watched online.",
        },
        {
          id: "requests-10",
          p: "butter",
          name: "Trevor",
          country: "Australia",
          text: "The YouTube version is much clearer than the site version.",
        },
        {
          id: "requests-11",
          p: "mint",
          name: "Minho",
          text: "AI-translated subtitles would be useful, even if they are not in my language.",
        },
        {
          id: "requests-12",
          p: "rose",
          name: "Gareth",
          country: "Thailand",
          text: "Do you have a transcript I could use to make the subtitles?",
        },
        {
          id: "requests-13",
          p: "sky",
          name: "Lidia",
          text: "The site is confusing. Several places to look, and I only see the English ones.",
        },
        {
          id: "requests-14",
          p: "peach",
          name: "Roseanne",
          text: "Please have a link to buy the DVDs on your website.",
        },
        {
          id: "requests-15",
          p: "mint",
          name: "Douglas",
          text: "Add a message that says the video will load after a moment.",
        },
      ],
    },
    {
      id: "ministry",
      tab: "How I use Jesus Film Watch",
      title: "Out in the field",
      prompt: "How do you use Jesus Film Watch in your ministry?",
      notes: [
        {
          id: "ministry-1",
          p: "butter",
          name: "Marcus",
          country: "Togo",
          text: "Our radio station reaches the villages, and that leads to a showing of the film.",
        },
        {
          id: "ministry-2",
          p: "sky",
          name: "Serene",
          country: "Singapore",
          text: "We built a prayer house here, and run an online church across several countries.",
        },
        {
          id: "ministry-3",
          p: "rose",
          name: "Bishal",
          country: "Nepal",
          text: "I got your email from the website. I have been doing church ministry two years.",
        },
        {
          id: "ministry-4",
          p: "mint",
          name: "Paola",
          country: "Colombia",
          text: "We started three years ago with virtual Bible studies.",
        },
        {
          id: "ministry-5",
          p: "peach",
          name: "Renata",
          text: "I wanted to show one of your films at my church, free, to the children.",
        },
        {
          id: "ministry-6",
          p: "rose",
          name: "Wes",
          country: "Canada",
          text: "We are building a resource site for Plautdietsch speakers, featuring your film.",
        },
        {
          id: "ministry-7",
          p: "butter",
          name: "Paulette",
          country: "United Kingdom",
          text: "We are currently compiling a video for our churches here.",
        },
        {
          id: "ministry-8",
          p: "peach",
          name: "Malcolm",
          country: "Canada",
          text: "I teach English as a second language for a Christian nonprofit.",
        },
        {
          id: "ministry-9",
          p: "sky",
          name: "Anca",
          country: "Romania",
          text: "We publish links to Scripture resources for our Bible translation work.",
        },
        {
          id: "ministry-10",
          p: "butter",
          name: "Fidele",
          country: "Rwanda",
          text: "I direct a youth ministry, and we use the films in our work.",
        },
        {
          id: "ministry-11",
          p: "mint",
          name: "Efraín",
          country: "Venezuela",
          text: "We work with the church to teach it to evangelise, and we disciple with video.",
        },
        {
          id: "ministry-12",
          p: "rose",
          name: "Tuan",
          text: "I use your download option to get the clip onto my laptop for the showing.",
        },
        {
          id: "ministry-13",
          p: "sky",
          name: "Bryce",
          text: "We are planting a church, and needed the films to portray who we are.",
        },
        {
          id: "ministry-14",
          p: "peach",
          name: "Marika",
          text: "I am looking for a travel projector with the film in the local language.",
        },
        {
          id: "ministry-15",
          p: "mint",
          name: "Ezra",
          text: "We are an agency creating media in our languages, and showing to students.",
        },
      ],
    },
  ],
} as const

export type WhatsNewBoardId = (typeof WHATS_NEW_BOARD)["boards"][number]["id"]
export type WhatsNewPaperId = (typeof WHATS_NEW_BOARD)["papers"][number]["id"]
