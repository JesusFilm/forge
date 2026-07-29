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
const AUGUST_DAY_COUNT = 31

/** Draft devotional titles for August 2026, one per day (index 0 = Aug 1). */
const DEVOTIONAL_TITLES = [
  "The night the ordinary sky wasn't ordinary",
  "Twelve years old and already about His Father's business",
  "Before He did anything, the Father was already pleased",
  "What Jesus refused so He could give you something better",
  "He didn't pick the impressive ones",
  "Blessed doesn't mean what you think it means",
  "She wasn't invited. She came anyway",
  "Same seed, four different soils, one honest question",
  "What Jesus knows that panic makes you forget",
  "He didn't run from the one everyone else avoided",
  "The God who multiplies bread can multiply your faith",
  "For a moment, the disguise came off",
  "He taught them to ask, not to perform",
  "Why He compares God to a father, not a stranger",
  "Small doesn't mean small forever",
  "The company He kept says everything",
  "Eighteen years bent over, and no one else stopped",
  "The question was who's my neighbor. The answer was uncomfortable",
  "He was told to be quiet. He shouted louder",
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

function padDay(day: number): string {
  return String(day).padStart(2, "0")
}

const FULLY_GENERATED_DAY_COUNT = 7

/**
 * Deterministic (not Math.random) mobile/desktop generation pattern, keyed
 * off day-of-month. The first week (Aug 1-7) is fully generated so the list
 * opens on a realistic "already done" run; the remaining days cycle through
 * mobile-only / desktop-only / neither so the fixture still exercises every
 * (mobileGenerated, desktopGenerated) combination.
 */
function generationStateForDay(day: number): {
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

export function buildDevotionsAugustCollection(): VideoPipelineCollection {
  const cells: VideoPipelineCell[] = Array.from(
    { length: AUGUST_DAY_COUNT },
    (_, index) => {
      const day = index + 1
      const { mobileGenerated, desktopGenerated } = generationStateForDay(day)

      return {
        id: `devotion-2026-08-${padDay(day)}`,
        title: DEVOTIONAL_TITLES[index] ?? "Devotional",
        date: `2026-08-${padDay(day)}`,
        thumbnailUrl: DEVOTIONAL_THUMBNAIL_URL,
        mobileGenerated,
        desktopGenerated,
      }
    },
  )

  return {
    id: "devotions-august",
    title: "Devotions - August",
    label: "basic",
    labelDisplay: "Basic",
    cells,
  }
}

export function findCellById(
  collection: VideoPipelineCollection,
  cellId: string,
): VideoPipelineCell | null {
  return collection.cells.find((cell) => cell.id === cellId) ?? null
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
