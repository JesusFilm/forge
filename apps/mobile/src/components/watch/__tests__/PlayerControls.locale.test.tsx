/** The player chrome after a UI language change (KTD15). Labels translate, but
 *  a tap keeps one RUM name and an accessibility action keeps its raw name. */

/* eslint-disable @typescript-eslint/no-require-imports */

jest.mock("@expo/vector-icons/Ionicons", () => ({
  __esModule: true,
  default: () => null,
}))
jest.mock("@expo/vector-icons/MaterialIcons", () => ({
  __esModule: true,
  default: () => null,
}))
jest.mock("expo-blur", () => {
  const { View } = require("react-native")
  return { BlurView: View }
})
jest.mock("expo", () => ({
  useEvent: (_player: unknown, _name: string, initial: unknown) => initial,
}))
jest.mock("expo-video", () => {
  const { View } = require("react-native")
  return { VideoAirPlayButton: View }
})
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}))
jest.mock("../../../lib/datadog", () => ({
  datadogLog: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}))
const mockGetLocales = jest.fn()
jest.mock("expo-localization", () => ({
  getLocales: () => mockGetLocales(),
}))
jest.mock("expo-localization/build/ExpoLocalization", () => ({
  addLocaleListener: () => ({ remove: () => undefined }),
}))
jest.mock("../../../i18n/catalogs.generated", () =>
  jest
    .requireActual("../../../test-utils/uiLocaleFixture")
    .withFixtureCatalogs(
      jest.requireActual("../../../i18n/catalogs.generated"),
      {
        ru: {
          Player: {
            playAriaLabel: "Воспроизвести",
            seekBarAriaLabel: "Полоса перемотки",
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
      ["ru"],
    ),
)

import { act } from "react"

import {
  refreshLocale,
  resetLocaleStoreForTests,
  startLocaleSync,
} from "../../../i18n/localeStore"
import { PlayerControls } from "../PlayerControls"
import {
  TestRenderer,
  press,
  unmount,
  type RenderedNode,
  type TestInstance,
} from "../../../test-utils/rnTestRenderer"
import {
  phoneLocales,
  tapActionName,
} from "../../../test-utils/uiLocaleFixture"

// A player stopped at 0:00 of a two-minute video.
function makePlayer() {
  return {
    playing: false,
    muted: false,
    currentTime: 0,
    duration: 120,
    play: jest.fn(),
    pause: jest.fn(),
    addListener: () => ({ remove: () => {} }),
  }
}

async function render(
  player: ReturnType<typeof makePlayer>,
): Promise<TestInstance> {
  let renderer!: TestInstance
  await act(async () => {
    renderer = TestRenderer.create(
      <PlayerControls player={player as never} onFullscreen={() => {}} />,
    )
  })
  return renderer
}

async function changePhoneLanguage(tag: string) {
  mockGetLocales.mockReturnValue(phoneLocales(tag))
  await act(async () => {
    refreshLocale()
  })
}

function byLabel(renderer: TestInstance, label: string): RenderedNode {
  const [node] = renderer.root.findAll(
    (n) =>
      typeof n.type !== "string" &&
      n.props.accessibilityRole === "button" &&
      n.props.accessibilityLabel === label,
  )
  expect(node).toBeDefined()
  return node
}

function seekBar(renderer: TestInstance): RenderedNode {
  const [node] = renderer.root.findAll(
    (n) => n.props.accessibilityRole === "adjustable",
  )
  expect(node).toBeDefined()
  return node
}

let mounted: TestInstance | null = null

beforeEach(() => {
  resetLocaleStoreForTests()
  mockGetLocales.mockReset()
})

afterEach(async () => {
  if (mounted != null) {
    await unmount(mounted)
    mounted = null
  }
})

describe("PlayerControls after a language change", () => {
  it("keeps the play tap name and the seek bar's raw action names", async () => {
    mockGetLocales.mockReturnValue(phoneLocales("en-US"))
    startLocaleSync()
    const player = makePlayer()
    mounted = await render(player)
    expect(tapActionName(byLabel(mounted, "Play"))).toBe("player-play")

    await changePhoneLanguage("ru-RU")

    const play = byLabel(mounted, "Воспроизвести")
    expect(tapActionName(play)).toBe("player-play")
    await press(play)
    expect(player.play).toHaveBeenCalledTimes(1)

    const bar = seekBar(mounted)
    expect(bar.props.accessibilityLabel).toBe("Полоса перемотки")
    const actions = bar.props.accessibilityActions as { name: string }[]
    expect(actions.map((action) => action.name)).toEqual([
      "increment",
      "decrement",
    ])
    await act(async () => {
      ;(
        bar.props.onAccessibilityAction as (event: {
          nativeEvent: { actionName: string }
        }) => void
      )({ nativeEvent: { actionName: "increment" } })
    })
    expect(player.currentTime).toBe(10)
  })
})
