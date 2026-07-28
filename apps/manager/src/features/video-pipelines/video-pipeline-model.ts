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

function padDay(day: number): string {
  return String(day).padStart(2, "0")
}

/**
 * Deterministic (not Math.random) mobile/desktop generation pattern, keyed
 * off day-of-month so the fixture always exercises all four
 * (mobileGenerated, desktopGenerated) combinations across the 31 cells.
 */
function generationStateForDay(day: number): {
  mobileGenerated: boolean
  desktopGenerated: boolean
} {
  switch (day % 4) {
    case 1:
      return { mobileGenerated: true, desktopGenerated: true }
    case 2:
      return { mobileGenerated: true, desktopGenerated: false }
    case 3:
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
        title: `Devotional — Aug ${day}`,
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
