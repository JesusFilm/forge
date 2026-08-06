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
  badge?: string
  details?: string[]
  overdueStartWeek?: number
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
}

const DAY_MS = 86400000
const WEEK_MS = 7 * 86400000
const PLANNED_START_DATE = new Date("2026-04-28T00:00:00")

function addWeeks(date: Date, weeks: number): Date {
  return new Date(date.getTime() + weeks * WEEK_MS)
}

function formatDateRangeLabel(startDate: Date, endDate: Date): string {
  const startMonth = startDate.toLocaleDateString("en-US", { month: "short" })
  const startDay = startDate.toLocaleDateString("en-US", { day: "numeric" })
  const endMonth = endDate.toLocaleDateString("en-US", { month: "short" })
  const endDay = endDate.toLocaleDateString("en-US", { day: "numeric" })

  if (startMonth === endMonth) {
    return `${startMonth} ${startDay}-${endDay}`
  }

  return `${startMonth} ${startDay}-${endMonth} ${endDay}`
}

export const PLANNED_WEEK_COUNT = 15
export const PLANNED_START_ISO = "2026-04-28"

export const PLANNED_WEEKS: PlannedWeek[] = Array.from(
  { length: PLANNED_WEEK_COUNT },
  (_, index) => {
    const date = addWeeks(PLANNED_START_DATE, index)
    const endDate = new Date(date.getTime() + 6 * DAY_MS)
    return {
      index,
      shortLabel: `W${index + 1}`,
      label: `Week ${index + 1}`,
      dateLabel: formatDateRangeLabel(date, endDate),
      isoDate: date.toISOString().slice(0, 10),
    }
  },
)

export const PLANNED_TITLE = "FORGE ROADMAP - Next 3 Months"
export const PLANNED_SUBTITLE = "Starting Apr 28, 2026"
export const PLANNED_RANGE_LABEL = "Apr 28 - Aug 10, 2026"
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
    description: "Original migration release plan",
    trackIds: ["foundation", "surface", "search"],
  },
  {
    id: "delivery-actual",
    label: "Delivery Actual",
    description: "Current delivery reality and shifted forecast",
    trackIds: [
      "actual-foundation",
      "actual-player",
      "actual-surface",
      "actual-search",
    ],
    sublanes: [
      {
        id: "actual-foundation",
        trackIds: ["actual-foundation"],
      },
      {
        id: "actual-player",
        trackIds: ["actual-player"],
      },
      {
        id: "actual-follow-on",
        trackIds: ["actual-surface", "actual-search"],
      },
    ],
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
    overdueStartWeek: 2,
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
    overdueStartWeek: 4,
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
    overdueStartWeek: 6,
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
    overdueStartWeek: 8,
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
    overdueStartWeek: 10,
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
    overdueStartWeek: 12,
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
    overdueStartWeek: 14,
    details: [
      "Old Watch shutdown keeps the planned two-week duration",
      "Moves to W14-W15 after the shifted stability block",
    ],
  },
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
