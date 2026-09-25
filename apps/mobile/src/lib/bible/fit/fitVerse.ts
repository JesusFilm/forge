// The verse fit (feat-551 R20, KTD16, KD20). A verse keeps the chosen size
// when it fits the verse area. Otherwise its size steps down by 2 points to
// the floor, and only a verse still too tall at the floor scrolls.

export const FIT_STEP_POINTS = 2
export const FIT_FLOOR_RATIO = 0.7
export const FIT_FLOOR_MIN_POINTS = 18
/** The fit applies the OS font scale itself, so it caps the scale too. */
export const MAX_OS_FONT_SCALE = 2

export type VerseFit = {
  size: number
  /** True only when the verse is still too tall at the floor. */
  scroll: boolean
}

export type FitInput = {
  /** The viewer's text size in points (READER_TEXT_SIZE_STEPS). */
  chosenSize: number
  /** The OS text scale; 1 is the default. */
  osFontScale: number
  areaHeight: number
}

// Whole points, because a fractional size blurs on Android.
export function fitStartSize(chosenSize: number, osFontScale: number): number {
  return Math.round(chosenSize * Math.min(osFontScale, MAX_OS_FONT_SCALE))
}

/** 70% of the chosen size, never under 18, rounded up to whole points. */
export function fitFloor(chosenSize: number): number {
  const floor = Math.max(FIT_FLOOR_RATIO * chosenSize, FIT_FLOOR_MIN_POINTS)
  // The tolerance keeps 0.7 * 30 (21.000000000000004) at 21.
  return Math.ceil(floor - 1e-9)
}

/** Every size the fit can try, largest first. The last one is the floor. */
export function fitCandidates(
  chosenSize: number,
  osFontScale: number,
): number[] {
  const start = fitStartSize(chosenSize, osFontScale)
  const floor = fitFloor(chosenSize)
  if (start <= floor) return [start]
  const sizes: number[] = []
  for (let size = start; size > floor; size -= FIT_STEP_POINTS) {
    sizes.push(size)
  }
  sizes.push(floor)
  return sizes
}

/** The KTD16 sketch, with a synchronous measure of the text height. */
export function fitVerse(
  input: FitInput & { measure: (size: number) => number },
): VerseFit {
  const candidates = fitCandidates(input.chosenSize, input.osFontScale)
  for (const size of candidates) {
    if (input.measure(size) <= input.areaHeight) return { size, scroll: false }
  }
  const floor = candidates[candidates.length - 1] ?? input.chosenSize
  return { size: floor, scroll: true }
}

export type FitPlan =
  | { status: "done"; fit: VerseFit }
  /** Measure these sizes, then plan again with their heights. */
  | { status: "measure"; sizes: number[] }

// The fit for a screen that measures text by layout: the start size alone
// (most verses fit there), then every smaller size in one batch. So a verse
// needs at most two layout passes.
export function planFit(
  input: FitInput & { heights: ReadonlyMap<number, number> },
): FitPlan {
  const { heights } = input
  const candidates = fitCandidates(input.chosenSize, input.osFontScale)
  const start = candidates[0] ?? input.chosenSize
  const startHeight = heights.get(start)
  if (startHeight === undefined) return { status: "measure", sizes: [start] }
  if (startHeight > input.areaHeight) {
    const missing = candidates.filter((size) => !heights.has(size))
    if (missing.length > 0) return { status: "measure", sizes: missing }
  }
  return {
    status: "done",
    fit: fitVerse({ ...input, measure: (size) => heights.get(size) ?? 0 }),
  }
}
