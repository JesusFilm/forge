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
        title: "Devotional",
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
