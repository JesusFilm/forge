/**
 * U10: the report host outlives the route that started the export (R29), and
 * the confirmation names the folder the viewer picked, or Files when the uri
 * gave no readable name.
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
import { Platform, Text, View } from "react-native"

import {
  TAB_BAR_CLEARANCE_GAP,
  TAB_BAR_SCREEN_EXTENT_IOS,
} from "../../lib/tabBar"

import {
  EXPORT_REPORT_AUTO_DISMISS_MS,
  ExportReportHost,
  publishExportReport,
  resetExportReportsForTests,
} from "../ExportReportHost"
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

/** Every control a card exposes, whatever its label. */
function countButtons(renderer: TestInstance): number {
  return renderer.root.findAll(
    (node) =>
      typeof node.type === "string" &&
      node.props.accessibilityRole === "button",
  ).length
}

beforeEach(() => {
  resetExportReportsForTests()
  resetSeriesExportProgressForTests()
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
      folderName: "Download",
    })

    expect(hasText(renderer, "Birth of Jesus")).toBe(true)
    expect(hasText(renderer, "Saved to Download.")).toBe(true)
    await unmount(renderer)
  })

  it("names Files, not a folder, when the picked uri has no readable name", async () => {
    const renderer = await renderHost()
    await publish({
      runId: "run-1",
      target: "birth-of-jesus",
      outcome: "saved",
      folderName: null,
    })

    expect(hasText(renderer, "Saved to Files.")).toBe(true)
    expect(hasText(renderer, "null")).toBe(false)
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
      folderName: "Download",
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
      folderName: "Download",
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

describe("a gate denial is not a failure", () => {
  it("reports a blocked export differently from a failure", async () => {
    const blocked = await renderHost()
    await publish({
      runId: "run-1",
      target: "birth-of-jesus",
      outcome: "blocked",
      title: "Birth of Jesus",
    })
    expect(hasText(blocked, "did not start")).toBe(true)
    expect(hasText(blocked, "did not save")).toBe(false)
    await unmount(blocked)

    resetExportReportsForTests()
    const failure = await renderHost()
    await publish({
      runId: "run-2",
      target: "birth-of-jesus",
      outcome: "failed",
      title: "Birth of Jesus",
    })
    expect(hasText(failure, "did not save")).toBe(true)
    expect(hasText(failure, "did not start")).toBe(false)
    await unmount(failure)
  })

  it("offers a blocked export nothing but a dismissal", async () => {
    // The storage gate is the only gate left, and nothing in Settings clears
    // it, so the card carries no action beyond closing itself.
    const renderer = await renderHost()
    await publish({
      runId: "run-1",
      target: "birth-of-jesus",
      outcome: "blocked",
      title: "Birth of Jesus",
    })

    expect(countButtons(renderer)).toBe(1)
    expect(countLabelled(renderer, DISMISS_LABEL)).toBe(1)
    await unmount(renderer)
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
        folderName: "Download",
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
        folderName: "Download",
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
      folderName: "Download",
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

  it("notes a blocked episode beside the run counts, on one card", async () => {
    const renderer = await renderHost()
    await publish({
      runId: "series-run",
      target: "episode-0",
      outcome: "saved",
      title: "Washi Gospel",
      runSize: 3,
      folderName: "Download",
    })
    await publish({
      runId: "series-run",
      target: "episode-1",
      outcome: "blocked",
      title: "Washi Gospel",
      runSize: 3,
    })

    expect(countLabelled(renderer, DISMISS_LABEL)).toBe(1)
    expect(countButtons(renderer)).toBe(1)
    expect(hasText(renderer, "Saved 1 of 3 episodes.")).toBe(true)
    expect(hasText(renderer, "1 did not start.")).toBe(true)
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
        folderName: "Download",
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

  it("auto-dismisses a failure too; no card waits for the viewer now", async () => {
    // A folder grant cannot be refused for good, so the one card that used
    // to hold open until the viewer acted went with it.
    jest.useFakeTimers()
    try {
      const renderer = await renderHost()
      await publish({
        runId: "run-1",
        target: "birth-of-jesus",
        outcome: "failed",
        title: "Birth of Jesus",
      })
      expect(hasText(renderer, "did not save")).toBe(true)

      await act(async () => {
        jest.advanceTimersByTime(EXPORT_REPORT_AUTO_DISMISS_MS + 100)
      })

      expect(hasText(renderer, "did not save")).toBe(false)
      expect(countButtons(renderer)).toBe(0)
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
  folderName: "Download",
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

  it("clears the bar from the SCREEN bottom, not from the inset", async () => {
    mockSegments = ["(tabs)", "index"]
    const renderer = await renderHost()
    await publish(SAVED)
    const bottom = hostStyle(renderer).bottom as number

    expect(bottom).toBe(TAB_BAR_SCREEN_EXTENT_IOS + TAB_BAR_CLEARANCE_GAP + 16)
    // Discriminates the post-merge formula, which counted the inset twice and
    // omitted the bar. It canNOT discriminate the inset-derived first fix:
    // at THIS inset the two agree exactly, because 83 is 34 + 49. Only the
    // 0-inset case below separates them, which is why it exists.
    expect(bottom).not.toBe(34 + 16 + (34 + TAB_BAR_CLEARANCE_GAP))
    await unmount(renderer)
  })

  it("clears the SAME bar on a device with no home indicator", async () => {
    // Measured on the iPhone SE 3rd generation: root inset 0, and the bar's top
    // edge still 83pt above the screen bottom, because the pill is anchored to
    // the screen rather than stacked on the safe area. Anything derived from
    // the inset under-lifts here — the post-merge formula gave 28 (21pt INSIDE
    // the bar) and its first fix gave 77 (6pt inside).
    mockInsets.bottom = 0
    mockSegments = ["(tabs)", "index"]
    const renderer = await renderHost()
    await publish(SAVED)
    const bottom = hostStyle(renderer).bottom as number

    expect(bottom).toBeGreaterThan(TAB_BAR_SCREEN_EXTENT_IOS)
    expect(bottom).toBe(TAB_BAR_SCREEN_EXTENT_IOS + TAB_BAR_CLEARANCE_GAP + 16)
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
