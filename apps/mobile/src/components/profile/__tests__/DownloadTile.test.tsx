// The tile shows the list row's state (R7) with no Retry or Resume control.
// `react` is re-pointed at the real package (apps/mobile CLAUDE.md,
// "Component render tests").
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
const mockIconRenders: string[] = []
jest.mock("@expo/vector-icons/Ionicons", () => ({
  __esModule: true,
  default: ({ name }: { name: string }) => {
    mockIconRenders.push(name)
    return null
  },
}))
jest.mock("expo-image", () => ({
  __esModule: true,
  Image: function MockImage() {
    return null
  },
}))
jest.mock("expo-linear-gradient", () => ({
  __esModule: true,
  LinearGradient: function MockLinearGradient() {
    return null
  },
}))
const mockGetLocales = jest.fn()
jest.mock("expo-localization", () => ({
  getLocales: () => mockGetLocales(),
}))
jest.mock("expo-localization/build/ExpoLocalization", () => ({
  addLocaleListener: () => ({ remove: () => undefined }),
}))
// A distinct text per key, so a swapped key fails. English cases never start
// the store, so they read the real English catalog.
jest.mock("../../../i18n/catalogs.generated", () =>
  jest
    .requireActual("../../../test-utils/uiLocaleFixture")
    .withFixtureCatalogs(
      jest.requireActual("../../../i18n/catalogs.generated"),
      {
        es: {
          MyWatch: {
            tileEpisodes:
              "{count, plural, one {# episodio} other {# episodios}}",
            tileDownloaded: "Descargado",
            tileDownloading: "Descargando",
            tileInProgress: "En curso",
            tilePaused: "En pausa",
            tileQueued: "En cola",
            tileFailed: "Con error",
            tileSeriesHint: "Abre esta serie en Descargas",
            tileVideoHint: "Abre este video",
          },
        },
      },
    ),
)
jest.mock("../../../i18n/pluralData.generated", () =>
  jest
    .requireActual("../../../test-utils/uiLocaleFixture")
    .withFixturePluralData(
      jest.requireActual("../../../i18n/pluralData.generated"),
      ["es"],
    ),
)
jest.mock("../../watch/DownloadProgressRing", () => ({
  DownloadProgressRing: function MockRing() {
    return null
  },
}))

import { act } from "react"
import {
  Dimensions,
  StyleSheet,
  type StyleProp,
  type TextStyle,
} from "react-native"
import { Image } from "expo-image"
import { LinearGradient } from "expo-linear-gradient"

import { DownloadTile } from "../DownloadTile"
import {
  refreshLocale,
  resetLocaleStoreForTests,
  startLocaleSync,
} from "../../../i18n/localeStore"
import { phoneLocales } from "../../../test-utils/uiLocaleFixture"
import { DownloadProgressRing } from "../../watch/DownloadProgressRing"
import { computeTypographyScale } from "../../../hooks/useTypography"
import { formatLibraryDuration } from "../../../lib/libraryDownloads"
import {
  buildMyWatchRail,
  type MyWatchRailTile,
} from "../../../lib/myWatchRail"
import { card } from "../../../styles/shared"
import {
  OFFLINE_MANIFEST_VERSION,
  type OfflineDownloadRecord,
  type OfflineDownloadState,
} from "../../../lib/offlineManifest"
import {
  TestRenderer,
  hasText,
  press,
  unmount,
  type NodePath,
  type NodeRequireLike,
  type RenderedNode,
  type TestInstance,
} from "../../../test-utils/rnTestRenderer"

const MB = 1024 * 1024

function record(
  videoSlug: string,
  state: OfflineDownloadState,
  overrides: Partial<OfflineDownloadRecord> = {},
): OfflineDownloadRecord {
  return {
    version: OFFLINE_MANIFEST_VERSION,
    videoSlug,
    dubDocumentId: "dub",
    renditionDocumentId: "rend",
    qualityLabel: "High",
    title: "The Birth of Jesus",
    subtitleLanguageSlug: null,
    state,
    committedPath: null,
    pendingPath: null,
    posterPath: null,
    bytesWritten: 0,
    totalBytes: 10 * MB,
    ...overrides,
  }
}

function episode(
  index: number,
  state: OfflineDownloadState,
  overrides: Partial<OfflineDownloadRecord> = {},
): OfflineDownloadRecord {
  return record(`birth-episode-${index}`, state, {
    title: `Episode ${index}`,
    seriesSlug: "birth-of-jesus",
    seriesTitle: "Birth of Jesus",
    seriesEpisodeIndex: index,
    enqueuedAt: index,
    ...overrides,
  })
}

/** The one tile the real selector builds from these records. */
function onlyTile(records: OfflineDownloadRecord[]): MyWatchRailTile {
  const tiles = buildMyWatchRail(records)
  expect(tiles).toHaveLength(1)
  return tiles[0]
}

async function renderTile(
  tile: MyWatchRailTile,
  onPress: (tile: MyWatchRailTile) => void = jest.fn(),
): Promise<TestInstance> {
  let renderer!: TestInstance
  await act(async () => {
    renderer = TestRenderer.create(
      <DownloadTile tile={tile} width={236} onPress={onPress} />,
    )
  })
  return renderer
}

/** Every labelled node that takes a press. The tile's own props have no label. */
function pressables(renderer: TestInstance): RenderedNode[] {
  return renderer.root.findAll(
    (node) =>
      typeof node.props.onPress === "function" &&
      typeof node.props.accessibilityLabel === "string",
  )
}

/** The one control's label; a second distinct label fails the case. */
function tileLabel(renderer: TestInstance): string {
  const labels = new Set(
    pressables(renderer).map((node) => String(node.props.accessibilityLabel)),
  )
  expect(labels.size).toBe(1)
  return [...labels][0]
}

function nodesOfType(renderer: TestInstance, type: unknown): RenderedNode[] {
  return renderer.root.findAll((node) => node.type === type)
}

beforeEach(() => {
  mockIconRenders.length = 0
})

describe("DownloadTile video states (R7, KTD4 state table)", () => {
  it("downloaded: shows the done check and says Downloaded", async () => {
    const renderer = await renderTile(
      onlyTile([record("birth", "downloaded", { bytesWritten: 10 * MB })]),
    )

    expect(tileLabel(renderer)).toBe("The Birth of Jesus, Downloaded")
    expect(hasText(renderer, "The Birth of Jesus")).toBe(true)
    expect(mockIconRenders).toContain("checkmark-circle")
    expect(nodesOfType(renderer, DownloadProgressRing).length).toBe(0)
    await unmount(renderer)
  })

  it("a mid-swap record reads as downloaded, the same as its list row", async () => {
    const renderer = await renderTile(
      onlyTile([
        record("birth", "downloading", {
          swapFrom: {
            committedPath: "/old.mp4",
            renditionDocumentId: "old",
            dubDocumentId: "dub",
            qualityLabel: "Low",
            subtitleLanguageSlug: null,
            totalBytes: 5 * MB,
            posterPath: null,
          },
        }),
      ]),
    )

    expect(tileLabel(renderer)).toBe("The Birth of Jesus, Downloaded")
    expect(nodesOfType(renderer, DownloadProgressRing).length).toBe(0)
    await unmount(renderer)
  })

  it("downloading: shows the progress ring at the record's fraction", async () => {
    const renderer = await renderTile(
      onlyTile([record("birth", "downloading", { bytesWritten: 3 * MB })]),
    )

    const rings = nodesOfType(renderer, DownloadProgressRing)
    expect(rings.length).toBe(1)
    expect(rings[0].props.progress).toBeCloseTo(0.3)
    expect(tileLabel(renderer)).toBe("The Birth of Jesus, Downloading, 30%")
    expect(mockIconRenders).not.toContain("checkmark-circle")
    await unmount(renderer)
  })

  it.each([
    ["queued", "Queued"],
    ["paused", "Paused"],
    ["failed", "Failed"],
  ] as const)(
    "%s: shows %s on the poster and in the label",
    async (state, text) => {
      const renderer = await renderTile(onlyTile([record("birth", state)]))

      expect(hasText(renderer, text)).toBe(true)
      expect(tileLabel(renderer)).toBe(`The Birth of Jesus, ${text}`)
      expect(nodesOfType(renderer, DownloadProgressRing).length).toBe(0)
      expect(mockIconRenders).not.toContain("checkmark-circle")
      await unmount(renderer)
    },
  )

  it.each(["paused", "failed"] as const)(
    "%s: offers no Retry or Resume control; the only control opens the tile",
    async (state) => {
      const renderer = await renderTile(onlyTile([record("birth", state)]))

      expect(tileLabel(renderer)).toMatch(
        /^The Birth of Jesus, (Paused|Failed)$/,
      )
      const labels = renderer.root
        .findAll((node) => typeof node.props.accessibilityLabel === "string")
        .map((node) => String(node.props.accessibilityLabel))
      expect(labels.length).toBeGreaterThan(0)
      for (const label of labels) {
        expect(label).not.toMatch(/^(Retry|Resume)\b/)
      }
      expect(mockIconRenders).not.toContain("refresh")
      expect(mockIconRenders).not.toContain("play")
      await unmount(renderer)
    },
  )

  it("falls back to the slug when a legacy record has no title", async () => {
    const renderer = await renderTile(
      onlyTile([record("the-birth-of-jesus", "downloaded", { title: "" })]),
    )

    expect(tileLabel(renderer)).toBe("The Birth Of Jesus, Downloaded")
    await unmount(renderer)
  })
})

describe("DownloadTile series states (R7)", () => {
  it("in progress: carries the episode count and the aggregate ring", async () => {
    const renderer = await renderTile(
      onlyTile([
        episode(1, "downloaded"),
        episode(2, "downloading", { bytesWritten: 5 * MB }),
        episode(3, "queued"),
      ]),
    )

    expect(tileLabel(renderer)).toBe(
      "Birth of Jesus, 3 episodes, In progress, 50%",
    )
    expect(hasText(renderer, "3 episodes")).toBe(true)
    const rings = nodesOfType(renderer, DownloadProgressRing)
    expect(rings.length).toBe(1)
    expect(rings[0].props.progress).toBeCloseTo(0.5)
    await unmount(renderer)
  })

  it("in progress: a series with only a paused episode is not Downloading", async () => {
    const renderer = await renderTile(
      onlyTile([
        episode(1, "downloaded"),
        episode(2, "paused", { bytesWritten: 5 * MB }),
      ]),
    )

    expect(tileLabel(renderer)).toMatch(
      /^Birth of Jesus, 2 episodes, In progress/,
    )
    expect(tileLabel(renderer)).not.toMatch(/Downloading/)
    expect(nodesOfType(renderer, DownloadProgressRing).length).toBe(1)
    await unmount(renderer)
  })

  it("failed wins over in progress", async () => {
    const renderer = await renderTile(
      onlyTile([
        episode(1, "failed"),
        episode(2, "downloading", { bytesWritten: 5 * MB }),
      ]),
    )

    expect(tileLabel(renderer)).toBe("Birth of Jesus, 2 episodes, Failed")
    expect(hasText(renderer, "Failed")).toBe(true)
    expect(nodesOfType(renderer, DownloadProgressRing).length).toBe(0)
    await unmount(renderer)
  })

  it("downloaded: every episode done shows the check", async () => {
    const renderer = await renderTile(
      onlyTile([episode(1, "downloaded"), episode(2, "downloaded")]),
    )

    expect(tileLabel(renderer)).toBe("Birth of Jesus, 2 episodes, Downloaded")
    expect(mockIconRenders).toContain("checkmark-circle")
    await unmount(renderer)
  })
})

describe("DownloadTile poster and press", () => {
  it("draws the poster with expo-image and a recycling key", async () => {
    const renderer = await renderTile(
      onlyTile([
        record("birth", "downloaded", { posterPath: "file:///poster.jpg" }),
      ]),
    )

    const images = nodesOfType(renderer, Image)
    expect(images.length).toBe(1)
    expect(images[0].props.source).toBe("file:///poster.jpg")
    expect(images[0].props.recyclingKey).toBe("video:birth")
    expect(nodesOfType(renderer, LinearGradient).length).toBe(0)
    await unmount(renderer)
  })

  it("falls back to a gradient when there is no poster", async () => {
    const renderer = await renderTile(onlyTile([record("birth", "queued")]))

    expect(nodesOfType(renderer, Image).length).toBe(0)
    expect(nodesOfType(renderer, LinearGradient).length).toBe(1)
    await unmount(renderer)
  })

  it("a series tile uses its first episode's poster", async () => {
    const renderer = await renderTile(
      onlyTile([
        episode(2, "downloaded", { posterPath: "file:///second.jpg" }),
        episode(1, "downloaded", { posterPath: "file:///first.jpg" }),
      ]),
    )

    const images = nodesOfType(renderer, Image)
    expect(images.length).toBe(1)
    expect(images[0].props.source).toBe("file:///first.jpg")
    await unmount(renderer)
  })

  it("a tap hands the tile to onPress", async () => {
    const onPress = jest.fn()
    const tile = onlyTile([record("birth", "failed")])
    const renderer = await renderTile(tile, onPress)

    await press(pressables(renderer)[0])

    expect(onPress).toHaveBeenCalledTimes(1)
    expect(onPress).toHaveBeenCalledWith(tile)
    await unmount(renderer)
  })
})

describe("DownloadTile type matches the Home cards", () => {
  function hostText(renderer: TestInstance, text: string): TextStyle {
    const [node] = renderer.root.findAll(
      (at) => at.type === "Text" && at.props.children === text,
    )
    expect(node).toBeDefined()
    return StyleSheet.flatten(node.props.style as StyleProp<TextStyle>) ?? {}
  }

  it("draws the title at the card-title weight and the duration in the shared badge style", async () => {
    const tile = onlyTile([
      record("birth", "downloaded", { durationSeconds: 478 }),
    ])
    const renderer = await renderTile(tile)
    const caption = computeTypographyScale(Dimensions.get("window").width)
      .caption.fontSize

    // HomeCard, MediaCollection, and Up Next all draw card titles at 700.
    expect(hostText(renderer, "The Birth of Jesus").fontWeight).toBe("700")
    const duration = hostText(renderer, formatLibraryDuration(478)!)
    expect(duration.fontWeight).toBe(card.badgeText.fontWeight)
    expect(duration.fontSize).toBe(caption)
    await unmount(renderer)
  })
})

describe("DownloadTile after a UI language change", () => {
  afterEach(() => resetLocaleStoreForTests())

  it("relabels a memoized tile whose props did not change", async () => {
    mockGetLocales.mockReturnValue(phoneLocales("en-US"))
    startLocaleSync()
    const tile = onlyTile([episode(1, "downloaded"), episode(2, "failed")])
    const renderer = await renderTile(tile)
    expect(tileLabel(renderer)).toBe("Birth of Jesus, 2 episodes, Failed")

    mockGetLocales.mockReturnValue(phoneLocales("es-ES"))
    await act(async () => {
      refreshLocale()
    })

    expect(tileLabel(renderer)).toBe("Birth of Jesus, 2 episodios, Con error")
    expect(hasText(renderer, "2 episodios")).toBe(true)
    expect(pressables(renderer)[0]!.props.accessibilityHint).toBe(
      "Abre esta serie en Descargas",
    )
    await unmount(renderer)
  })

  it.each([
    ["downloaded", "Descargado"],
    ["downloading", "Descargando, 0%"],
    ["paused", "En pausa"],
    ["queued", "En cola"],
    ["failed", "Con error"],
  ] as const)("names a %s video in the UI language", async (state, text) => {
    mockGetLocales.mockReturnValue(phoneLocales("es-ES"))
    startLocaleSync()
    const renderer = await renderTile(onlyTile([record("birth", state)]))

    expect(tileLabel(renderer)).toBe(`The Birth of Jesus, ${text}`)
    expect(pressables(renderer)[0]!.props.accessibilityHint).toBe(
      "Abre este video",
    )
    await unmount(renderer)
  })

  it("names an in-progress series in the UI language", async () => {
    mockGetLocales.mockReturnValue(phoneLocales("es-ES"))
    startLocaleSync()
    const renderer = await renderTile(
      onlyTile([
        episode(1, "downloaded"),
        episode(2, "downloading", { bytesWritten: 5 * MB }),
      ]),
    )

    expect(tileLabel(renderer)).toBe(
      "Birth of Jesus, 2 episodios, En curso, 75%",
    )
    await unmount(renderer)
  })
})
