/**
 * U10: the report host outlives the route that started the export (R29), and a
 * refusal the operating system will not prompt for again offers a route to the
 * system settings (R25).
 *
 * apps/mobile's tsconfig maps `react` to its .d.ts and jest-expo mirrors
 * tsconfig paths into jest's moduleNameMapper, so the mocks below re-point
 * `react` at the real package. The renderer is jest-expo's own transitive
 * react-test-renderer (no new test dependencies).
 */

jest.mock("react", () => {
  const r = require as unknown as NodeRequireLike
  const path = r("path") as NodePath
  return jest.requireActual(path.dirname(r.resolve("react/package.json")))
})
jest.mock("react/jsx-runtime", () => {
  const r = require as unknown as NodeRequireLike
  const path = r("path") as NodePath
  return jest.requireActual(
    path.join(path.dirname(r.resolve("react/package.json")), "jsx-runtime.js"),
  )
})
// Ionicons requires native font modules at import time under jest.
jest.mock("@expo/vector-icons/Ionicons", () => ({
  __esModule: true,
  default: () => null,
}))
// A REAL inset, not 0. At bottom 0 the pre-fix formula and the correct one
// agree, so a zeroed mock cannot see a geometry defect at all. The `mock`
// prefix is required: babel-plugin-jest-hoist lifts jest.mock above this
// declaration and rejects any other out-of-scope name in the factory.
const mockInsets = { top: 59, bottom: 34, left: 0, right: 0 }
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => mockInsets,
}))
// expo-router ships untranspiled for this suite, and the host reads the route
// to decide whether a floating tab bar is in the way.
let mockSegments: string[] = ["watch", "[slug]"]
jest.mock("expo-router", () => ({
  useSegments: () => mockSegments,
}))

import { act } from "react"
import { Linking, Platform, Text, View } from "react-native"

import { TAB_BAR_CLEARANCE_GAP, TAB_BAR_HEIGHT_IOS } from "../../lib/tabBar"

import {
  EXPORT_REPORT_AUTO_DISMISS_MS,
  ExportReportHost,
  publishExportReport,
  resetExportReportsForTests,
} from "../ExportReportHost"
import { RAW_EXPORT_ALBUM_NAME } from "../../lib/rawExportConstants"
import {
  publishSeriesExportProgress,
  resetSeriesExportProgressForTests,
} from "../../lib/seriesExportProgress"
import {
  TestRenderer,
  hasText,
  press,
  pressableByLabel,
  unmount,
  type NodePath,
  type NodeRequireLike,
  type TestInstance,
} from "../../test-utils/rnTestRenderer"

const SETTINGS_LABEL = "Open settings"
const DISMISS_LABEL = "Dismiss export report"

function StubRoute() {
  return <Text>the originating route</Text>
}

/** The root tree: a route beside the host, exactly as `app/_layout.tsx` mounts it. */
function tree(routeMounted: boolean) {
  return routeMounted ? (
    <View>
      <StubRoute />
      <ExportReportHost />
    </View>
  ) : (
    <View>
      <ExportReportHost />
    </View>
  )
}

async function renderHost(routeMounted = false): Promise<TestInstance> {
  let renderer!: TestInstance
  await act(async () => {
    renderer = TestRenderer.create(tree(routeMounted))
  })
  return renderer
}

async function update(renderer: TestInstance, routeMounted: boolean) {
  await act(async () => {
    renderer.update(tree(routeMounted))
  })
}

type Signal = Parameters<typeof publishExportReport>[0]

async function publish(signal: Signal) {
  await act(async () => {
    publishExportReport(signal)
  })
}

/** Host nodes only: a composite and its host node carry the same props. */
function countLabelled(renderer: TestInstance, label: string): number {
  return renderer.root.findAll(
    (node) =>
      typeof node.type === "string" && node.props.accessibilityLabel === label,
  ).length
}

let openSettings: jest.SpyInstance

beforeEach(() => {
  resetExportReportsForTests()
  resetSeriesExportProgressForTests()
  openSettings = jest
    .spyOn(Linking, "openSettings")
    .mockImplementation(async () => undefined)
})

afterEach(() => {
  openSettings.mockRestore()
})

describe("reporting past the originating route", () => {
  it("renders a report after the originating route has unmounted", async () => {
    const renderer = await renderHost(true)
    expect(hasText(renderer, "the originating route")).toBe(true)

    await update(renderer, false)
    expect(hasText(renderer, "the originating route")).toBe(false)

    await publish({
      runId: "run-1",
      target: "birth-of-jesus",
      outcome: "saved",
      title: "Birth of Jesus",
      albumIntent: "album",
    })

    expect(hasText(renderer, "Birth of Jesus")).toBe(true)
    expect(hasText(renderer, RAW_EXPORT_ALBUM_NAME)).toBe(true)
    await unmount(renderer)
  })

  it("names the library, not an album, when the grant could not make one", async () => {
    const renderer = await renderHost()
    await publish({
      runId: "run-1",
      target: "birth-of-jesus",
      outcome: "saved",
      albumIntent: "library",
    })

    expect(hasText(renderer, "photo library")).toBe(true)
    expect(hasText(renderer, RAW_EXPORT_ALBUM_NAME)).toBe(false)
    await unmount(renderer)
  })

  it("renders an outcome published before the host mounted", async () => {
    await publish({
      runId: "sweep-1",
      target: "birth-of-jesus",
      outcome: "abandoned",
      title: "Birth of Jesus",
    })

    const renderer = await renderHost()
    expect(hasText(renderer, "Birth of Jesus")).toBe(true)
    expect(hasText(renderer, "did not finish")).toBe(true)
    await unmount(renderer)
  })

  it("renders two outcomes in sequence", async () => {
    const renderer = await renderHost()
    await publish({
      runId: "run-1",
      target: "birth-of-jesus",
      outcome: "saved",
      title: "Birth of Jesus",
      albumIntent: "album",
    })
    await publish({
      runId: "run-2",
      target: "the-story-of-jesus",
      outcome: "failed",
      title: "The Story of Jesus",
    })

    expect(hasText(renderer, "Birth of Jesus")).toBe(true)
    expect(hasText(renderer, "The Story of Jesus")).toBe(true)
    expect(countLabelled(renderer, DISMISS_LABEL)).toBe(2)
    await unmount(renderer)
  })

  it("removes only the dismissed report", async () => {
    const renderer = await renderHost()
    await publish({
      runId: "run-1",
      target: "birth-of-jesus",
      outcome: "saved",
      title: "Birth of Jesus",
      albumIntent: "album",
    })
    await publish({
      runId: "run-2",
      target: "the-story-of-jesus",
      outcome: "failed",
      title: "The Story of Jesus",
    })

    await press(pressableByLabel(renderer, DISMISS_LABEL))

    expect(countLabelled(renderer, DISMISS_LABEL)).toBe(1)
    expect(hasText(renderer, "The Story of Jesus")).toBe(true)
    await unmount(renderer)
  })
})

describe("a refusal is not a failure", () => {
  it("reports a refusal differently from a failure", async () => {
    const refusal = await renderHost()
    await publish({
      runId: "run-1",
      target: "birth-of-jesus",
      outcome: "refused",
      title: "Birth of Jesus",
      canAskAgain: true,
    })
    expect(hasText(refusal, "Permission is needed")).toBe(true)
    expect(hasText(refusal, "did not save")).toBe(false)
    await unmount(refusal)

    resetExportReportsForTests()
    const failure = await renderHost()
    await publish({
      runId: "run-2",
      target: "birth-of-jesus",
      outcome: "failed",
      title: "Birth of Jesus",
    })
    expect(hasText(failure, "did not save")).toBe(true)
    expect(hasText(failure, "Permission is needed")).toBe(false)
    await unmount(failure)
  })

  it("covers AE10: a permanent refusal offers system settings", async () => {
    const renderer = await renderHost()
    await publish({
      runId: "run-1",
      target: "birth-of-jesus",
      outcome: "refused",
      title: "Birth of Jesus",
      canAskAgain: false,
    })

    await press(pressableByLabel(renderer, SETTINGS_LABEL))
    expect(openSettings).toHaveBeenCalledTimes(1)
    await unmount(renderer)
  })

  it("covers AE10: a first refusal offers no settings action", async () => {
    const renderer = await renderHost()
    await publish({
      runId: "run-1",
      target: "birth-of-jesus",
      outcome: "refused",
      title: "Birth of Jesus",
      canAskAgain: true,
    })

    expect(countLabelled(renderer, SETTINGS_LABEL)).toBe(0)
    expect(countLabelled(renderer, DISMISS_LABEL)).toBe(1)
    await unmount(renderer)
  })

  it("words a permanent refusal differently from a first refusal", async () => {
    const permanent = await renderHost()
    await publish({
      runId: "run-1",
      target: "birth-of-jesus",
      outcome: "refused",
      canAskAgain: false,
    })
    const permanentText = JSON.stringify(permanent.toJSON())
    await unmount(permanent)

    resetExportReportsForTests()
    const first = await renderHost()
    await publish({
      runId: "run-2",
      target: "birth-of-jesus",
      outcome: "refused",
      canAskAgain: true,
    })
    const firstText = JSON.stringify(first.toJSON())
    await unmount(first)

    expect(permanentText).not.toEqual(firstText)
  })

  it("does not report a cancellation as a failure", async () => {
    const renderer = await renderHost()
    await publish({
      runId: "run-1",
      target: "birth-of-jesus",
      outcome: "cancelled",
      title: "Birth of Jesus",
    })

    expect(hasText(renderer, "cancelled")).toBe(true)
    expect(hasText(renderer, "did not save")).toBe(false)
    await unmount(renderer)
  })
})

describe("a series run reports once", () => {
  it("renders one report carrying the run counts, not twelve", async () => {
    const renderer = await renderHost()
    for (let episode = 0; episode < 12; episode += 1) {
      await publish({
        runId: "series-run",
        target: `episode-${episode}`,
        outcome: episode < 10 ? "saved" : "failed",
        title: "Washi Gospel",
        runSize: 12,
        albumIntent: "album",
      })
    }

    expect(countLabelled(renderer, DISMISS_LABEL)).toBe(1)
    expect(hasText(renderer, "Saved 10 of 12 episodes.")).toBe(true)
    expect(hasText(renderer, "2 did not save.")).toBe(true)
    await unmount(renderer)
  })

  it("counts a re-published episode once", async () => {
    const renderer = await renderHost()
    for (const outcome of ["failed", "saved", "saved"] as const) {
      await publish({
        runId: "series-run",
        target: "episode-0",
        outcome,
        title: "Washi Gospel",
        runSize: 3,
        albumIntent: "album",
      })
    }

    // R21: saved plus failed equals the resolved set, so a repeat cannot
    // report more episodes than the run covers.
    expect(hasText(renderer, "Saved 1 of 3 episodes.")).toBe(true)
    expect(hasText(renderer, "did not save")).toBe(false)
    await unmount(renderer)
  })

  it("keeps a cancelled run's counts", async () => {
    const renderer = await renderHost()
    await publish({
      runId: "series-run",
      target: "episode-0",
      outcome: "saved",
      title: "Washi Gospel",
      runSize: 5,
      albumIntent: "album",
    })
    await publish({
      runId: "series-run",
      target: "episode-1",
      outcome: "cancelled",
      title: "Washi Gospel",
      runSize: 5,
    })

    expect(countLabelled(renderer, DISMISS_LABEL)).toBe(1)
    expect(hasText(renderer, "Saved 1 of 5 episodes.")).toBe(true)
    expect(hasText(renderer, "Export cancelled.")).toBe(true)
    await unmount(renderer)
  })

  it("offers settings once for a run a permanent refusal stopped", async () => {
    const renderer = await renderHost()
    await publish({
      runId: "series-run",
      target: "episode-0",
      outcome: "saved",
      title: "Washi Gospel",
      runSize: 3,
      albumIntent: "album",
    })
    await publish({
      runId: "series-run",
      target: "episode-1",
      outcome: "refused",
      title: "Washi Gospel",
      runSize: 3,
      canAskAgain: false,
    })

    expect(countLabelled(renderer, SETTINGS_LABEL)).toBe(1)
    expect(hasText(renderer, "Saved 1 of 3 episodes.")).toBe(true)
    await unmount(renderer)
  })
})

describe("the report clears itself", () => {
  it("auto-dismisses a report that needs no viewer action", async () => {
    jest.useFakeTimers()
    try {
      const renderer = await renderHost()
      await publish({
        runId: "run-1",
        target: "birth-of-jesus",
        outcome: "saved",
        title: "Birth of Jesus",
        albumIntent: "album",
      })
      expect(hasText(renderer, "Birth of Jesus")).toBe(true)

      await act(async () => {
        jest.advanceTimersByTime(EXPORT_REPORT_AUTO_DISMISS_MS + 100)
      })

      expect(hasText(renderer, "Birth of Jesus")).toBe(false)
      await unmount(renderer)
    } finally {
      jest.useRealTimers()
    }
  })

  /**
   * A run's card is a PROGRESS card. Measured on the iPhone 17 simulator over a
   * real transfer, two episodes were 4.5 MINUTES apart — so any fixed window
   * short enough to clear a dead run's card is far too short to survive one
   * live gap. The card lived 6s, the run's next episode folded into a FRESH
   * record, and the toast read "Saved 1 of 5" for the whole run.
   */
  it("keeps a live run's card through a gap far longer than the dismissal", async () => {
    jest.useFakeTimers()
    try {
      const renderer = await renderHost()
      publishSeriesExportProgress("washi-gospel", {
        runId: "run-1",
        saved: 1,
        total: 5,
      })
      await publish({
        runId: "run-1",
        target: "can-god-be-known",
        outcome: "saved",
        title: "Can God be Known?",
        runSize: 5,
      })
      expect(hasText(renderer, "Saved 1 of 5 episodes.")).toBe(true)

      await act(async () => {
        jest.advanceTimersByTime(5 * 60_000)
      })
      expect(hasText(renderer, "Saved 1 of 5 episodes.")).toBe(true)

      // The next episode therefore folds into the SAME record and the count
      // climbs, which is the whole point.
      await publish({
        runId: "run-1",
        target: "what-are-humans",
        outcome: "saved",
        title: "What are Humans?",
        runSize: 5,
      })
      expect(hasText(renderer, "Saved 2 of 5 episodes.")).toBe(true)

      await unmount(renderer)
    } finally {
      publishSeriesExportProgress("washi-gospel", null)
      jest.useRealTimers()
    }
  })

  it("clears the card once the run that held it open ends", async () => {
    // The discriminating companion: same gap, same card, no live run. Without
    // it the test above would pass on a card that simply never expires.
    jest.useFakeTimers()
    try {
      const renderer = await renderHost()
      await publish({
        runId: "run-1",
        target: "can-god-be-known",
        outcome: "saved",
        title: "Can God be Known?",
        runSize: 5,
      })
      expect(hasText(renderer, "Saved 1 of 5 episodes.")).toBe(true)

      await act(async () => {
        jest.advanceTimersByTime(5 * 60_000)
      })

      expect(hasText(renderer, "Saved 1 of 5 episodes.")).toBe(false)
      await unmount(renderer)
    } finally {
      jest.useRealTimers()
    }
  })

  it("keeps a permanent refusal until the viewer acts on it", async () => {
    jest.useFakeTimers()
    try {
      const renderer = await renderHost()
      await publish({
        runId: "run-1",
        target: "birth-of-jesus",
        outcome: "refused",
        title: "Birth of Jesus",
        canAskAgain: false,
      })

      await act(async () => {
        jest.advanceTimersByTime(EXPORT_REPORT_AUTO_DISMISS_MS * 4)
      })

      expect(countLabelled(renderer, SETTINGS_LABEL)).toBe(1)
      await unmount(renderer)
    } finally {
      jest.useRealTimers()
    }
  })

  it("survives a listener-free publish", async () => {
    expect(() =>
      publishExportReport({
        runId: "run-1",
        target: "birth-of-jesus",
        outcome: "failed",
      }),
    ).not.toThrow()
  })
})

describe("the root layout mounts the host", () => {
  const nodeRequire = require as unknown as NodeRequireLike
  const fs = nodeRequire("fs") as {
    readFileSync: (file: string, encoding: string) => string
  }
  const nodePath = nodeRequire("path") as NodePath & {
    resolve: (...parts: string[]) => string
  }

  function layoutSource(): string {
    return fs.readFileSync(
      nodePath.resolve(__dirname, "../../../app/_layout.tsx"),
      "utf8",
    )
  }

  it("requires the host inside the guarded try block, never as an import", () => {
    const source = layoutSource()
    const required = source.indexOf(
      'require("../src/components/ExportReportHost")',
    )
    // A static import here crashes the whole module graph into a white screen,
    // which is why every root dependency arrives through the guarded require.
    expect(required).toBeGreaterThan(source.indexOf("try {"))
    expect(required).toBeLessThan(source.indexOf("} catch (e: unknown) {"))
    expect(source).not.toContain('from "../src/components/ExportReportHost"')
  })

  it("renders the host beside the playback host, under DownloadsProvider", () => {
    const source = layoutSource()
    const playbackHost = source.indexOf("<PlaybackHost />")
    const reportHost = source.indexOf("<ExportReportHost />")
    const providerClose = source.indexOf("</DownloadsProvider>")

    expect(playbackHost).toBeGreaterThan(-1)
    expect(reportHost).toBeGreaterThan(playbackHost)
    expect(reportHost).toBeLessThan(providerClose)
  })
})

declare const __dirname: string

/**
 * The toast sits where every other toast in this app sits — bottom, on
 * `ui/Snackbar`'s geometry. It used to be anchored at the top.
 */
const SAVED = {
  runId: "run-place",
  target: "birth-of-jesus",
  outcome: "saved",
  title: "Birth of Jesus",
  albumIntent: "album",
} as const

describe("placement", () => {
  /** The host's own absolutely-positioned wrapper. */
  function hostStyle(renderer: TestInstance): Record<string, unknown> {
    const node = renderer.root.findAll(
      (n) => n.props.pointerEvents === "box-none" && n.props.style != null,
    )[0]
    return Object.assign({}, ...[node.props.style].flat(2).filter(Boolean))
  }

  const platformOsDescriptor = Object.getOwnPropertyDescriptor(Platform, "OS")!
  function setPlatform(os: "ios" | "android") {
    Object.defineProperty(Platform, "OS", { value: os, configurable: true })
  }

  afterEach(() => {
    mockSegments = ["watch", "[slug]"]
    Object.defineProperty(Platform, "OS", platformOsDescriptor)
    mockInsets.bottom = 34
  })

  it("anchors to the bottom, never the top", async () => {
    const renderer = await renderHost()
    await publish(SAVED)
    const style = hostStyle(renderer)

    expect(style.top).toBeUndefined()
    // Off a tab route: the safe area plus Snackbar's own 16pt margin.
    expect(style.bottom).toBe(34 + 16)
    await unmount(renderer)
  })

  it("lifts clear of the floating tab bar on a tab route only", async () => {
    const offTab = await renderHost()
    await publish(SAVED)
    const offTabBottom = hostStyle(offTab).bottom as number
    await unmount(offTab)

    mockSegments = ["(tabs)", "index"]
    const onTab = await renderHost()
    await publish(SAVED)
    const onTabBottom = hostStyle(onTab).bottom as number
    await unmount(onTab)

    // Anti-vacuous: the off-tab value is the bare margin, so a clearance that
    // silently returned 0 would collapse these two and fail here.
    expect(offTabBottom).toBe(34 + 16)
    expect(onTabBottom).toBeGreaterThan(offTabBottom)
  })

  it("adds the bar itself, because the ROOT inset does not carry it", async () => {
    // Measured on the iPhone 17 simulator: this host reads insets.bottom 34 on
    // a tab route, where a tab SCREEN reads 83 (34 indicator + 49 bar). The bar
    // is therefore ours to add, and the inset must be counted once.
    mockSegments = ["(tabs)", "index"]
    const renderer = await renderHost()
    await publish(SAVED)
    const bottom = hostStyle(renderer).bottom as number

    expect(bottom).toBe(34 + TAB_BAR_CLEARANCE_GAP + TAB_BAR_HEIGHT_IOS + 16)
    // Discriminating: the pre-fix formula counted the inset TWICE and omitted
    // the bar. Both values clear 16, so `toBeGreaterThan` above cannot see it.
    expect(bottom).not.toBe(34 + 16 + (34 + TAB_BAR_CLEARANCE_GAP))
    await unmount(renderer)
  })

  it("clears the bar on a device with no home indicator", async () => {
    // The failing class this fix closes: at inset 0 the card sat 21pt INSIDE
    // the bar and swallowed taps on Home and Discover for the toast's life.
    mockInsets.bottom = 0
    mockSegments = ["(tabs)", "index"]
    const renderer = await renderHost()
    await publish(SAVED)

    expect(hostStyle(renderer).bottom as number).toBeGreaterThan(
      TAB_BAR_HEIGHT_IOS,
    )
    await unmount(renderer)
  })

  it("keeps the plain inset on Android, where the bar displaces content", async () => {
    setPlatform("android")
    mockSegments = ["(tabs)", "index"]
    const renderer = await renderHost()
    await publish(SAVED)

    expect(hostStyle(renderer).bottom).toBe(34 + 16)
    await unmount(renderer)
  })
})
