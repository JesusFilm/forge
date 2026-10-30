// Partner resource library metadata. Every entry is a real page (and, where
// one is published, a real PDF) on jesusfilm.org's partner resources library:
// titles and summaries are the source page's own words, `destination` is the
// page, and `pdf` is the direct file link when the page publishes one. Nothing
// here is protected content: PDF links stay ordinary external links and never
// pass through the Watch download proxy or `download-allowlist.ts`. Account
// sign-in does not change what this library shows (R11).
//
// Refresh by re-reading the source pages, then update `SOURCE_DATE`.

export type WatchPartnerResourceCategoryId =
  | "outreach"
  | "training"
  | "digital"
  | "equipment"
  | "prayer"

export type WatchPartnerResource = {
  id: string
  title: string
  category: WatchPartnerResourceCategoryId
  summary: string
  /** BCP-47 tag of the language the source page is written in. */
  sourceLanguage: string
  /** ISO date this entry was last read from its source page. */
  sourceDate: string
  /** The resource's own page on jesusfilm.org. */
  destination: string
  /** Direct PDF on jesusfilm.org, only when the page publishes one. */
  pdf?: string
}

export type WatchPartnerResourceLink = {
  kind: "page" | "pdf"
  label: string
  href: string
}

/** Filter order: what a partner planning an outreach reaches for first. */
export const WATCH_PARTNER_RESOURCE_CATEGORIES = [
  { id: "outreach", label: "Outreach" },
  { id: "training", label: "Training" },
  { id: "digital", label: "Digital" },
  { id: "equipment", label: "Equipment" },
  { id: "prayer", label: "Prayer" },
] as const satisfies readonly {
  id: WatchPartnerResourceCategoryId
  label: string
}[]

const SOURCE_DATE = "2026-09-15"

export const WATCH_PARTNER_RESOURCES: readonly WatchPartnerResource[] = [
  {
    id: "40403",
    title: "2026 Global Football (Soccer) Event Resources Customizable",
    category: "outreach",
    summary:
      "These interactive, customizable resources equip community and ministry leaders to build relationships and create spiritual momentum.",
    sourceLanguage: "en",
    sourceDate: SOURCE_DATE,
    destination:
      "https://www.jesusfilm.org/resources/strategies/outreach/2026-global-soccer-event-resources/customizable/",
  },
  {
    id: "40404",
    title: "2026 Global Football (Soccer) Event Resources Ready to Use",
    category: "outreach",
    summary:
      "As you gather with others to watch the 2026 global football (soccer) event, doors will naturally open for meaningful conversations and deepened relationships.",
    sourceLanguage: "en",
    sourceDate: SOURCE_DATE,
    destination:
      "https://www.jesusfilm.org/resources/strategies/outreach/2026-global-soccer-event-resources/ready-to-use/",
  },
  {
    id: "38489",
    title: "2026 Global Football (Soccer) Event Resources",
    category: "outreach",
    summary:
      "Build relationships, spark meaningful conversations and share hope around the world’s biggest football event.",
    sourceLanguage: "en",
    sourceDate: SOURCE_DATE,
    destination:
      "https://www.jesusfilm.org/resources/strategies/outreach/2026-global-soccer-event-resources/",
  },
  {
    id: "35997",
    title: "Story of the Soul Kit",
    category: "outreach",
    summary:
      "God is creative. He molds the mountains and paints every sunset. Everything we see is a testament to His artistic expression.",
    sourceLanguage: "en",
    sourceDate: SOURCE_DATE,
    destination:
      "https://www.jesusfilm.org/resources/strategies/outreach/story-of-the-soul/kit/",
    pdf: "https://www.jesusfilm.org/wp-content/uploads/2023/01/JFP-SOTS-Kit-2022-v1.pdf",
  },
  {
    id: "35993",
    title: "Reflections of Hope and Rivka",
    category: "outreach",
    summary: "Guided Bible studies inspired by our films and short films.",
    sourceLanguage: "en",
    sourceDate: SOURCE_DATE,
    destination:
      "https://www.jesusfilm.org/resources/strategies/outreach/reflections-of-hope-and-rivka/",
  },
  {
    id: "31193",
    title: "Women's Strategies",
    category: "outreach",
    summary: "We want to help women everywhere get to know Jesus.",
    sourceLanguage: "en",
    sourceDate: SOURCE_DATE,
    destination:
      "https://www.jesusfilm.org/resources/strategies/outreach/womens-strategies/",
  },
  {
    id: "26405",
    title: "Reflections of Hope",
    category: "outreach",
    summary: "Guided Bible studies inspired by our films and short films.",
    sourceLanguage: "en",
    sourceDate: SOURCE_DATE,
    destination:
      "https://www.jesusfilm.org/resources/strategies/outreach/reflections-of-hope-and-rivka/reflections-of-hope-and-reflections-of-hope/",
  },
  {
    id: "26402",
    title: "Story of the Soul",
    category: "outreach",
    summary:
      "An outreach guide designed to help you connect people to the story of Jesus through art.",
    sourceLanguage: "en",
    sourceDate: SOURCE_DATE,
    destination:
      "https://www.jesusfilm.org/resources/strategies/outreach/story-of-the-soul/",
  },
  {
    id: "26400",
    title: "Multi-Language Outreach Using Magdalena: Through Her Eyes",
    category: "outreach",
    summary:
      "This outreach guide helps women reach women in their communities from refugee or immigrant backgrounds.",
    sourceLanguage: "en",
    sourceDate: SOURCE_DATE,
    destination:
      "https://www.jesusfilm.org/resources/strategies/outreach/multi-language-outreach-using-magdalena-through-her-eyes/",
    pdf: "https://www.jesusfilm.org/wp-content/uploads/2023/09/Multi-Language-Outreach-Magdalena.pdf",
  },
  {
    id: "26397",
    title: "Jesus Knows Your Name",
    category: "outreach",
    summary:
      "A small group study for women using the animated short film Chosen Witness.",
    sourceLanguage: "en",
    sourceDate: SOURCE_DATE,
    destination:
      "https://www.jesusfilm.org/resources/strategies/outreach/jesus-knows-your-name/",
    pdf: "https://www.jesusfilm.org/wp-content/uploads/2024/03/Jesus-Knows-Your-Name.pdf",
  },
  {
    id: "26395",
    title: "Journey to Jesus",
    category: "outreach",
    summary:
      "Provides a range of curated ministry tools designed to reach immigrant and refugee populations.",
    sourceLanguage: "en",
    sourceDate: SOURCE_DATE,
    destination:
      "https://www.jesusfilm.org/resources/strategies/outreach/journey-to-jesus/",
  },
  {
    id: "26393",
    title: "Window to the World (Digital Version)",
    category: "outreach",
    summary:
      "A digital curriculum with ESL topics and JESUS film clips to help non-native speakers learn English.",
    sourceLanguage: "en",
    sourceDate: SOURCE_DATE,
    destination:
      "https://www.jesusfilm.org/resources/strategies/outreach/window-to-the-world-digital-version/",
    pdf: "https://www.jesusfilm.org/wp-content/uploads/2023/08/Window-to-the-World-12-Lessons.pdf",
  },
  {
    id: "26391",
    title: "Stories in Grace (SING)",
    category: "outreach",
    summary:
      "This film-based curriculum helps encourage spiritual healing and emotional growth to women experiencing difficult situations.",
    sourceLanguage: "en",
    sourceDate: SOURCE_DATE,
    destination:
      "https://www.jesusfilm.org/resources/strategies/outreach/stories-in-grace-sing/",
  },
  {
    id: "26379",
    title: "How to Host a Short Film Gathering",
    category: "outreach",
    summary:
      "Use the power of film to enter into meaningful conversations about Jesus by hosting a film event in your community.",
    sourceLanguage: "en",
    sourceDate: SOURCE_DATE,
    destination:
      "https://www.jesusfilm.org/resources/strategies/outreach/how-to-host-a-short-film-festival/",
    pdf: "https://www.jesusfilm.org/wp-content/uploads/2025/03/Short-Film-Gathering.pdf",
  },
  {
    id: "26377",
    title: "Using “The Amazing Question” to Share Your Faith",
    category: "outreach",
    summary:
      "This guide shows you how to use “The Amazing Question” to initiate spiritual conversations, encourage reflection and reveal deep longings.",
    sourceLanguage: "en",
    sourceDate: SOURCE_DATE,
    destination:
      "https://www.jesusfilm.org/resources/strategies/outreach/using-the-amazing-question-to-share-your-faith/",
    pdf: "https://www.jesusfilm.org/wp-content/uploads/2024/09/engAMER-AmazQ-DS-Digital-GloMo-11May23.pdf",
  },
  {
    id: "26372",
    title: "Conversational English Using Short Films",
    category: "outreach",
    summary: "Facilitate English-language learning through film.",
    sourceLanguage: "en",
    sourceDate: SOURCE_DATE,
    destination:
      "https://www.jesusfilm.org/resources/strategies/outreach/conversational-english-using-short-films/",
    pdf: "https://www.jesusfilm.org/wp-content/uploads/2023/10/Conversational-English-Using-Short-Films.pdf",
  },
  {
    id: "26370",
    title: "Beginning With Jesus",
    category: "training",
    summary:
      "An effective discipleship strategy contained in a nine-lesson guide that helps form fruitful and joyful believers.",
    sourceLanguage: "en",
    sourceDate: SOURCE_DATE,
    destination:
      "https://www.jesusfilm.org/resources/strategies/training/beginning-with-jesus-replace/",
  },
  {
    id: "26368",
    title: "Consider Jesus",
    category: "training",
    summary:
      "Consider Jesus uses clips from Magdalena: Released From Shame to encourage group multiplication and communal growth.",
    sourceLanguage: "en",
    sourceDate: SOURCE_DATE,
    destination:
      "https://www.jesusfilm.org/resources/strategies/training/consider-jesus-replace/",
  },
  {
    id: "26366",
    title: "Digital Evangelism Webinar",
    category: "training",
    summary:
      "A two-part evangelism webinar for the Jesus Film Project app and website and the GodTools® app.",
    sourceLanguage: "en",
    sourceDate: SOURCE_DATE,
    destination:
      "https://www.jesusfilm.org/resources/strategies/training/digital-evangelism-webinar/",
  },
  {
    id: "26364",
    title: "Short Film Evangelism Training",
    category: "training",
    summary:
      "Provides an in-person deep dive into Jesus Film Project and GodTools® apps.",
    sourceLanguage: "en",
    sourceDate: SOURCE_DATE,
    destination:
      "https://www.jesusfilm.org/resources/strategies/training/short-film-evangelism-training/",
  },
  {
    id: "26361",
    title: "Knowing Jesus",
    category: "training",
    summary:
      "Learn the best ways to use the Knowing Jesus strategy in your context.",
    sourceLanguage: "en",
    sourceDate: SOURCE_DATE,
    destination:
      "https://www.jesusfilm.org/resources/strategies/training/knowing-jesus-replace/",
  },
  {
    id: "26360",
    title: "NewLifeBox™ Kit Training",
    category: "training",
    summary:
      "Our online training teaches you how to use the NewLifeBoxTM device.",
    sourceLanguage: "en",
    sourceDate: SOURCE_DATE,
    destination:
      "https://www.jesusfilm.org/resources/strategies/training/newlife-box-kit-training/",
  },
  {
    id: "39679",
    title: "Metaverse Ministry Tool Kit",
    category: "digital",
    summary:
      "Learn how to connect with people and build relationships in the metaverse, a growing digital space.",
    sourceLanguage: "en",
    sourceDate: SOURCE_DATE,
    destination:
      "https://www.jesusfilm.org/resources/strategies/digital/metaverse-ministry-tool-kit/",
  },
  {
    id: "35584",
    title: "YouVersion Reading Plans",
    category: "digital",
    summary: "Jesus Film Project reading plans on the YouVersion app.",
    sourceLanguage: "en",
    sourceDate: SOURCE_DATE,
    destination:
      "https://www.jesusfilm.org/resources/strategies/digital/youversion-reading-plans/",
  },
  {
    id: "26389",
    title: "NextSteps Journey Builder",
    category: "digital",
    summary:
      "An innovative tool you can use to create digital journeys to help people discover Christ online.",
    sourceLanguage: "en",
    sourceDate: SOURCE_DATE,
    destination:
      "https://www.jesusfilm.org/resources/strategies/digital/nextsteps-journey-builder/",
  },
  {
    id: "26387",
    title: "Jesus Film Project App",
    category: "digital",
    summary:
      "Explore our full digital library of Jesus Film Project films on your smartphone.",
    sourceLanguage: "en",
    sourceDate: SOURCE_DATE,
    destination:
      "https://www.jesusfilm.org/resources/strategies/digital/jesus-film-project-app/",
  },
  {
    id: "26385",
    title: "Watch Page",
    category: "digital",
    summary:
      "Our library of free-to-use short and feature-length films on the Jesus Film Project website.",
    sourceLanguage: "en",
    sourceDate: SOURCE_DATE,
    destination:
      "https://www.jesusfilm.org/resources/strategies/digital/watch-page/",
  },
  {
    id: "26408",
    title: "Tablets",
    category: "equipment",
    summary:
      "Pre-loaded tablets ideal for sharing the gospel one-to-one or in remote locations with limited internet access.",
    sourceLanguage: "en",
    sourceDate: SOURCE_DATE,
    destination:
      "https://www.jesusfilm.org/resources/strategies/equipment/tablets/",
  },
  {
    id: "26358",
    title: "NewLifeBox® Kit",
    category: "equipment",
    summary:
      "A pocket-sized hotspot device for sharing gospel content in remote locations with limited internet access.",
    sourceLanguage: "en",
    sourceDate: SOURCE_DATE,
    destination:
      "https://www.jesusfilm.org/resources/strategies/equipment/newlife-box-kit/",
  },
  {
    id: "26354",
    title: "Audio Bible",
    category: "equipment",
    summary: "The JESUS film and other gospel resources in audio form.",
    sourceLanguage: "en",
    sourceDate: SOURCE_DATE,
    destination:
      "https://www.jesusfilm.org/resources/strategies/equipment/audio-bible/",
  },
  {
    id: "26343",
    title: "Projector Sets",
    category: "equipment",
    summary:
      "Backpack kits and compact projector sets perfect for showing gospel films outside and in remote locations.",
    sourceLanguage: "en",
    sourceDate: SOURCE_DATE,
    destination:
      "https://www.jesusfilm.org/resources/strategies/equipment/projector-sets/",
  },
  {
    id: "26381",
    title: "For the Least Reached: A Year of Prayer",
    category: "prayer",
    summary:
      "Monthly prayer guides to anchor you and your group in prayer for the world’s 12 countries least reached with the gospel.",
    sourceLanguage: "en",
    sourceDate: SOURCE_DATE,
    destination:
      "https://www.jesusfilm.org/resources/strategies/pray/for-the-least-reached-a-year-of-prayer/",
  },
]

export function filterWatchPartnerResources(
  category: WatchPartnerResourceCategoryId | "all",
): readonly WatchPartnerResource[] {
  return category === "all"
    ? WATCH_PARTNER_RESOURCES
    : WATCH_PARTNER_RESOURCES.filter(
        (resource) => resource.category === category,
      )
}

export function watchPartnerResourceCategoryCounts(): Record<
  WatchPartnerResourceCategoryId,
  number
> {
  const counts = Object.fromEntries(
    WATCH_PARTNER_RESOURCE_CATEGORIES.map(({ id }) => [id, 0]),
  ) as Record<WatchPartnerResourceCategoryId, number>
  for (const { category } of WATCH_PARTNER_RESOURCES) counts[category] += 1
  return counts
}

/** The source page always; the PDF only when the page really publishes one. */
export function watchPartnerResourceLinks(
  resource: WatchPartnerResource,
): WatchPartnerResourceLink[] {
  const links: WatchPartnerResourceLink[] = [
    { kind: "page", label: "View source page", href: resource.destination },
  ]
  if (resource.pdf) {
    links.push({ kind: "pdf", label: "Open PDF", href: resource.pdf })
  }
  return links
}

export function watchPartnerResourceLanguageLabel(tag: string): string {
  return new Intl.DisplayNames(["en"], { type: "language" }).of(tag) ?? tag
}
