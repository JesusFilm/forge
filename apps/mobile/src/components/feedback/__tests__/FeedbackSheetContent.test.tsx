/**
 * The two-step feedback form (U4): the steps, the tag, the R7/R18 inline
 * bounds, the opt-in disclosure, the one failure message, and the StrictMode
 * remount the hook-lifetime refs have to survive.
 *
 * Only `getApolloClient` is replaced, so the real U3 seam runs: the draft goes
 * through `buildFeedbackSubmissionInput`, and each assertion reads the wire
 * shape admin would receive rather than a stubbed argument.
 */

// Ionicons requires native font modules at import time under jest.
jest.mock("@expo/vector-icons/Ionicons", () => ({
  __esModule: true,
  default: () => null,
}))
jest.mock("../../../lib/apolloClient", () => ({
  getApolloClient: jest.fn(),
}))
// Getters, not plain values: Babel's namespace interop COPIES the module at
// import time, so a plain object would freeze at its defaults.
jest.mock("expo-application", () => ({
  __esModule: true,
  get nativeApplicationVersion() {
    return "1.4.2"
  },
  get nativeBuildVersion() {
    return "31"
  },
}))
jest.mock("expo-device", () => ({
  __esModule: true,
  get modelName() {
    return "iPhone17,2"
  },
}))

import { act, StrictMode } from "react"
import { AccessibilityInfo, Animated } from "react-native"

import { FeedbackSheetContent } from "../FeedbackSheetContent"
import {
  FEEDBACK_STEP_FADE_MS,
  FEEDBACK_SUCCESS_CLOSE_MS,
  FEEDBACK_SUCCESS_MESSAGE,
  type FeedbackSheetContext,
} from "../feedbackFlow"
import { getApolloClient } from "../../../lib/apolloClient"
import { FEEDBACK_FAILURE_MESSAGE } from "../../../lib/feedbackCopy"
import { FEEDBACK_PLATFORM_LABEL } from "../../../lib/feedbackDeviceDetails"
import type {
  FeedbackRefusal,
  FeedbackSubmissionInput,
} from "../../../lib/feedbackQueries"
import {
  FEEDBACK_MESSAGE_MAX_LENGTH,
  FEEDBACK_MESSAGE_MIN_LENGTH,
  FEEDBACK_NAME_MAX_LENGTH,
} from "../../../lib/feedbackSubmission"
import {
  TestRenderer,
  hasText,
  press,
  pressableByLabel,
  unmount,
  type RenderedNode,
  type TestInstance,
} from "../../../test-utils/rnTestRenderer"

const VALID_MESSAGE = "The audio stops after the first minute."
const PLAYER_CONTEXT: FeedbackSheetContext = {
  kind: "BROKEN",
  video: {
    title: "JESUS",
    positionSeconds: 4324,
    slug: "jesus",
    languageSlug: "english",
  },
}

const mutate = jest.fn()
const mockedGetApolloClient = jest.mocked(getApolloClient)

let announce: jest.SpiedFunction<
  typeof AccessibilityInfo.announceForAccessibility
>
let addAccessibilityListener: jest.SpiedFunction<
  typeof AccessibilityInfo.addEventListener
>
let removeAccessibilityListener: jest.Mock

function acceptNext() {
  mutate.mockResolvedValue({
    data: { submitFeedback: { accepted: true, refusal: null } },
  })
}

function refuseNext(refusal: FeedbackRefusal | null) {
  mutate.mockResolvedValue({
    data: { submitFeedback: { accepted: false, refusal } },
  })
}

function submittedInput(): FeedbackSubmissionInput {
  const call = mutate.mock.calls.at(-1)?.[0] as {
    variables: { input: FeedbackSubmissionInput }
  }
  return call.variables.input
}

beforeEach(() => {
  jest.useFakeTimers()
  mutate.mockReset()
  acceptNext()
  mockedGetApolloClient.mockReset()
  mockedGetApolloClient.mockReturnValue({
    mutate,
  } as unknown as ReturnType<typeof getApolloClient>)
  // mockClear, not just spyOn: a spy on this module survives restoreAllMocks
  // here, so a second spyOn returns the SAME mock with the previous test's
  // calls still on it — every announcement assertion would read as leakage.
  announce = jest
    .spyOn(AccessibilityInfo, "announceForAccessibility")
    .mockImplementation(() => {})
  announce.mockClear()
  jest
    .spyOn(AccessibilityInfo, "isReduceMotionEnabled")
    .mockResolvedValue(false)
  removeAccessibilityListener = jest.fn()
  addAccessibilityListener = jest
    .spyOn(AccessibilityInfo, "addEventListener")
    .mockImplementation(
      () =>
        ({ remove: removeAccessibilityListener }) as unknown as ReturnType<
          typeof AccessibilityInfo.addEventListener
        >,
    )
  addAccessibilityListener.mockClear()
})

afterEach(() => {
  jest.useRealTimers()
  jest.restoreAllMocks()
})

type RenderOptions = {
  context?: FeedbackSheetContext
  onClose?: jest.Mock
  onDismissLockedChange?: jest.Mock
  strict?: boolean
  reduceMotion?: boolean
}

async function render(options: RenderOptions = {}) {
  if (options.reduceMotion) {
    jest
      .spyOn(AccessibilityInfo, "isReduceMotionEnabled")
      .mockResolvedValue(true)
  }
  const onClose = options.onClose ?? jest.fn()
  const onDismissLockedChange = options.onDismissLockedChange ?? jest.fn()
  const element = (
    <FeedbackSheetContent
      context={options.context}
      onClose={onClose}
      onDismissLockedChange={onDismissLockedChange}
    />
  )
  let renderer!: TestInstance
  await act(async () => {
    renderer = TestRenderer.create(
      options.strict ? <StrictMode>{element}</StrictMode> : element,
    )
  })
  return { renderer, onClose, onDismissLockedChange }
}

function inputByLabel(renderer: TestInstance, label: string): RenderedNode {
  const matches = renderer.root.findAll(
    (node) =>
      node.props.accessibilityLabel === label &&
      typeof node.props.onChangeText === "function",
  )
  expect(matches.length).toBeGreaterThan(0)
  return matches[0]
}

async function type(renderer: TestInstance, label: string, value: string) {
  const node = inputByLabel(renderer, label)
  await act(async () => {
    ;(node.props.onChangeText as (next: string) => void)(value)
  })
}

async function blurField(renderer: TestInstance, label: string) {
  const node = inputByLabel(renderer, label)
  await act(async () => {
    ;(node.props.onBlur as () => void)()
  })
}

async function setDeviceDetails(renderer: TestInstance, value: boolean) {
  const matches = renderer.root.findAll(
    (node) =>
      node.props.accessibilityRole === "switch" &&
      typeof node.props.onValueChange === "function",
  )
  expect(matches.length).toBeGreaterThan(0)
  await act(async () => {
    ;(matches[0].props.onValueChange as (next: boolean) => void)(value)
  })
}

function renderedTexts(renderer: TestInstance): string[] {
  return renderer.root
    .findAll((node) => typeof node.props.children === "string")
    .map((node) => node.props.children as string)
}

function disclosureValue(
  renderer: TestInstance,
  label: string,
): string | undefined {
  const prefix = `${label}: `
  return renderedTexts(renderer)
    .find((text) => text.startsWith(prefix))
    ?.slice(prefix.length)
}

/** Fill a valid draft on step two and press Send. */
async function composeAndSend(renderer: TestInstance, message = VALID_MESSAGE) {
  await type(renderer, "Your message", message)
  await press(pressableByLabel(renderer, "Send feedback"))
}

describe("step one (R4, R5)", () => {
  it("opens on the kind tiles with nothing selected, then moves to step two", async () => {
    const { renderer } = await render()
    expect(hasText(renderer, "What would you like to tell us?")).toBe(true)
    for (const label of [
      "Something's broken",
      "I have an idea",
      "Something else",
    ]) {
      expect(
        pressableByLabel(renderer, label).props.accessibilityState,
      ).toEqual({ selected: false })
    }

    await press(pressableByLabel(renderer, "I have an idea"))
    expect(hasText(renderer, "Tell us more")).toBe(true)
    expect(hasText(renderer, "I have an idea")).toBe(true)
  })

  it("returns to step one on Back with the typed message intact (R5)", async () => {
    const { renderer } = await render()
    await press(pressableByLabel(renderer, "Something else"))
    await type(renderer, "Your message", VALID_MESSAGE)

    await press(pressableByLabel(renderer, "Back"))
    expect(hasText(renderer, "What would you like to tell us?")).toBe(true)
    expect(
      pressableByLabel(renderer, "Something else").props.accessibilityState,
    ).toEqual({ selected: true })

    await press(pressableByLabel(renderer, "Something else"))
    expect(inputByLabel(renderer, "Your message").props.value).toBe(
      VALID_MESSAGE,
    )
  })

  it("announces the heading of each step it moves to (KTD11)", async () => {
    const { renderer } = await render()
    // Opening announces nothing — the screen reader reads the new sheet itself.
    expect(announce).not.toHaveBeenCalled()

    await press(pressableByLabel(renderer, "Something's broken"))
    expect(announce).toHaveBeenCalledWith("Tell us more")

    announce.mockClear()
    await press(pressableByLabel(renderer, "Back"))
    expect(announce).toHaveBeenCalledWith("What would you like to tell us?")
  })
})

describe("reduce motion", () => {
  it("fades the step change, and takes no time at all when it is on", async () => {
    const timing = jest.spyOn(Animated, "timing")

    const plain = await render()
    await press(pressableByLabel(plain.renderer, "Something else"))
    expect(timing).toHaveBeenCalledTimes(1)
    expect(timing.mock.calls[0][1]).toMatchObject({
      duration: FEEDBACK_STEP_FADE_MS,
    })

    timing.mockClear()
    const reduced = await render({ reduceMotion: true })
    await press(pressableByLabel(reduced.renderer, "Something else"))
    expect(timing).toHaveBeenCalledTimes(1)
    expect(timing.mock.calls[0][1]).toMatchObject({ duration: 0 })
  })
})

describe("the video tag (R6, AE1, AE2)", () => {
  it("opens on step two with the kind preset and the position formatted", async () => {
    const { renderer } = await render({ context: PLAYER_CONTEXT })
    expect(hasText(renderer, "Tell us more")).toBe(true)
    expect(hasText(renderer, "Something's broken")).toBe(true)
    expect(hasText(renderer, "About: JESUS at 1:12:04")).toBe(true)
    expect(
      pressableByLabel(renderer, "Remove the video from this report"),
    ).toBeDefined()
  })

  it("renders a sub-hour position without hours, and no 'at' with no position", async () => {
    const { renderer } = await render({
      context: {
        kind: "BROKEN",
        video: { title: "JESUS", positionSeconds: 43 },
      },
    })
    expect(hasText(renderer, "About: JESUS at 0:43")).toBe(true)

    const bare = await render({
      context: { kind: "BROKEN", video: { title: "JESUS" } },
    })
    expect(hasText(bare.renderer, "About: JESUS")).toBe(true)
    expect(hasText(bare.renderer, "About: JESUS at")).toBe(false)
  })

  it("shows no tag at all without a video", async () => {
    const { renderer } = await render({ context: { kind: "OTHER" } })
    expect(hasText(renderer, "About:")).toBe(false)
    expect(
      renderer.root.findAll(
        (node) =>
          node.props.accessibilityLabel === "Remove the video from this report",
      ),
    ).toHaveLength(0)
  })

  it("removes the tag for good and sends no video field (AE2)", async () => {
    const { renderer } = await render({ context: PLAYER_CONTEXT })
    await press(pressableByLabel(renderer, "Remove the video from this report"))
    expect(hasText(renderer, "About: JESUS")).toBe(false)

    // Step one and back again is the only route that could restore it.
    await press(pressableByLabel(renderer, "Back"))
    await press(pressableByLabel(renderer, "Something's broken"))
    expect(hasText(renderer, "About: JESUS")).toBe(false)

    await composeAndSend(renderer)
    expect(submittedInput().video).toBeUndefined()
  })
})

describe("the pre-Send check (R18, AE14)", () => {
  it("shows the message floor inline and sends nothing", async () => {
    const { renderer } = await render({ context: { kind: "BROKEN" } })
    await type(
      renderer,
      "Your message",
      "a".repeat(FEEDBACK_MESSAGE_MIN_LENGTH - 1),
    )
    await press(pressableByLabel(renderer, "Send feedback"))

    expect(
      hasText(
        renderer,
        `Please write at least ${FEEDBACK_MESSAGE_MIN_LENGTH} characters.`,
      ),
    ).toBe(true)
    expect(mutate).not.toHaveBeenCalled()
  })

  it("shows the message ceiling inline and sends nothing (AE14)", async () => {
    const { renderer } = await render({ context: { kind: "BROKEN" } })
    await type(
      renderer,
      "Your message",
      "a".repeat(FEEDBACK_MESSAGE_MAX_LENGTH + 1),
    )
    await press(pressableByLabel(renderer, "Send feedback"))

    expect(
      hasText(
        renderer,
        `Please use ${FEEDBACK_MESSAGE_MAX_LENGTH} characters or fewer.`,
      ),
    ).toBe(true)
    expect(mutate).not.toHaveBeenCalled()
  })

  it("counts the message as it is typed", async () => {
    const { renderer } = await render({ context: { kind: "BROKEN" } })
    expect(hasText(renderer, `0/${FEEDBACK_MESSAGE_MAX_LENGTH}`)).toBe(true)
    await type(renderer, "Your message", "abc")
    expect(hasText(renderer, `3/${FEEDBACK_MESSAGE_MAX_LENGTH}`)).toBe(true)
  })

  it("shows an over-long name inline, on blur and on Send", async () => {
    const { renderer } = await render({ context: { kind: "BROKEN" } })
    await type(renderer, "Your message", VALID_MESSAGE)
    await type(
      renderer,
      "Your name (optional)",
      "a".repeat(FEEDBACK_NAME_MAX_LENGTH + 1),
    )

    await blurField(renderer, "Your name (optional)")
    expect(
      hasText(
        renderer,
        `Please use ${FEEDBACK_NAME_MAX_LENGTH} characters or fewer.`,
      ),
    ).toBe(true)

    await press(pressableByLabel(renderer, "Send feedback"))
    expect(mutate).not.toHaveBeenCalled()
  })

  it("shows a malformed email inline and sends nothing", async () => {
    const { renderer } = await render({ context: { kind: "BROKEN" } })
    await type(renderer, "Your message", VALID_MESSAGE)
    await type(renderer, "Your email (optional)", "sam@@example")

    await blurField(renderer, "Your email (optional)")
    expect(hasText(renderer, "Please check this email address.")).toBe(true)

    await press(pressableByLabel(renderer, "Send feedback"))
    expect(mutate).not.toHaveBeenCalled()
  })

  it("passes a name at the bound with an empty email (R7)", async () => {
    const { renderer } = await render({ context: { kind: "BROKEN" } })
    const name = "a".repeat(FEEDBACK_NAME_MAX_LENGTH)
    await type(renderer, "Your name (optional)", name)
    await composeAndSend(renderer)

    const input = submittedInput()
    expect(input.name).toBe(name)
    // R8: an empty optional is omitted, never sent blank.
    expect(input.email).toBeUndefined()
  })

  it("never prefills the contact fields from anywhere (R7, KD4)", async () => {
    const { renderer } = await render({ context: PLAYER_CONTEXT })
    expect(inputByLabel(renderer, "Your name (optional)").props.value).toBe("")
    expect(inputByLabel(renderer, "Your email (optional)").props.value).toBe("")
  })
})

describe("the device-details switch (R9, AE3, AE4)", () => {
  it("is off by default and submits the platform only (AE3)", async () => {
    const { renderer } = await render({ context: { kind: "BROKEN" } })
    const switches = renderer.root.findAll(
      (node) => node.props.accessibilityRole === "switch",
    )
    expect(switches[0].props.value).toBe(false)

    await composeAndSend(renderer)
    const input = submittedInput()
    expect(input.deviceDetails).toBeUndefined()
    expect(input.platform).toBe("IOS")
  })

  it("submits exactly what the disclosure lists once it is on (AE4)", async () => {
    const { renderer } = await render({ context: { kind: "BROKEN" } })
    await setDeviceDetails(renderer, true)
    // Read the list BEFORE Send — success replaces the form with the
    // confirmation, so a later read would find nothing and pass vacuously.
    const listed = {
      platform: disclosureValue(renderer, "Platform"),
      appVersion: disclosureValue(renderer, "App version"),
      appBuild: disclosureValue(renderer, "App build"),
      osVersion: disclosureValue(renderer, "OS version"),
      deviceModel: disclosureValue(renderer, "Device model"),
    }
    await composeAndSend(renderer)

    const input = submittedInput()
    expect(input.deviceDetails).toBeDefined()
    expect(listed.platform).toBe(FEEDBACK_PLATFORM_LABEL[input.platform])
    expect(listed.appVersion).toBe(input.deviceDetails?.appVersion)
    expect(listed.appBuild).toBe(input.deviceDetails?.appBuild)
    expect(listed.osVersion).toBe(input.deviceDetails?.osVersion)
    expect(listed.deviceModel).toBe(input.deviceDetails?.deviceModel)
    expect(input.deviceDetails?.appVersion).toBe("1.4.2")
    expect(input.deviceDetails?.appBuild).toBe("31")
    expect(input.deviceDetails?.deviceModel).toBe("iPhone17,2")
  })

  it("names the platform in the disclosure while the switch is still off", async () => {
    const { renderer } = await render({ context: { kind: "BROKEN" } })
    expect(disclosureValue(renderer, "Platform")).toBe("iOS")
    expect(disclosureValue(renderer, "App version")).toBe("1.4.2")
  })

  it("shows Unknown for a value the phone cannot read", async () => {
    // Platform.Version is undefined under jest, which is the same shape a
    // device that withholds a value produces.
    const { renderer } = await render({ context: { kind: "BROKEN" } })
    expect(disclosureValue(renderer, "OS version")).toBe("Unknown")
    await setDeviceDetails(renderer, true)
    await composeAndSend(renderer)
    expect(submittedInput().deviceDetails?.osVersion).toBe("Unknown")
  })
})

describe("sending (R19, AE10)", () => {
  it("locks dismissal and ignores a second Send while in flight", async () => {
    let settle!: (value: unknown) => void
    mutate.mockReturnValue(
      new Promise((resolve) => {
        settle = resolve
      }),
    )
    const onDismissLockedChange = jest.fn()
    const { renderer, onClose } = await render({
      context: { kind: "BROKEN" },
      onDismissLockedChange,
    })
    await composeAndSend(renderer)

    expect(onDismissLockedChange).toHaveBeenLastCalledWith(true)
    expect(hasText(renderer, "Sending…")).toBe(true)

    // A double tap must not file a second ticket.
    await press(pressableByLabel(renderer, "Send feedback"))
    expect(mutate).toHaveBeenCalledTimes(1)

    // Back and Close are inert while the submission is in flight.
    await press(pressableByLabel(renderer, "Back"))
    expect(hasText(renderer, "What would you like to tell us?")).toBe(false)
    await press(pressableByLabel(renderer, "Close"))
    expect(onClose).not.toHaveBeenCalled()

    await act(async () => {
      settle({ data: { submitFeedback: { accepted: true, refusal: null } } })
    })
    expect(onDismissLockedChange).toHaveBeenLastCalledWith(false)
  })

  it("drops the result when the sheet unmounts mid-send (R19)", async () => {
    let settle!: (value: unknown) => void
    mutate.mockReturnValue(
      new Promise((resolve) => {
        settle = resolve
      }),
    )
    const { renderer, onClose } = await render({ context: { kind: "BROKEN" } })
    await composeAndSend(renderer)
    await unmount(renderer)

    await act(async () => {
      settle({ data: { submitFeedback: { accepted: true, refusal: null } } })
    })
    expect(onClose).not.toHaveBeenCalled()
  })
})

describe("success (R12, AE12)", () => {
  it("announces the confirmation, then closes on its own", async () => {
    const { renderer, onClose } = await render({ context: { kind: "BROKEN" } })
    await composeAndSend(renderer)

    expect(hasText(renderer, FEEDBACK_SUCCESS_MESSAGE)).toBe(true)
    expect(announce).toHaveBeenCalledWith(FEEDBACK_SUCCESS_MESSAGE)
    expect(onClose).not.toHaveBeenCalled()

    await act(async () => {
      jest.advanceTimersByTime(FEEDBACK_SUCCESS_CLOSE_MS)
    })
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(announce.mock.invocationCallOrder[0]).toBeLessThan(
      onClose.mock.invocationCallOrder[0],
    )
  })

  it("closes on a tap before the timer", async () => {
    const { renderer, onClose } = await render({ context: { kind: "BROKEN" } })
    await composeAndSend(renderer)
    await press(pressableByLabel(renderer, "Close"))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it("shows no ticket id and no link (R12)", async () => {
    const { renderer } = await render({ context: { kind: "BROKEN" } })
    await composeAndSend(renderer)
    const texts = renderedTexts(renderer).join(" ")
    expect(texts).not.toMatch(/https?:\/\//)
    expect(texts).not.toMatch(/linear\.app/i)
  })
})

describe("failure (R13, KD10, AE6, AE7, AE16)", () => {
  const REFUSALS: (FeedbackRefusal | null)[] = [
    "RATE_LIMITED",
    "DAILY_CAP",
    "INVALID_INPUT",
    "UNAVAILABLE",
    "NOT_CONFIGURED",
    null,
  ]

  it.each(REFUSALS)("renders the one message for %s", async (refusal) => {
    refuseNext(refusal)
    const { renderer } = await render({ context: { kind: "BROKEN" } })
    await composeAndSend(renderer)
    expect(hasText(renderer, FEEDBACK_FAILURE_MESSAGE)).toBe(true)
    expect(pressableByLabel(renderer, "Try again")).toBeDefined()
  })

  it("keeps every field, and Retry reuses the submission id (AE6, AE11)", async () => {
    refuseNext("RATE_LIMITED")
    const { renderer } = await render({ context: PLAYER_CONTEXT })
    await type(renderer, "Your message", VALID_MESSAGE)
    await type(renderer, "Your name (optional)", "Sam")
    await type(renderer, "Your email (optional)", "sam@example.com")
    await setDeviceDetails(renderer, true)
    await press(pressableByLabel(renderer, "Send feedback"))

    expect(hasText(renderer, FEEDBACK_FAILURE_MESSAGE)).toBe(true)
    const first = submittedInput()

    acceptNext()
    await press(pressableByLabel(renderer, "Try again"))
    const second = submittedInput()
    expect(mutate).toHaveBeenCalledTimes(2)
    // KTD8: one id per draft, so a duplicate ticket is visible rather than new.
    expect(second.submissionId).toBe(first.submissionId)
    expect(second).toEqual(first)
    expect(first.video?.title).toBe("JESUS")
    expect(first.deviceDetails).toBeDefined()
  })

  it("returns to the form on Edit with the whole draft intact (AE6)", async () => {
    refuseNext("DAILY_CAP")
    const { renderer } = await render({ context: PLAYER_CONTEXT })
    await type(renderer, "Your message", VALID_MESSAGE)
    await type(renderer, "Your name (optional)", "Sam")
    await setDeviceDetails(renderer, true)
    await press(pressableByLabel(renderer, "Send feedback"))

    await press(pressableByLabel(renderer, "Edit your feedback"))
    expect(inputByLabel(renderer, "Your message").props.value).toBe(
      VALID_MESSAGE,
    )
    expect(inputByLabel(renderer, "Your name (optional)").props.value).toBe(
      "Sam",
    )
    expect(hasText(renderer, "About: JESUS at 1:12:04")).toBe(true)
    const switches = renderer.root.findAll(
      (node) => node.props.accessibilityRole === "switch",
    )
    expect(switches[0].props.value).toBe(true)
  })

  it("renders the one message for a thrown request too", async () => {
    mutate.mockRejectedValue(new Error("offline"))
    const { renderer } = await render({ context: { kind: "BROKEN" } })
    await composeAndSend(renderer)
    expect(hasText(renderer, FEEDBACK_FAILURE_MESSAGE)).toBe(true)
  })
})

describe("StrictMode remount safety", () => {
  it("re-arms the alive ref, so a submit after the double cycle still closes", async () => {
    const { renderer, onClose } = await render({
      context: { kind: "BROKEN" },
      strict: true,
    })

    // Proof the effect cycle actually DOUBLED: useReduceMotion subscribes in
    // setup and removes in cleanup, so setup -> cleanup -> setup is two adds
    // against one remove. Without this the re-arm path is skipped vacuously.
    const reduceMotionSubscriptions =
      addAccessibilityListener.mock.calls.filter(
        (call) => (call[0] as string) === "reduceMotionChanged",
      )
    expect(reduceMotionSubscriptions).toHaveLength(2)
    expect(removeAccessibilityListener).toHaveBeenCalledTimes(1)

    await composeAndSend(renderer)
    expect(mutate).toHaveBeenCalledTimes(1)
    expect(hasText(renderer, FEEDBACK_SUCCESS_MESSAGE)).toBe(true)

    await act(async () => {
      jest.advanceTimersByTime(FEEDBACK_SUCCESS_CLOSE_MS)
    })
    expect(onClose).toHaveBeenCalled()
  })
})
