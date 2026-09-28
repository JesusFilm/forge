/**
 * The language sheet marks the dub that plays offline (the file on disk), so
 * a viewer can tell which language a download holds before picking one.
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
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}))
// The sheet's list height listens to the formSheet detent via the navigator.
jest.mock("expo-router", () => ({
  useNavigation: () => ({ addListener: () => () => {} }),
}))
// FlashList virtualizes against a layout jest never measures, so render the
// header and every row inline instead.
jest.mock("@shopify/flash-list", () => {
  const r = require as unknown as NodeRequireLike
  const path = r("path") as NodePath
  const react = jest.requireActual(
    path.dirname(r.resolve("react/package.json")),
  ) as {
    Fragment: unknown
    createElement: (
      type: unknown,
      props: unknown,
      ...children: unknown[]
    ) => unknown
  }
  return {
    FlashList: (props: {
      data: unknown[]
      renderItem: (args: { item: unknown; index: number }) => unknown
      ListHeaderComponent?: unknown
      ListEmptyComponent?: unknown
    }) =>
      react.createElement(
        react.Fragment,
        null,
        props.ListHeaderComponent,
        props.data.length === 0
          ? props.ListEmptyComponent
          : props.data.map((item, index) =>
              react.createElement(
                react.Fragment,
                { key: index },
                props.renderItem({ item, index }),
              ),
            ),
      ),
  }
})

import { act } from "react"
import { Text } from "react-native"

import { DOWNLOADED_DUB_LABEL, LanguageSheetContent } from "../LanguageSheet"
import type { WatchVariant } from "../../../lib/normalizeVideo"
import {
  TestRenderer,
  unmount,
  type NodePath,
  type NodeRequireLike,
  type TestInstance,
} from "../../../test-utils/rnTestRenderer"

function variant(
  languageSlug: string,
  id: string,
  languageName: string,
): WatchVariant {
  return {
    documentId: id,
    slug: `the-arrow/${languageSlug}`,
    published: true,
    hls: `https://stream.mux.com/${id}.m3u8`,
    duration: 120,
    languageCoreId: null,
    languageBcp47: null,
    languageSlug,
    languageName,
    languageNameNative: null,
    languageIso3: null,
    muxPlaybackId: id,
  }
}

const THAI = variant("thai", "dubThai", "Thai")
const ENGLISH = variant("english", "dubEnglish", "English")

let mounted: TestInstance | null = null

async function render(props: {
  active: string
  downloaded: string | null
}): Promise<TestInstance> {
  await act(async () => {
    mounted = TestRenderer.create(
      <LanguageSheetContent
        variants={[THAI, ENGLISH]}
        activeVariantSlug={props.active}
        downloadedDubDocumentId={props.downloaded}
        onLanguageChange={() => {}}
        onClose={() => {}}
      />,
    )
  })
  return mounted!
}

afterEach(async () => {
  if (mounted != null) {
    await unmount(mounted)
    mounted = null
  }
})

/** Rendered "Downloaded" lines, counted on the composite Text only. */
function downloadedLines(renderer: TestInstance): number {
  return renderer.root.findAll(
    (node) =>
      node.type === Text && node.props.children === DOWNLOADED_DUB_LABEL,
  ).length
}

/**
 * Names of the accessibility ELEMENTS only: a label on a plain View never
 * reaches the native tree, so a node counts here only when it is a Pressable
 * with a role or a View marked `accessible`.
 */
function accessibleNames(renderer: TestInstance): string[] {
  return renderer.root
    .findAll(
      (node) =>
        typeof node.props.accessibilityLabel === "string" &&
        (node.props.accessible === true ||
          typeof node.props.accessibilityRole === "string"),
    )
    .map((node) => node.props.accessibilityLabel as string)
}

describe("LanguageSheetContent marks the downloaded dub", () => {
  it("shows Downloaded under the dub on disk, and under no other row", async () => {
    const renderer = await render({
      active: ENGLISH.slug,
      downloaded: "dubThai",
    })

    expect(downloadedLines(renderer)).toBe(1)
    expect(accessibleNames(renderer)).toContain(`Thai, ${DOWNLOADED_DUB_LABEL}`)
    expect(accessibleNames(renderer)).not.toContain(
      `English, ${DOWNLOADED_DUB_LABEL}`,
    )
  })

  it("marks the Current row when the active dub is the downloaded one", async () => {
    const renderer = await render({ active: THAI.slug, downloaded: "dubThai" })

    expect(downloadedLines(renderer)).toBe(1)
    expect(accessibleNames(renderer)).toContain(`Thai, ${DOWNLOADED_DUB_LABEL}`)
  })

  it("marks nothing when the video has no download", async () => {
    const renderer = await render({ active: ENGLISH.slug, downloaded: null })

    expect(downloadedLines(renderer)).toBe(0)
    expect(accessibleNames(renderer)).toContain("Thai")
  })
})
