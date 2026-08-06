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
  | "reliability"
  | "journeys"
  | "localization"
  | "devotional"
  | "distribution"
  | "mobile-tv"
  | "operating-rhythm"

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
const WEEK_MS = 7 * DAY_MS
const PLANNED_START_DATE = new Date("2026-08-03T00:00:00Z")

function addWeeks(date: Date, weeks: number): Date {
  return new Date(date.getTime() + weeks * WEEK_MS)
}

function formatDateRangeLabel(startDate: Date, endDate: Date): string {
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
    return `${startMonth} ${startDay}-${endDay}`
  }

  return `${startMonth} ${startDay}-${endMonth} ${endDay}`
}

export const PLANNED_WEEK_COUNT = 21
export const PLANNED_START_ISO = "2026-08-03"

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

export const PLANNED_TITLE = "August-December 2026 Roadmap"
export const PLANNED_SUBTITLE = "Starting Aug 3, 2026"
export const PLANNED_RANGE_LABEL = "Aug 3 - Dec 27, 2026"
export const PLANNED_GOAL =
  "Turn the new Watch foundation into reliable, multilingual journeys that grow people in faith across web, YouTube, mobile, and TV, with human judgment protecting every ministry-facing AI workflow."

export const PLANNED_CADENCE = [
  "Two-week build and release slices",
  "Monthly Demo Day with user evidence",
  "Quarterly strategy and performance review",
]

export const PLANNED_TRACKS: PlannedTrack[] = [
  {
    id: "milestones",
    label: "Milestones",
    description: "Demo, grant, and review checkpoints",
  },
  {
    id: "reliability",
    label: "Reliability",
    description: "Watch performance, operability, and release safety",
  },
  {
    id: "journeys",
    label: "Accounts & Journeys",
    description: "Identity continuity and seeker-to-partner pathways",
  },
  {
    id: "localization",
    label: "Localization & Quality",
    description: "Multilingual discovery, translation, and human QA",
  },
  {
    id: "devotional",
    label: "Devotional AI",
    description: "Human-reviewed devotional production and distribution",
  },
  {
    id: "distribution",
    label: "Distribution Experiments",
    description: "YouTube-first audience learning and journey validation",
  },
  {
    id: "mobile-tv",
    label: "Mobile + TV",
    description: "Alternating platform delivery toward shared beta quality",
  },
  {
    id: "operating-rhythm",
    label: "Operating Rhythm",
    description: "Strategy alignment, demos, metrics, and roadmap decisions",
  },
]

export const PLANNED_TIMELINE_ROWS: PlannedTimelineRow[] = [
  {
    id: "product-outcomes",
    label: "Product Outcomes",
    description: "Reliable, continuous, multilingual Watch journeys",
    trackIds: ["reliability", "journeys", "localization"],
    sublanes: [
      { id: "reliability", trackIds: ["reliability"] },
      { id: "journeys", trackIds: ["journeys"] },
      { id: "localization", trackIds: ["localization"] },
    ],
  },
  {
    id: "content-distribution",
    label: "Content & Distribution",
    description: "Human-reviewed AI content and audience learning",
    trackIds: ["devotional", "distribution"],
    sublanes: [
      { id: "devotional", trackIds: ["devotional"] },
      { id: "distribution", trackIds: ["distribution"] },
    ],
  },
  {
    id: "platforms-cadence",
    label: "Platforms & Cadence",
    description: "Mobile/TV delivery and a measurable learning loop",
    trackIds: ["mobile-tv", "operating-rhythm"],
    sublanes: [
      { id: "mobile-tv", trackIds: ["mobile-tv"] },
      { id: "operating-rhythm", trackIds: ["operating-rhythm"] },
    ],
  },
]

export const PLANNED_PHASES: PlannedPhase[] = [
  {
    id: "watch-reliability",
    title: "Watch reliability & operability",
    shortTitle: "Watch Reliability",
    track: "reliability",
    tone: "stone",
    startWeek: 0,
    spanWeeks: 4,
    badge: "August",
    rangeLabel: "Weeks 1-4",
    summary:
      "Make the new Watch stack dependable enough that traffic, content, and release failures are visible before users report them.",
    sections: [
      {
        label: "Deliver",
        items: [
          "Close remaining loading, timeout, search, and large-series performance risks",
          "Add visibility for Cloudflare/proxy failures before requests reach Next.js",
          "Tune availability signals so healthy auxiliary routes cannot mask Watch degradation",
          "Organize Admin operations around the workflows the team actually uses",
        ],
      },
      {
        label: "Exit criteria",
        items: [
          "Critical Watch routes have release gates, useful traces, and actionable alerts",
          "The legacy Watch shutdown has a verified rollback and dependency-retirement path",
          "High-traffic playback, search, homepage, and series flows pass production smoke checks",
        ],
      },
    ],
  },
  {
    id: "accounts-continuity",
    title: "Accounts & continuity pilot",
    shortTitle: "Accounts & Continuity",
    track: "journeys",
    tone: "amber",
    startWeek: 2,
    spanWeeks: 6,
    badge: "Aug-Sep",
    rangeLabel: "Weeks 3-8",
    summary:
      "Turn optional sign-in into visible continuity across Watch, mobile, and TV without making public ministry content account-gated.",
    sections: [
      {
        label: "Deliver",
        items: [
          "Ship saved playback progress and resume behavior on the signed-in Web foundation",
          "Define one account and session contract for web, mobile, TV, and future partner roles",
          "Prototype TV sign-in with a remote/QR flow and carry continuity into mobile beta",
          "Map the manual seeker-to-partner handoff before automating routing or remarketing",
        ],
      },
      {
        label: "Safety boundaries",
        items: [
          "Anonymous browsing and playback stay open",
          "Downloads in sensitive contexts are not blocked by account creation",
          "Centralize only the user metadata needed for continuity and consented follow-up",
        ],
      },
    ],
  },
  {
    id: "youtube-journey-validation",
    title: "YouTube-to-journey validation",
    shortTitle: "YouTube Journey Tests",
    track: "distribution",
    tone: "rose",
    startWeek: 4,
    spanWeeks: 6,
    badge: "Sep-Oct",
    rangeLabel: "Weeks 5-10",
    summary:
      "Test how believers and seekers move between YouTube, Watch, NextSteps, and partner follow-up before scaling an unproven off-platform assumption.",
    sections: [
      {
        label: "Experiments",
        items: [
          "Define separate believer-growth and seeker-response hypotheses",
          "Instrument a small set of YouTube-to-Watch and YouTube-to-NextSteps journeys",
          "Compare off-platform journeys with experiences that keep viewers on YouTube",
          "Tag pilot media with Scripture, felt need, audience, and next-step intent",
        ],
      },
      {
        label: "Decision gate",
        items: [
          "Measure reach, retention, downstream engagement, and follow-up completion by cohort",
          "Scale only journey patterns that outperform their YouTube-native baseline",
          "Keep manual partner handoff in the loop until value and safety are proven",
        ],
      },
    ],
  },
  {
    id: "devotional-human-review",
    title: "Devotional pilot with human review",
    shortTitle: "Devotional Pilot",
    track: "devotional",
    tone: "emerald",
    startWeek: 6,
    spanWeeks: 8,
    badge: "Sep-Nov",
    rangeLabel: "Weeks 7-14",
    summary:
      "Productionize one bounded devotional workflow from editable source material to approved web and social cuts.",
    sections: [
      {
        label: "Deliver",
        items: [
          "Finish the existing devotional Workspace, composition, and distribution roadmap arc",
          "Create the full devotional landing/template experience and a short social cut",
          "Use licensed source media, editable human-authored inputs, and explicit provenance",
          "Add voice, subtitle, Scripture, and storytelling quality checks",
        ],
      },
      {
        label: "Publication gate",
        items: [
          "A human theology reviewer must approve ministry-facing output before publication",
          "Reviewers can see the source, model output, risk flags, and final rendered artifact",
          "The pilot can pause safely and never auto-publishes ambiguous or high-risk content",
        ],
      },
    ],
  },
  {
    id: "multilingual-quality",
    title: "Multilingual discovery & translation QA",
    shortTitle: "Multilingual Quality",
    track: "localization",
    tone: "sky",
    startWeek: 10,
    spanWeeks: 8,
    badge: "Oct-Dec",
    rangeLabel: "Weeks 11-18",
    summary:
      "Expand beyond the stable base languages with demand-led AI translation and a real human quality loop.",
    sections: [
      {
        label: "Deliver",
        items: [
          "Prioritize languages using audience demand, source availability, and reviewer capacity",
          "Translate inner-page copy, subtitles, metadata, and generated experiences through one governed workflow",
          "Recruit a reviewer cohort and capture spelling, rhythm, theology, and cultural feedback",
          "Make unavailable, requested, machine-generated, and human-approved states explicit",
        ],
      },
      {
        label: "Exit criteria",
        items: [
          "Every published translation has a defined automated or human approval path",
          "Quality, cost, latency, and correction rate are measurable per language",
          "The product never silently substitutes a translated caption or page experience",
        ],
      },
    ],
  },
  {
    id: "year-end-evaluation",
    title: "Year-end learning review & 2027 plan",
    shortTitle: "2027 Planning",
    track: "operating-rhythm",
    tone: "red",
    startWeek: 18,
    spanWeeks: 3,
    badge: "December",
    rangeLabel: "Weeks 19-21",
    summary:
      "Convert the year’s delivery and audience evidence into a smaller, prioritized 2027 roadmap.",
    sections: [
      {
        label: "Review",
        items: [
          "Compare roadmap promises with shipped outcomes and unresolved production risks",
          "Review cohort metrics for YouTube journeys, accounts, devotionals, localization, mobile, and TV",
          "Retire work that did not prove value and preserve only supported follow-on bets",
        ],
      },
      {
        label: "Outcome",
        items: [
          "Publish a dependency-ordered Q1 2027 roadmap with owners and measurable exit criteria",
          "Record the external performance baseline for quarterly review",
        ],
      },
    ],
  },
]

export const PLANNED_TRACK_BARS: PlannedTrackBar[] = [
  {
    id: "tv-observability",
    title: "TV stability & observability",
    summary:
      "Harden crash reporting, performance visibility, and showcase playback.",
    track: "mobile-tv",
    tone: "lime",
    startWeek: 0,
    spanWeeks: 2,
    badge: "TV",
    details: [
      "Verify production crash-reporting access and release diagnostics",
      "Finish showcase/player stability on real TV hardware",
    ],
  },
  {
    id: "mobile-offline",
    title: "Mobile offline & player",
    summary:
      "Make downloads and long-form playback reliable before widening beta.",
    track: "mobile-tv",
    tone: "lime",
    startWeek: 2,
    spanWeeks: 2,
    badge: "Mobile",
    details: [
      "Keep large series downloads off the JavaScript thread",
      "Validate offline-first behavior and player interaction quality",
    ],
  },
  {
    id: "tv-account-prototype",
    title: "TV account prototype",
    summary: "Prototype remote/QR sign-in against the shared account contract.",
    track: "mobile-tv",
    tone: "lime",
    startWeek: 4,
    spanWeeks: 2,
    badge: "TV",
    details: [
      "Prove a remote authentication flow without weakening device safety",
      "Carry language and playback identity through sign-in",
    ],
  },
  {
    id: "mobile-experiences-search",
    title: "Mobile experiences & search",
    summary: "Bring the strongest Watch discovery flows into mobile beta.",
    track: "mobile-tv",
    tone: "lime",
    startWeek: 6,
    spanWeeks: 2,
    badge: "Mobile",
    details: [
      "Validate mobile experience navigation and multilingual search",
      "Preserve offline and signed-out behavior",
    ],
  },
  {
    id: "tv-experiences-search",
    title: "TV experiences & search",
    summary: "Adapt search and experience rails to ten-foot navigation.",
    track: "mobile-tv",
    tone: "lime",
    startWeek: 8,
    spanWeeks: 2,
    badge: "TV",
    details: [
      "Tune remote focus, labels, and content hierarchy",
      "Validate performance on representative devices",
    ],
  },
  {
    id: "mobile-beta-quality",
    title: "Mobile beta quality",
    summary: "Use tester evidence to close the highest-risk mobile gaps.",
    track: "mobile-tv",
    tone: "lime",
    startWeek: 10,
    spanWeeks: 2,
    badge: "Mobile",
    details: [
      "Run a bounded internal/public beta feedback cycle",
      "Fix release-blocking crashes, downloads, and playback regressions",
    ],
  },
  {
    id: "tv-beta-quality",
    title: "TV beta quality",
    summary: "Use device testing to close the highest-risk TV gaps.",
    track: "mobile-tv",
    tone: "lime",
    startWeek: 12,
    spanWeeks: 2,
    badge: "TV",
    details: [
      "Exercise home, search, series, player, and auth paths on target hardware",
      "Close focus and telemetry gaps before wider release",
    ],
  },
  {
    id: "cross-platform-continuity",
    title: "Cross-platform continuity",
    summary:
      "Unify identity, progress, and language behavior across supported platforms.",
    track: "mobile-tv",
    tone: "lime",
    startWeek: 14,
    spanWeeks: 4,
    badge: "Shared",
    details: [
      "Agree on shared account, progress, and content identity contracts",
      "Prove continuity without forcing accounts for public playback",
    ],
  },
  {
    id: "platform-year-end-hardening",
    title: "Year-end beta hardening",
    summary:
      "Finish with cross-platform regression, store readiness, and release evidence.",
    track: "mobile-tv",
    tone: "lime",
    startWeek: 18,
    spanWeeks: 3,
    badge: "Mobile + TV",
    details: [
      "Run shared release smoke tests and performance checks",
      "Document deferred parity and the safest 2027 rollout sequence",
    ],
  },
  {
    id: "strategy-alignment",
    title: "Strategy & audience alignment",
    summary:
      "Set the audience boundaries and product pillars that govern year-end work.",
    track: "operating-rhythm",
    tone: "red",
    startWeek: 0,
    spanWeeks: 2,
    details: [
      "Agree on believer-growth and seeker-response outcomes",
      "Clarify engineering, product, ministry, and reviewer decision rights",
    ],
  },
  {
    id: "monthly-demo-learning",
    title: "Monthly demo & learning loop",
    summary:
      "Demo shipped outcomes monthly, review user evidence, and adjust the next slice.",
    track: "operating-rhythm",
    tone: "red",
    startWeek: 2,
    spanWeeks: 16,
    badge: "Monthly",
    details: [
      "Demo working product, not slideware",
      "Review audience, quality, reliability, and follow-up measures",
      "Update the 90-day grant view and task tracker after every review",
      "Capture onboarding recordings so the team can reuse the new AI workflows",
    ],
  },
]

export const PLANNED_MILESTONES: PlannedMilestone[] = [
  {
    id: "august-demo",
    label: "Demo Day",
    dateLabel: "Aug 4, 2026",
    description:
      "Reset the monthly cadence with a working-product demonstration.",
    items: ["Watch baseline", "Mobile + TV beta", "Devotional workflow"],
    track: "milestones",
    tone: "rose",
    date: "2026-08-04",
  },
  {
    id: "september-demo",
    label: "September Demo Day",
    dateLabel: "Sep 1, 2026",
    description: "Review accounts, continuity, and first journey experiments.",
    track: "milestones",
    tone: "rose",
    date: "2026-09-01",
  },
  {
    id: "grant-checkpoint",
    label: "90-day roadmap review",
    dateLabel: "Oct 30, 2026",
    description:
      "Reconcile grant commitments with shipped outcomes and current evidence.",
    track: "milestones",
    tone: "red",
    date: "2026-10-30",
  },
  {
    id: "november-demo",
    label: "November Demo Day",
    dateLabel: "Nov 3, 2026",
    description:
      "Review the devotional pilot, translation quality, and platform betas.",
    track: "milestones",
    tone: "rose",
    date: "2026-11-03",
  },
  {
    id: "year-end-review",
    label: "Year-end learning review",
    dateLabel: "Dec 18, 2026",
    description:
      "Select the evidence-backed priorities that continue into 2027.",
    track: "milestones",
    tone: "red",
    date: "2026-12-18",
  },
]

export const PLANNED_DEMO_DAY = {
  title: "Monthly Demo Day",
  dateLabel: "First Tuesday of each month",
  showcase: [
    "Working product outcomes",
    "Audience and quality evidence",
    "Next-slice decisions",
  ],
  narrative: "Ship -> observe -> learn -> reprioritize",
}
