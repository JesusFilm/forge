/**
 * The R17 offer on its own (KTD12): what it names, what each choice reports,
 * and when it asks to hide. The page suite (`keepWatchingIntent.test.tsx`)
 * pins the wiring: the seek, the hold, and the first-frame signal.
 */

import { act, type ReactElement } from "react"
import { AccessibilityInfo, StyleSheet } from "react-native"

import {
  KEEP_WATCHING_OFFER_COPY,
  KeepWatchingOffer,
  formatOfferPosition,
  offerResumeSeconds,
  type KeepWatchingOfferProps,
} from "../KeepWatchingOffer"
import { KEEP_WATCHING_OFFER_DURATION_MS } from "../../../lib/explore/watchIntent"
import {
  TestRenderer,
  hasText,
  press,
  pressableByLabel,
  type TestInstance,
} from "../../../test-utils/rnTestRenderer"

jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 34, left: 0, right: 0 }),
}))

const START = KEEP_WATCHING_OFFER_COPY.startFromBeginning
/** AE6: saved progress at 1:10:00. */
const SAVED = 4200
const RESUME = KEEP_WATCHING_OFFER_COPY.resumeAt("1:10:00")

let screenReaderOn = false
let screenReaderListener: ((enabled: boolean) => void) | null = null
let mounted: TestInstance | null = null

function props(over: Partial<KeepWatchingOfferProps> = {}) {
  return {
    resumeAtSeconds: SAVED,
    clockStarted: false,
    hidden: false,
    onChoose: jest.fn(),
    onExpire: jest.fn(),
    ...over,
  } satisfies KeepWatchingOfferProps
}

async function render(element: ReactElement): Promise<TestInstance> {
  await act(async () => {
    mounted = TestRenderer.create(element)
  })
  return mounted as TestInstance
}

async function advance(ms: number) {
  await act(async () => {
    jest.advanceTimersByTime(ms)
  })
}

function labels(renderer: TestInstance): string[] {
  return renderer.root
    .findAll(
      (node) =>
        typeof node.type === "string" &&
        node.props.accessibilityRole === "button",
    )
    .map((node) => node.props.accessibilityLabel as string)
}

beforeEach(() => {
  screenReaderOn = false
  screenReaderListener = null
  jest
    .spyOn(AccessibilityInfo, "isScreenReaderEnabled")
    .mockImplementation(() => Promise.resolve(screenReaderOn))
  jest.spyOn(AccessibilityInfo, "addEventListener").mockImplementation(((
    name: string,
    listener: (enabled: boolean) => void,
  ) => {
    if (name === "screenReaderChanged") screenReaderListener = listener
    return { remove: () => {} }
  }) as unknown as typeof AccessibilityInfo.addEventListener)
})

afterEach(async () => {
  if (mounted != null) {
    const renderer = mounted
    await act(async () => {
      renderer.unmount()
    })
    mounted = null
  }
  jest.useRealTimers()
  jest.restoreAllMocks()
})

describe("what the offer names (AE6)", () => {
  it("offers the beginning and the saved place, by name", async () => {
    const renderer = await render(<KeepWatchingOffer {...props()} />)

    expect(labels(renderer)).toEqual([START, RESUME])
    expect(hasText(renderer, "Start from the beginning")).toBe(true)
    expect(hasText(renderer, "Resume at 1:10:00")).toBe(true)
  })

  it("offers the beginning alone when no later place was saved", async () => {
    const renderer = await render(
      <KeepWatchingOffer {...props({ resumeAtSeconds: null })} />,
    )

    expect(labels(renderer)).toEqual([START])
  })

  it("keeps each button a 44pt target", async () => {
    const renderer = await render(<KeepWatchingOffer {...props()} />)

    for (const label of [START, RESUME]) {
      const button = pressableByLabel(renderer, label)
      const style = StyleSheet.flatten(
        typeof button.props.style === "function"
          ? (button.props.style as (s: { pressed: boolean }) => unknown)({
              pressed: false,
            })
          : button.props.style,
      ) as { minHeight?: number }
      expect(style.minHeight).toBeGreaterThanOrEqual(44)
    }
  })
})

describe("each choice reports its position", () => {
  it("Start from the beginning reports 0", async () => {
    const offer = props()
    const renderer = await render(<KeepWatchingOffer {...offer} />)

    await press(pressableByLabel(renderer, START))

    expect(offer.onChoose).toHaveBeenCalledTimes(1)
    expect(offer.onChoose).toHaveBeenCalledWith(0)
  })

  it("Resume at reports the saved place", async () => {
    const offer = props()
    const renderer = await render(<KeepWatchingOffer {...offer} />)

    await press(pressableByLabel(renderer, RESUME))

    expect(offer.onChoose).toHaveBeenCalledTimes(1)
    expect(offer.onChoose).toHaveBeenCalledWith(SAVED)
  })
})

describe("the auto-hide clock (KTD12)", () => {
  it("starts at the first frame, not at mount: a 4 s load keeps the full time", async () => {
    jest.useFakeTimers()
    const offer = props()
    const renderer = await render(<KeepWatchingOffer {...offer} />)

    await advance(4_000)
    expect(offer.onExpire).not.toHaveBeenCalled()

    await act(async () => {
      renderer.update(<KeepWatchingOffer {...offer} clockStarted />)
    })
    await advance(KEEP_WATCHING_OFFER_DURATION_MS - 1)
    expect(offer.onExpire).not.toHaveBeenCalled()

    await advance(1)
    expect(offer.onExpire).toHaveBeenCalledTimes(1)
  })

  it("keeps running through a pause after the first frame", async () => {
    jest.useFakeTimers()
    const offer = props({ clockStarted: true })
    const renderer = await render(<KeepWatchingOffer {...offer} />)

    await advance(2_000)
    await act(async () => {
      renderer.update(<KeepWatchingOffer {...offer} clockStarted={false} />)
    })
    await advance(KEEP_WATCHING_OFFER_DURATION_MS - 2_000)

    expect(offer.onExpire).toHaveBeenCalledTimes(1)
  })

  it("draws nothing while hidden, and its clock keeps running", async () => {
    jest.useFakeTimers()
    const offer = props({ clockStarted: true })
    const renderer = await render(<KeepWatchingOffer {...offer} />)

    await advance(2_000)
    await act(async () => {
      renderer.update(<KeepWatchingOffer {...offer} hidden />)
    })
    expect(labels(renderer)).toEqual([])
    await advance(KEEP_WATCHING_OFFER_DURATION_MS - 2_000)

    expect(offer.onExpire).toHaveBeenCalledTimes(1)
  })

  it("waits while a screen reader is on, and hides once it turns off", async () => {
    jest.useFakeTimers()
    screenReaderOn = true
    const offer = props({ clockStarted: true })
    await render(<KeepWatchingOffer {...offer} />)

    await advance(KEEP_WATCHING_OFFER_DURATION_MS * 50)
    expect(offer.onExpire).not.toHaveBeenCalled()

    await act(async () => {
      screenReaderListener?.(false)
    })
    expect(offer.onExpire).toHaveBeenCalledTimes(1)
  })

  it("waits for a screen reader that turns on while it shows", async () => {
    jest.useFakeTimers()
    const offer = props({ clockStarted: true })
    await render(<KeepWatchingOffer {...offer} />)

    await act(async () => {
      screenReaderListener?.(true)
    })
    await advance(KEEP_WATCHING_OFFER_DURATION_MS + 1_000)

    expect(offer.onExpire).not.toHaveBeenCalled()
  })
})

describe("offerResumeSeconds (R17)", () => {
  it("offers a saved place later than the tap point", () => {
    expect(offerResumeSeconds(4200, 740)).toBe(4200)
  })

  it("offers nothing at or before the tap point, or with nothing saved", () => {
    expect(offerResumeSeconds(700, 740)).toBeNull()
    expect(offerResumeSeconds(740, 740)).toBeNull()
    expect(offerResumeSeconds(null, 740)).toBeNull()
  })
})

describe("formatOfferPosition", () => {
  it("writes h:mm:ss from an hour, and m:ss below it", () => {
    expect(formatOfferPosition(4200)).toBe("1:10:00")
    expect(formatOfferPosition(3600)).toBe("1:00:00")
    expect(formatOfferPosition(740)).toBe("12:20")
    expect(formatOfferPosition(59.9)).toBe("0:59")
  })
})
