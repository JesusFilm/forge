export type PlannedTone =
  | "stone"
  | "amber"
  | "sky"
  | "emerald"
  | "lime"
  | "rose"
  | "red"

export type PlannedTrackId =
  | "milestones"
  | "foundation"
  | "surface"
  | "search"
  | "future-work"
  | "actual-foundation"
  | "actual-player"
  | "actual-surface"
  | "actual-search"
  | "agentic-framework"
  | "mobile-tv"

export type PlannedTrack = {
  id: PlannedTrackId
  label: string
  description: string
}

export type PlannedTimelineRow = {
  id: string
  label: string
  description: string
  trackIds: PlannedTrackId[]
  stackByLane?: boolean
  sublanes?: Array<{
    id: string
    trackIds: PlannedTrackId[]
  }>
}

export type PlannedPhaseSection = {
  label: string
  items: string[]
}

export type PlannedPhase = {
  id: string
  title: string
  shortTitle: string
  completed: boolean
  track: PlannedTrackId
  tone: PlannedTone
  startWeek: number
  spanWeeks: number
  badge: string
  rangeLabel: string
  summary: string
  sections: PlannedPhaseSection[]
}

export type PlannedTrackBar = {
  id: string
  title: string
  summary: string
  track: PlannedTrackId
  tone: PlannedTone
  startWeek: number
  spanWeeks: number
  lane?: number
  badge?: string
  details?: string[]
}

type FutureWorkPriority = Pick<
  PlannedTrackBar,
  "id" | "title" | "summary" | "startWeek" | "badge" | "details"
> & {
  lane: number
}

export type PlannedMilestone = {
  id: string
  label: string
  dateLabel: string
  description: string
  items?: string[]
  quote?: string
  track: PlannedTrackId
  tone: PlannedTone
  date: string
}

type PlannedWeek = {
  index: number
  shortLabel: string
  label: string
  dateLabel: string
  isoDate: string
  endIsoDate: string
}

const DAY_MS = 86400000
const WEEK_MS = 7 * 86400000
export const PLANNED_START_ISO = "2026-04-28"
export const PLANNED_END_ISO = "2026-12-31"

const PLANNED_START_DATE = new Date(`${PLANNED_START_ISO}T00:00:00Z`)
const PLANNED_END_DATE = new Date(`${PLANNED_END_ISO}T00:00:00Z`)

function addWeeks(date: Date, weeks: number): Date {
  return new Date(date.getTime() + weeks * WEEK_MS)
}

function formatDateRangeLabel(
  startDate: Date,
  endDate: Date,
  separator = "-",
): string {
  const startMonth = startDate.toLocaleDateString("en-US", {
    month: "short",
    timeZone: "UTC",
  })
  const startDay = startDate.toLocaleDateString("en-US", {
    day: "numeric",
    timeZone: "UTC",
  })
  const endMonth = endDate.toLocaleDateString("en-US", {
    month: "short",
    timeZone: "UTC",
  })
  const endDay = endDate.toLocaleDateString("en-US", {
    day: "numeric",
    timeZone: "UTC",
  })

  if (startMonth === endMonth) {
    return `${startMonth} ${startDay}${separator}${endDay}`
  }

  return `${startMonth} ${startDay}${separator}${endMonth} ${endDay}`
}

export function formatRoadmapCalendarRange(
  startIsoDate: string,
  endIsoDate: string,
): string {
  return formatDateRangeLabel(
    new Date(`${startIsoDate}T00:00:00Z`),
    new Date(`${endIsoDate}T00:00:00Z`),
    " - ",
  )
}

export const PLANNED_WEEK_COUNT = Math.ceil(
  (PLANNED_END_DATE.getTime() - PLANNED_START_DATE.getTime() + DAY_MS) /
    WEEK_MS,
)

export const PLANNED_WEEKS: PlannedWeek[] = Array.from(
  { length: PLANNED_WEEK_COUNT },
  (_, index) => {
    const date = addWeeks(PLANNED_START_DATE, index)
    const naturalEndDate = new Date(date.getTime() + 6 * DAY_MS)
    const endDate =
      naturalEndDate > PLANNED_END_DATE ? PLANNED_END_DATE : naturalEndDate
    return {
      index,
      shortLabel: `W${index + 1}`,
      label: `Week ${index + 1}`,
      dateLabel: formatDateRangeLabel(date, endDate),
      isoDate: date.toISOString().slice(0, 10),
      endIsoDate: endDate.toISOString().slice(0, 10),
    }
  },
)

export const PLANNED_TITLE = "FORGE ROADMAP - 2026"
export const PLANNED_SUBTITLE = "Starting Apr 28, 2026"
export const PLANNED_RANGE_LABEL = `${formatDateRangeLabel(
  PLANNED_START_DATE,
  PLANNED_END_DATE,
  " - ",
)}, ${PLANNED_END_DATE.getUTCFullYear()}`
export const PLANNED_GOAL =
  "Migrate to Forge while shipping real user value, prepare Demo Day, and set up the future AI and creator ecosystem."

export const PLANNED_CADENCE = [
  "2 weeks per feature",
  "Week 1 = build",
  "Week 2 = release + polish",
]

export const PLANNED_TRACKS: PlannedTrack[] = [
  {
    id: "milestones",
    label: "Milestones",
    description: "External deadline and Demo Day checkpoints",
  },
  {
    id: "foundation",
    label: "Foundation",
    description: "CMS, data, infrastructure, stability, shutdown",
  },
  {
    id: "surface",
    label: "Surface",
    description: "Player, experiences, homepage",
  },
  {
    id: "search",
    label: "Search",
    description: "Hybrid and multilingual search",
  },
  {
    id: "future-work",
    label: "Future Work",
    description: "Four-week priorities for the rest of 2026",
  },
  {
    id: "actual-foundation",
    label: "Actual Foundation",
    description: "Actual CMS, data, stability, shutdown delivery",
  },
  {
    id: "actual-player",
    label: "Actual Player",
    description: "Actual player page delivery",
  },
  {
    id: "actual-surface",
    label: "Actual Surface",
    description: "Actual experiences and homepage delivery",
  },
  {
    id: "actual-search",
    label: "Actual Search",
    description: "Actual hybrid and multilingual search delivery",
  },
  {
    id: "agentic-framework",
    label: "Agentic Framework",
    description: "R&D with Mastra AI, non-blocking",
  },
  {
    id: "mobile-tv",
    label: "Mobile + TV",
    description: "RN + Expo buildout, delayed release",
  },
]

export const PLANNED_TIMELINE_ROWS: PlannedTimelineRow[] = [
  {
    id: "delivery-planned",
    label: "Delivery Planned",
    description: "Completed releases and year-end priorities",
    trackIds: ["foundation", "surface", "search", "future-work"],
    stackByLane: true,
  },
  {
    id: "experimentation",
    label: "Research",
    description: "Agentic R&D, mobile + TV",
    trackIds: ["agentic-framework", "mobile-tv"],
    sublanes: [
      {
        id: "agentic",
        trackIds: ["agentic-framework"],
      },
      {
        id: "mobile-tv",
        trackIds: ["mobile-tv"],
      },
    ],
  },
]

export const PLANNED_PHASES: PlannedPhase[] = [
  {
    id: "phase-0",
    title: "Foundation",
    shortTitle: "Foundation",
    completed: true,
    track: "foundation",
    tone: "stone",
    startWeek: 0,
    spanWeeks: 2,
    badge: "Weeks 1-2",
    rangeLabel: "Weeks 1-2 | Apr 28 - May 9",
    summary: "No release while the migration foundation is put in place.",
    sections: [
      {
        label: "Outcome",
        items: [
          "No release",
          "Strapi -> Postgres + Custom CMS",
          "Import Core data",
          "Stable sync with Core",
        ],
      },
      {
        label: "Parallel",
        items: [
          "Player page ready behind flag",
          "Hybrid search in progress",
          "Agentic (Mastra AI) setup",
          "Mobile (Expo) base app",
        ],
      },
    ],
  },
  {
    id: "phase-1",
    title: "Replace Player Page",
    shortTitle: "Replace Player Page",
    completed: true,
    track: "surface",
    tone: "amber",
    startWeek: 2,
    spanWeeks: 2,
    badge: "Weeks 3-4",
    rangeLabel: "Weeks 3-4",
    summary: "First user-visible Forge release centered on playback.",
    sections: [
      {
        label: "Week 3 (Build)",
        items: ["Forge player page", "AI subtitles integration"],
      },
      {
        label: "Week 4 (Release #1)",
        items: ["Player live", "AI subtitles visible"],
      },
    ],
  },
  {
    id: "phase-2",
    title: "Experiences Rollout",
    shortTitle: "Experiences Rollout",
    completed: true,
    track: "surface",
    tone: "amber",
    startWeek: 4,
    spanWeeks: 2,
    badge: "Weeks 5-6",
    rangeLabel: "Weeks 5-6",
    summary: "Experience engine plus first prototype release.",
    sections: [
      {
        label: "Week 5 (Build)",
        items: ["Experience engine", "World Cup prototype"],
      },
      {
        label: "Week 6 (Release #2)",
        items: ["First Experience live", "UX + content polish"],
      },
    ],
  },
  {
    id: "phase-3",
    title: "Search Rollout",
    shortTitle: "Search Rollout",
    completed: true,
    track: "search",
    tone: "sky",
    startWeek: 6,
    spanWeeks: 2,
    badge: "Weeks 7-8",
    rangeLabel: "Weeks 7-8",
    summary: "Hybrid search rollout with multilingual validation.",
    sections: [
      {
        label: "Week 7 (Build)",
        items: [
          "Hybrid search (text + vector)",
          "Multilingual validation",
          "Shadow vs Algolia",
        ],
      },
      {
        label: "Week 8 (Release #3)",
        items: ["Forge search live", "Algolia fallback active"],
      },
    ],
  },
  {
    id: "phase-4",
    title: "Watch Homepage",
    shortTitle: "Watch Homepage",
    completed: true,
    track: "surface",
    tone: "amber",
    startWeek: 8,
    spanWeeks: 2,
    badge: "Weeks 9-10",
    rangeLabel: "Weeks 9-10",
    summary: "Homepage migration after player, experiences, and search.",
    sections: [
      {
        label: "Week 9 (Build)",
        items: ["Homepage on Forge"],
      },
      {
        label: "Week 10 (Release #4)",
        items: ["Homepage live", "Integrated with search + experiences"],
      },
    ],
  },
  {
    id: "phase-5",
    title: "i18n + Stability",
    shortTitle: "i18n + Stability",
    completed: true,
    track: "foundation",
    tone: "stone",
    startWeek: 10,
    spanWeeks: 2,
    badge: "Weeks 11-12",
    rangeLabel: "Weeks 11-12",
    summary: "Language and stability hardening before shutdown.",
    sections: [
      {
        label: "Week 11 (Build)",
        items: ["Internationalization"],
      },
      {
        label: "Week 12 (Release #5)",
        items: ["Multilingual UI stable", "Bugs fixed"],
      },
    ],
  },
  {
    id: "phase-6",
    title: "Old Watch Shutdown",
    shortTitle: "Old Watch Shutdown",
    completed: true,
    track: "foundation",
    tone: "stone",
    startWeek: 12,
    spanWeeks: 2,
    badge: "Weeks 13-14",
    rangeLabel: "Weeks 13-14",
    summary: "Retire the old Watch stack after the migration is stable.",
    sections: [
      {
        label: "Week 13 (Build)",
        items: ["Remove legacy dependencies"],
      },
      {
        label: "Week 14 (Release #6)",
        items: ["Retire old Watch", "Remove Algolia"],
      },
    ],
  },
]

const FUTURE_WORK_PRIORITIES = [
  {
    id: "future-work-caleb-china-streaming",
    title: "Explore China streaming",
    badge: "Caleb",
    summary: "Assess how Forge media could stream reliably into China.",
    startWeek: 15,
    lane: 0,
    details: [
      "Explore platform, delivery, and regulatory constraints",
      "Identify a viable test path for video streaming in China",
    ],
  },
  {
    id: "future-work-urim-up-mobile-tv-mvp",
    title: "Define Mobile + TV MVP",
    badge: "Urim + Up",
    summary: "Set the minimum releasable criteria for both applications.",
    startWeek: 15,
    lane: 1,
    details: [
      "Decide what must ship versus what can follow later",
      "Evaluate optional mobile QR-code TV sign-in without forcing accounts",
      "Include regression quality and custom-player trade-offs in the release bar",
    ],
  },
  {
    id: "future-work-nisal-search-quality",
    title: "Improve search quality",
    badge: "Nisal",
    summary: "Advance recommendations, ranking, and dead-result discovery.",
    startWeek: 15,
    lane: 2,
    details: [
      "Bring proven Algolia ranking rules into Typesense",
      "Replace hardcoded query-language maps with programmatic detection",
      "Index available subtitles and surface dead-result patterns",
      "Keep search responses under one second",
    ],
  },
  {
    id: "future-work-jaco-jian-components",
    title: "Decompose components",
    badge: "Jaco + Jian Wei",
    summary: "Define components that can integrate across products.",
    startWeek: 15,
    lane: 3,
    details: [
      "Break the current work into reusable product building blocks",
      "Define integration boundaries and contracts for each component",
    ],
  },
  {
    id: "future-work-jaco-jian-present",
    title: "Present to Miheret",
    badge: "Jaco + Jian Wei",
    summary: "Present the reusable-component plan and decisions needed.",
    startWeek: 15,
    lane: 4,
    details: [
      "Show how the components connect to the wider product portfolio",
      "Confirm decisions, ownership, and next integration steps with Miheret",
    ],
  },
  {
    id: "future-work-tatai-lyuba-video-agents",
    title: "Advance video agents",
    badge: "Tatai + Lyuba",
    summary: "Help Lyuba move video-generation agents toward reliable use.",
    startWeek: 19,
    lane: 0,
    details: [
      "Improve the video-generation agent workflow",
      "Define reliability checks and a repeatable operating path",
    ],
  },
  {
    id: "future-work-tatai-experience-generation",
    title: "Run experience generation",
    badge: "Tatai",
    summary: "Keep experience generation progressing in the background.",
    startWeek: 19,
    lane: 1,
    details: [
      "Operate generation without blocking foreground product work",
      "Surface failures and quality gaps for follow-up",
    ],
  },
  {
    id: "future-work-service-agent-loops",
    title: "Build service-improvement loops",
    badge: "Owner TBD",
    summary: "Use agents to maintain and continuously improve services.",
    startWeek: 19,
    lane: 2,
    details: [
      "Connect Datadog and Railway performance signals to agent workflows",
      "Detect crawler-related crashes and recurring production regressions",
      "Turn repeated findings into verified maintenance work",
    ],
  },
  {
    id: "future-work-caleb-language-support",
    title: "Expand language support",
    badge: "Caleb",
    summary: "Improve metadata, translation, and multilingual coverage.",
    startWeek: 19,
    lane: 3,
    details: [
      "Strengthen multilingual metadata coverage",
      "Improve translation and language-support workflows across products",
    ],
  },
  {
    id: "future-work-siyang-zy-nextsteps",
    title: "Ship NextSteps",
    badge: "Siyang + ZY",
    summary: "Deliver the core NextSteps product surface and integrations.",
    startWeek: 19,
    lane: 4,
    details: [
      "Connect the NextSteps experience to relevant product journeys",
      "Prepare the surface for chat, questions, studies, and church connections",
    ],
  },
  {
    id: "future-work-vlad-core-translation",
    title: "Translate Core content",
    badge: "Vlad",
    summary: "Finish every untranslated Core content field.",
    startWeek: 23,
    lane: 0,
    details: [
      "Translate titles, descriptions, questions, and metadata",
      "Track completion and quality across every supported language",
    ],
  },
  {
    id: "future-work-vlad-bible-translation",
    title: "Translate Bible quotations",
    badge: "Vlad",
    summary: "Complete translation coverage for all Bible quotations.",
    startWeek: 23,
    lane: 1,
    details: [
      "Find Bible quotations without localized text",
      "Generate, review, and publish the missing translations",
    ],
  },
  {
    id: "future-work-vlad-accounts-notifications",
    title: "Add accounts + notifications",
    badge: "Vlad",
    summary: "Add accounts and cross-channel user notifications.",
    startWeek: 23,
    lane: 2,
    details: [
      "Support user accounts without forcing sign-in for basic viewing",
      "Deliver notifications through email and messaging channels",
    ],
  },
  {
    id: "future-work-vlad-mission-stories",
    title: "Collect mission stories",
    badge: "Vlad",
    summary: "Ask how media is used and follow up for mission-trip stories.",
    startWeek: 23,
    lane: 3,
    details: [
      "Create forms that capture how people use Jesus Film media",
      "Automatically follow up to collect the resulting mission stories",
    ],
  },
  {
    id: "future-work-vlad-next-step-actions",
    title: "Clarify next-step actions",
    badge: "Vlad",
    summary: "Make ministry calls to action clearer and more useful.",
    startWeek: 27,
    lane: 0,
    details: [
      "Create clear paths to chat, questions, Bible studies, and churches",
      "Measure which actions people understand and complete",
    ],
  },
  {
    id: "future-work-vlad-shareable-search",
    title: "Make search shareable",
    badge: "Vlad",
    summary: "Give every search result set a stable, shareable URL.",
    startWeek: 27,
    lane: 1,
    details: [
      "Represent search state in a static URL",
      "Keep shared result pages usable across languages and devices",
    ],
  },
  {
    id: "future-work-vlad-verse-pages",
    title: "Create verse video pages",
    badge: "Vlad",
    summary: "Create a unique video experience for every Bible verse.",
    startWeek: 27,
    lane: 2,
    details: [
      "Publish one stable page per verse",
      "Connect each verse to relevant video and experience content",
    ],
  },
  {
    id: "future-work-vlad-video-faqs",
    title: "Generate video FAQs",
    badge: "Vlad",
    summary: "Create an AI-generated FAQ for every video.",
    startWeek: 27,
    lane: 3,
    details: [
      "Generate frequently asked questions rather than discussion prompts",
      "Review answer quality and connect FAQs to the source video",
    ],
  },
  {
    id: "future-work-vlad-seo-agent",
    title: "Operate SEO agent",
    badge: "Vlad",
    summary: "Run an always-on SEO and maintenance agent in Mastra.",
    startWeek: 31,
    lane: 0,
    details: [
      "Use Search Console and analytics to find high-impact improvements",
      "Filter bot traffic before prioritizing analytics-driven work",
      "Propose and verify recurring maintenance changes",
    ],
  },
  {
    id: "future-work-vlad-support-agent",
    title: "Operate support agent",
    badge: "Vlad",
    summary: "Run an always-on support-learning agent in Mastra.",
    startWeek: 31,
    lane: 1,
    details: [
      "Monitor Watch feedback and support tickets",
      "Turn repeated user problems into reviewed learning work",
    ],
  },
  {
    id: "future-work-vlad-translation-agent",
    title: "Operate translation agent",
    badge: "Vlad",
    summary: "Finish and improve the always-on translation agent in Mastra.",
    startWeek: 31,
    lane: 2,
    details: [
      "Complete missing translations continuously",
      "Detect weak output and keep translation quality improving",
    ],
  },
] satisfies FutureWorkPriority[]

export const PLANNED_TRACK_BARS: PlannedTrackBar[] = [
  {
    id: "actual-foundation-track",
    title: "Foundation",
    summary: "Actual foundation work extended from W1 through the end of W5.",
    track: "actual-foundation",
    tone: "stone",
    startWeek: 0,
    spanWeeks: 5,
    badge: "Actual W1-5",
    details: [
      "Foundation work ran from W1 through the end of W5",
      "Kept CMS, data, infrastructure, stability, and migration base visible as actual delivery",
    ],
  },
  {
    id: "actual-player-track",
    title: "Replace Player Page",
    summary: "Actual player replacement work spans W3 through W6.",
    track: "actual-player",
    tone: "amber",
    startWeek: 2,
    spanWeeks: 4,
    badge: "Actual W3-6",
    details: [
      "Player page replacement moved from the planned W3-W4 window to W3-W6",
      "Keeps the player release connected to the extended foundation work",
    ],
  },
  {
    id: "actual-experiences-track",
    title: "Experiences Rollout",
    summary:
      "Actual experiences rollout starts in W6 and keeps the same duration.",
    track: "actual-surface",
    tone: "amber",
    startWeek: 5,
    spanWeeks: 2,
    badge: "Actual W6-7",
    details: ["Experiences rollout starts in W6", "Duration remains two weeks"],
  },
  {
    id: "actual-search-track",
    title: "Search Rollout",
    summary: "Shifted two-week search rollout after the experiences block.",
    track: "actual-search",
    tone: "sky",
    startWeek: 7,
    spanWeeks: 2,
    badge: "Actual W8-9",
    details: [
      "Search rollout keeps the planned two-week duration",
      "Starts after the shifted experiences rollout",
    ],
  },
  {
    id: "actual-homepage-track",
    title: "Watch Homepage",
    summary: "Shifted two-week homepage rollout after search.",
    track: "actual-surface",
    tone: "amber",
    startWeek: 9,
    spanWeeks: 2,
    badge: "Actual W10-11",
    details: [
      "Homepage rollout keeps the planned two-week duration",
      "Follows the shifted search rollout",
    ],
  },
  {
    id: "actual-stability-track",
    title: "i18n + Stability",
    summary: "Shifted two-week stability block before shutdown.",
    track: "actual-foundation",
    tone: "stone",
    startWeek: 11,
    spanWeeks: 2,
    badge: "Actual W12-13",
    details: [
      "Internationalization and stability keep the planned two-week duration",
      "Moves with the shifted delivery forecast",
    ],
  },
  {
    id: "actual-shutdown-track",
    title: "Old Watch Shutdown",
    summary: "Shifted two-week old Watch shutdown block.",
    track: "actual-foundation",
    tone: "stone",
    startWeek: 13,
    spanWeeks: 2,
    badge: "Actual W14-15",
    details: [
      "Old Watch shutdown keeps the planned two-week duration",
      "Moves to W14-W15 after the shifted stability block",
    ],
  },
  ...FUTURE_WORK_PRIORITIES.map(
    (priority): PlannedTrackBar => ({
      ...priority,
      track: "future-work",
      tone: "stone",
      spanWeeks: 4,
    }),
  ),
  {
    id: "agentic-track",
    title: "Agentic Framework",
    summary:
      "Build with Mastra AI, validate workflows, integrate after migration.",
    track: "agentic-framework",
    tone: "emerald",
    startWeek: 0,
    spanWeeks: 4,
    details: [
      "Build with Mastra AI",
      "Validate workflows for search and experiences",
      "Integrate after migration, not before",
    ],
  },
  {
    id: "agentic-deployment-track",
    title: "First agent deployment",
    summary: "Deploy the first production agent.",
    track: "agentic-framework",
    tone: "emerald",
    startWeek: 4,
    spanWeeks: 2,
    details: [
      "Deploy first agent to production use",
      "Validate first real agent workflow after framework setup",
    ],
  },
  {
    id: "agentic-deployment-track-2",
    title: "New agent deployment",
    summary: "Ship another production agent.",
    track: "agentic-framework",
    tone: "emerald",
    startWeek: 6,
    spanWeeks: 2,
    details: [
      "Deploy another agent to production use",
      "Expand agent workflows beyond the first release",
    ],
  },
  {
    id: "agentic-deployment-track-3",
    title: "New agent deployment",
    summary: "Ship another production agent.",
    track: "agentic-framework",
    tone: "emerald",
    startWeek: 8,
    spanWeeks: 2,
    details: [
      "Deploy another agent to production use",
      "Continue validating repeatable agent delivery",
    ],
  },
  {
    id: "agentic-deployment-track-4",
    title: "New agent deployment",
    summary: "Ship another production agent.",
    track: "agentic-framework",
    tone: "emerald",
    startWeek: 10,
    spanWeeks: 2,
    details: [
      "Deploy another agent to production use",
      "Strengthen the deployment cadence for agent workflows",
    ],
  },
  {
    id: "agentic-deployment-track-5",
    title: "New agent deployment",
    summary: "Ship another production agent.",
    track: "agentic-framework",
    tone: "emerald",
    startWeek: 12,
    spanWeeks: 2,
    details: [
      "Deploy another agent to production use",
      "Finish the roadmap with an ongoing agent release rhythm",
    ],
  },
  {
    id: "mobile-track",
    title: "Mobile + TV",
    summary: "Build the mobile + TV foundation for later rollout.",
    track: "mobile-tv",
    tone: "lime",
    startWeek: 0,
    spanWeeks: 4,
    badge: "Beta",
    details: [
      "Build the Expo / TV app foundation",
      "Prepare later Forge connection work",
      "Keep release for a later phase",
    ],
  },
  {
    id: "mobile-single-player-track",
    title: "Single player screen",
    summary: "Build the first mobile playback screen.",
    track: "mobile-tv",
    tone: "lime",
    startWeek: 4,
    spanWeeks: 2,
    badge: "Beta",
    details: [
      "Build the single-player screen on mobile",
      "Carry playback UX into the mobile lane",
    ],
  },
  {
    id: "mobile-experiences-track",
    title: "Experiences screen",
    summary: "Roll out experiences to mobile platforms.",
    track: "mobile-tv",
    tone: "lime",
    startWeek: 6,
    spanWeeks: 2,
    badge: "Beta",
    details: [
      "Port the experiences rollout to mobile + TV",
      "Carry weeks 5-6 experience work into mobile surfaces",
    ],
  },
  {
    id: "mobile-search-track",
    title: "Search on mobile + TV",
    summary: "Roll out search to mobile platforms.",
    track: "mobile-tv",
    tone: "lime",
    startWeek: 8,
    spanWeeks: 2,
    badge: "Beta",
    details: [
      "Port weeks 7-8 search work to mobile + TV",
      "Validate mobile search UX on the new surfaces",
    ],
  },
  {
    id: "mobile-homepage-track",
    title: "Mobile homepage rollout",
    summary: "Port the homepage rollout to mobile + TV.",
    track: "mobile-tv",
    tone: "lime",
    startWeek: 10,
    spanWeeks: 2,
    badge: "Beta",
    details: [
      "Port weeks 9-10 homepage work to mobile + TV",
      "Carry the main homepage rollout into mobile surfaces",
    ],
  },
  {
    id: "mobile-stability-track",
    title: "Internationalization and stability",
    summary: "Stabilize the mobile + TV release.",
    track: "mobile-tv",
    tone: "lime",
    startWeek: 12,
    spanWeeks: 2,
    badge: "Beta",
    details: [
      "Add internationalization to mobile + TV",
      "Finish with stability and bug-fix work",
    ],
  },
]

export const PLANNED_MILESTONES: PlannedMilestone[] = [
  {
    id: "creator-launch",
    label: "Creator launch",
    dateLabel: "May 10, 2026",
    description:
      "Media Creators Community (Lyuba): launch the AI inspiration board + contest to attract creators and seed future templates/workflows. Visibility only, non-blocking.",
    track: "milestones",
    tone: "red",
    date: "2026-05-10",
  },
  {
    id: "demo-day",
    label: "Demo Day",
    dateLabel: "May 15, 2026",
    description:
      "Show the player with AI subtitles and experience generation. Narrative: User asks -> AI guides -> media responds.",
    items: ["Player (AI subtitles)", "Experience generation"],
    quote: "User asks -> AI guides -> media responds",
    track: "milestones",
    tone: "rose",
    date: "2026-05-15",
  },
]

export const PLANNED_DEMO_DAY = {
  title: "Demo Day",
  dateLabel: "May 15, 2026",
  showcase: ["Player (AI subtitles)", "Experience generation"],
  narrative: "User asks -> AI guides -> media responds",
}
