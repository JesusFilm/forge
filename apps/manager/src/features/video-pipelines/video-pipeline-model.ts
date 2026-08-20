export type VideoPipelineAggregateStatus = "generated" | "none"

export type VideoPipelineCell = {
  id: string
  title: string
  date: string
  thumbnailUrl: string | null
  mobileGenerated: boolean
  desktopGenerated: boolean
}

export type VideoPipelineCollection = {
  id: string
  title: string
  label: string
  labelDisplay: string
  cells: VideoPipelineCell[]
}

const DEVOTIONAL_THUMBNAIL_URL = "/devotional-thumb-placeholder.svg"

/** Draft devotional titles for August 2026, one per day (index 0 = Aug 1). */
const DEVOTIONAL_TITLES = [
  "The night the ordinary sky wasn't ordinary",
  "Twelve years old and already about His Father's business",
  "Before He did anything, the Father was already pleased",
  "What Jesus refused so He could give you something better",
  "He didn't pick the impressive ones",
  "For a moment, the disguise came off",
  "She wasn't invited. She came anyway",
  "Same seed, four different soils, one honest question",
  "What Jesus knows that panic makes you forget",
  "He didn't run from the one everyone else avoided",
  "The God who multiplies bread can multiply your faith",
  "Blessed doesn't mean what you think it means",
  "He taught them to ask, not to perform",
  "Why He compares God to a father, not a stranger",
  "Small doesn't mean small forever",
  "The company He kept says everything",
  "Eighteen years bent over, and no one else stopped",
  "He was told to be quiet. He shouted louder",
  "The question was who's my neighbor. The answer was uncomfortable",
  "Jesus came looking for you before you went looking for Him",
  "Even the silence would have shouted",
  "He cried for a city that wouldn't turn around",
  "Two coins meant more than the whole treasury",
  "He knew what was coming and broke bread anyway",
  "A kiss used as a weapon",
  "He said he never would. He did. Jesus still looked at him",
  "He carried it so you wouldn't have to carry it alone",
  "Father, into Your hands, the last words that changed everything",
  "Why are you looking for the living among the dead?",
  "Peace be with you. He meant it literally",
  "His last words were a job, not a goodbye",
]

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
]

const MONTH_NAMES_SHORT = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
]

function pad2(value: number): string {
  return String(value).padStart(2, "0")
}

const FULLY_GENERATED_DAY_COUNT = 7

/**
 * Deterministic (not Math.random) mobile/desktop generation pattern for
 * August, keyed off day-of-month. The first week (Aug 1-7) is fully
 * generated so the list opens on a realistic "already done" run; the
 * remaining days cycle through mobile-only / desktop-only / neither so the
 * fixture still exercises every (mobileGenerated, desktopGenerated)
 * combination.
 */
function generationStateForAugustDay(day: number): {
  mobileGenerated: boolean
  desktopGenerated: boolean
} {
  if (day <= FULLY_GENERATED_DAY_COUNT) {
    return { mobileGenerated: true, desktopGenerated: true }
  }

  switch ((day - FULLY_GENERATED_DAY_COUNT - 1) % 3) {
    case 0:
      return { mobileGenerated: true, desktopGenerated: false }
    case 1:
      return { mobileGenerated: false, desktopGenerated: true }
    default:
      return { mobileGenerated: false, desktopGenerated: false }
  }
}

type DevotionMonthSpec = {
  /** 0 = January ... 11 = December. */
  monthIndex: number
  year: number
  slug: string
}

/**
 * August is the only month with production underway (real draft titles,
 * partial generation progress); September-December are future/unstarted
 * months, so every cell in them is not-yet-generated.
 */
const DEVOTION_MONTHS: DevotionMonthSpec[] = [
  { monthIndex: 7, year: 2026, slug: "august" },
  { monthIndex: 8, year: 2026, slug: "september" },
  { monthIndex: 9, year: 2026, slug: "october" },
  { monthIndex: 10, year: 2026, slug: "november" },
  { monthIndex: 11, year: 2026, slug: "december" },
]

function daysInMonth(monthIndex: number, year: number): number {
  return new Date(year, monthIndex + 1, 0).getDate()
}

function buildDevotionsCollectionForMonth(
  spec: DevotionMonthSpec,
): VideoPipelineCollection {
  const isAugust = spec.slug === "august"
  const dayCount = daysInMonth(spec.monthIndex, spec.year)
  const monthNumber = spec.monthIndex + 1
  const monthLabel = MONTH_NAMES[spec.monthIndex] ?? spec.slug

  const cells: VideoPipelineCell[] = Array.from(
    { length: dayCount },
    (_, index) => {
      const day = index + 1
      const { mobileGenerated, desktopGenerated } = isAugust
        ? generationStateForAugustDay(day)
        : { mobileGenerated: false, desktopGenerated: false }

      return {
        id: `devotion-${spec.year}-${pad2(monthNumber)}-${pad2(day)}`,
        title: isAugust
          ? (DEVOTIONAL_TITLES[index] ?? "Devotional")
          : "Devotional",
        date: `${spec.year}-${pad2(monthNumber)}-${pad2(day)}`,
        thumbnailUrl: DEVOTIONAL_THUMBNAIL_URL,
        mobileGenerated,
        desktopGenerated,
      }
    },
  )

  return {
    id: `devotions-${spec.slug}`,
    title: `Devotions - ${monthLabel}`,
    label: "basic",
    labelDisplay: "Basic",
    cells,
  }
}

export function buildDevotionsAugustCollection(): VideoPipelineCollection {
  const augustSpec = DEVOTION_MONTHS[0]
  if (!augustSpec) throw new Error("expected an August month spec")
  return buildDevotionsCollectionForMonth(augustSpec)
}

/** August through December 2026, in that order. */
export function buildAllDevotionCollections(): VideoPipelineCollection[] {
  return DEVOTION_MONTHS.map(buildDevotionsCollectionForMonth)
}

/** The calendar day (1-31) a cell's date falls on, for the tile overlay. */
export function getCellDayOfMonth(date: string): number {
  return Number(date.split("-")[2])
}

export function findCellById(
  collection: VideoPipelineCollection,
  cellId: string,
): VideoPipelineCell | null {
  return collection.cells.find((cell) => cell.id === cellId) ?? null
}

/** Searches every collection (e.g. all months) for a cell by id. */
export function findCellAcrossCollections(
  collections: VideoPipelineCollection[],
  cellId: string,
): { cell: VideoPipelineCell; collection: VideoPipelineCollection } | null {
  for (const collection of collections) {
    const cell = findCellById(collection, cellId)
    if (cell) return { cell, collection }
  }
  return null
}

export function computeAggregateStatus(
  cell: Pick<VideoPipelineCell, "mobileGenerated" | "desktopGenerated">,
): VideoPipelineAggregateStatus {
  return cell.mobileGenerated && cell.desktopGenerated ? "generated" : "none"
}

export function formatCellDate(date: string): string {
  const [year, month, day] = date.split("-").map((part) => Number(part))
  const monthName = MONTH_NAMES[(month ?? 1) - 1] ?? MONTH_NAMES[0]

  return `${monthName} ${day}, ${year}`
}

/** Short "Aug 1" form (no year) used in the compact expanded-row list. */
export function formatCellShortDate(date: string): string {
  const [, month, day] = date.split("-").map((part) => Number(part))
  const monthName = MONTH_NAMES_SHORT[(month ?? 1) - 1] ?? MONTH_NAMES_SHORT[0]

  return `${monthName} ${day}`
}

/** "Aug 1 - Devotional" row label used in the expanded detail list. */
export function formatCellRowLabel(
  cell: Pick<VideoPipelineCell, "date" | "title">,
): string {
  return `${formatCellShortDate(cell.date)} - ${cell.title}`
}
