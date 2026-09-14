/**
 * The feedback machine (U4): every transition, the R7/R18 bounds decision, the
 * tag text, and the disclosure projection — all without a renderer.
 */
import {
  createFeedbackFlowState,
  decideFeedbackSend,
  feedbackDisclosureHint,
  feedbackDisclosureRows,
  feedbackDraftOf,
  feedbackFlowReducer,
  feedbackPositionLabel,
  feedbackProblemText,
  feedbackStepHeading,
  feedbackTagText,
  formatFeedbackPosition,
  FEEDBACK_COMPOSE_HEADING,
  FEEDBACK_KIND_LABEL,
  FEEDBACK_PICK_KIND_HEADING,
  type FeedbackFlowAction,
  type FeedbackFlowState,
} from "../feedbackFlow"
import {
  FEEDBACK_EMAIL_MAX_LENGTH,
  FEEDBACK_MESSAGE_MAX_LENGTH,
  FEEDBACK_MESSAGE_MIN_LENGTH,
  FEEDBACK_NAME_MAX_LENGTH,
  FEEDBACK_POSITION_MAX_SECONDS,
} from "../../../lib/feedbackSubmission"
import { FEEDBACK_KINDS } from "../../../lib/feedbackQueries"

const VALID_MESSAGE = "The audio stops after the first minute."

function run(
  state: FeedbackFlowState,
  ...actions: FeedbackFlowAction[]
): FeedbackFlowState {
  return actions.reduce(feedbackFlowReducer, state)
}

describe("createFeedbackFlowState", () => {
  it("opens on step one with no context, no tag, and the switch off (R9)", () => {
    const state = createFeedbackFlowState()
    expect(state.phase).toBe("pickKind")
    expect(state.kind).toBeNull()
    expect(state.video).toBeNull()
    expect(state.includeDeviceDetails).toBe(false)
    expect(state.message).toBe("")
    expect(state.name).toBe("")
    expect(state.email).toBe("")
  })

  it("opens on step two with the kind preset and the tag kept (AE1)", () => {
    const state = createFeedbackFlowState({
      kind: "BROKEN",
      video: { title: "JESUS", positionSeconds: 4324 },
    })
    expect(state.phase).toBe("compose")
    expect(state.kind).toBe("BROKEN")
    expect(state.video).toEqual({ title: "JESUS", positionSeconds: 4324 })
  })

  it("keeps a video but stays on step one when the context names no kind", () => {
    const state = createFeedbackFlowState({ video: { title: "JESUS" } })
    expect(state.phase).toBe("pickKind")
    expect(state.video).toEqual({ title: "JESUS" })
  })
})

describe("step transitions (R5, KTD11)", () => {
  it("moves to step two on a kind, and back to step one with the draft intact", () => {
    const composed = run(
      createFeedbackFlowState(),
      { type: "chooseKind", kind: "IDEA" },
      { type: "editField", field: "message", value: VALID_MESSAGE },
      { type: "editField", field: "name", value: "Sam" },
      { type: "setIncludeDeviceDetails", value: true },
    )
    expect(composed.phase).toBe("compose")
    expect(composed.kind).toBe("IDEA")

    const back = feedbackFlowReducer(composed, { type: "back" })
    expect(back.phase).toBe("pickKind")
    expect(back.kind).toBe("IDEA")
    expect(back.message).toBe(VALID_MESSAGE)
    expect(back.name).toBe("Sam")
    expect(back.includeDeviceDetails).toBe(true)
  })

  it("announces each step's own heading and nothing for the other phases", () => {
    expect(feedbackStepHeading("pickKind")).toBe(FEEDBACK_PICK_KIND_HEADING)
    expect(feedbackStepHeading("compose")).toBe(FEEDBACK_COMPOSE_HEADING)
    expect(FEEDBACK_PICK_KIND_HEADING).not.toBe(FEEDBACK_COMPOSE_HEADING)
    expect(feedbackStepHeading("sending")).toBeNull()
    expect(feedbackStepHeading("success")).toBeNull()
    expect(feedbackStepHeading("failed")).toBeNull()
  })

  it("labels every kind the schema allows (R4)", () => {
    expect(FEEDBACK_KINDS.map((kind) => FEEDBACK_KIND_LABEL[kind])).toEqual([
      "Something's broken",
      "I have an idea",
      "Something else",
    ])
  })
})

describe("the video tag (R6, KD5)", () => {
  it("cannot be restored once removed", () => {
    const removed = run(
      createFeedbackFlowState({
        kind: "BROKEN",
        video: { title: "JESUS", positionSeconds: 43 },
      }),
      { type: "removeVideo" },
    )
    expect(removed.video).toBeNull()

    // Every route back through step one and step two again keeps it gone.
    const returned = run(
      removed,
      { type: "back" },
      { type: "chooseKind", kind: "BROKEN" },
      { type: "removeVideo" },
    )
    expect(returned.phase).toBe("compose")
    expect(returned.video).toBeNull()
  })

  it("renders minutes below an hour and hours above it", () => {
    expect(formatFeedbackPosition(43)).toBe("0:43")
    expect(formatFeedbackPosition(4324)).toBe("1:12:04")
    expect(formatFeedbackPosition(0)).toBe("0:00")
    expect(formatFeedbackPosition(59)).toBe("0:59")
    expect(formatFeedbackPosition(60)).toBe("1:00")
    expect(formatFeedbackPosition(3599)).toBe("59:59")
    expect(formatFeedbackPosition(3600)).toBe("1:00:00")
    // The player's own time label omits hours and answers "72:04" here.
    expect(formatFeedbackPosition(4324)).not.toBe("72:04")
  })

  it("builds the tag text with and without a position", () => {
    expect(feedbackTagText({ title: "JESUS", positionSeconds: 4324 })).toBe(
      "About: JESUS at 1:12:04",
    )
    expect(feedbackTagText({ title: "JESUS", positionSeconds: 43 })).toBe(
      "About: JESUS at 0:43",
    )
    expect(feedbackTagText({ title: "JESUS" })).toBe("About: JESUS")
  })

  it("drops a position the submission would drop, rather than promising it", () => {
    expect(feedbackPositionLabel(null)).toBeNull()
    expect(feedbackPositionLabel(undefined)).toBeNull()
    expect(feedbackPositionLabel(Number.NaN)).toBeNull()
    expect(feedbackPositionLabel(-1)).toBeNull()
    expect(feedbackPositionLabel(FEEDBACK_POSITION_MAX_SECONDS + 1)).toBeNull()
    expect(feedbackPositionLabel(FEEDBACK_POSITION_MAX_SECONDS)).not.toBeNull()
    expect(
      feedbackTagText({
        title: "JESUS",
        positionSeconds: FEEDBACK_POSITION_MAX_SECONDS + 1,
      }),
    ).toBe("About: JESUS")
  })
})

describe("the pre-Send check (R18, KTD7)", () => {
  function composeWith(fields: Partial<FeedbackFlowState>): FeedbackFlowState {
    return {
      ...run(createFeedbackFlowState(), { type: "chooseKind", kind: "BROKEN" }),
      ...fields,
    } as FeedbackFlowState
  }

  it("blocks a message under the floor and readies one on it (AE14)", () => {
    const short = decideFeedbackSend(
      composeWith({ message: "a".repeat(FEEDBACK_MESSAGE_MIN_LENGTH - 1) }),
    )
    expect(short).toEqual({
      status: "blocked",
      problems: { message: "too_short" },
    })

    const exact = decideFeedbackSend(
      composeWith({ message: "a".repeat(FEEDBACK_MESSAGE_MIN_LENGTH) }),
    )
    expect(exact.status).toBe("ready")
  })

  it("blocks a message over the ceiling (AE14)", () => {
    const long = decideFeedbackSend(
      composeWith({ message: "a".repeat(FEEDBACK_MESSAGE_MAX_LENGTH + 1) }),
    )
    expect(long).toEqual({
      status: "blocked",
      problems: { message: "too_long" },
    })
  })

  it("blocks an over-long name and a malformed email, and passes the bounds", () => {
    expect(
      decideFeedbackSend(
        composeWith({
          message: VALID_MESSAGE,
          name: "a".repeat(FEEDBACK_NAME_MAX_LENGTH + 1),
        }),
      ),
    ).toEqual({ status: "blocked", problems: { name: "too_long" } })

    expect(
      decideFeedbackSend(
        composeWith({ message: VALID_MESSAGE, email: "not-an-address" }),
      ),
    ).toEqual({ status: "blocked", problems: { email: "invalid_email" } })

    const passing = decideFeedbackSend(
      composeWith({
        message: VALID_MESSAGE,
        name: "a".repeat(FEEDBACK_NAME_MAX_LENGTH),
        email: "",
      }),
    )
    expect(passing.status).toBe("ready")
  })

  it("blocks with no problems when there is no kind, so step one cannot send", () => {
    expect(
      decideFeedbackSend({
        ...createFeedbackFlowState(),
        message: VALID_MESSAGE,
      }),
    ).toEqual({ status: "blocked", problems: {} })
    expect(feedbackDraftOf(createFeedbackFlowState())).toBeNull()
  })

  it("clears a field's problem as the person types and re-checks on blur", () => {
    const blocked = run(
      createFeedbackFlowState(),
      { type: "chooseKind", kind: "BROKEN" },
      { type: "editField", field: "message", value: VALID_MESSAGE },
      { type: "editField", field: "email", value: "nope" },
      { type: "validateField", field: "email" },
    )
    expect(blocked.problems.email).toBe("invalid_email")

    const typing = feedbackFlowReducer(blocked, {
      type: "editField",
      field: "email",
      value: "nope@",
    })
    expect(typing.problems.email).toBeUndefined()

    const fixed = run(
      typing,
      { type: "editField", field: "email", value: "sam@example.com" },
      { type: "validateField", field: "email" },
    )
    expect(fixed.problems.email).toBeUndefined()
  })

  it("states each bound in its own inline sentence", () => {
    expect(feedbackProblemText("message", "too_short")).toContain(
      String(FEEDBACK_MESSAGE_MIN_LENGTH),
    )
    expect(feedbackProblemText("message", "too_long")).toContain(
      String(FEEDBACK_MESSAGE_MAX_LENGTH),
    )
    expect(feedbackProblemText("name", "too_long")).toContain(
      String(FEEDBACK_NAME_MAX_LENGTH),
    )
    expect(feedbackProblemText("email", "too_long")).toContain(
      String(FEEDBACK_EMAIL_MAX_LENGTH),
    )
    expect(feedbackProblemText("email", "invalid_email")).toBe(
      "Please check this email address.",
    )
  })
})

describe("the sending phases (R13, R19)", () => {
  const composed = run(
    createFeedbackFlowState(),
    { type: "chooseKind", kind: "BROKEN" },
    { type: "editField", field: "message", value: VALID_MESSAGE },
    { type: "editField", field: "name", value: "Sam" },
    { type: "setIncludeDeviceDetails", value: true },
  )

  it("locks every draft edit and Back while a submission is in flight", () => {
    const sending = feedbackFlowReducer(composed, { type: "sendStarted" })
    expect(sending.phase).toBe("sending")

    for (const action of [
      { type: "back" },
      { type: "editField", field: "message", value: "changed" },
      { type: "removeVideo" },
      { type: "setIncludeDeviceDetails", value: false },
      { type: "chooseKind", kind: "OTHER" },
    ] satisfies FeedbackFlowAction[]) {
      expect(feedbackFlowReducer(sending, action)).toBe(sending)
    }
  })

  it("keeps every field across a failure and back into the form (AE6)", () => {
    const failed = run(
      composed,
      { type: "sendStarted" },
      { type: "sendFailed" },
    )
    expect(failed.phase).toBe("failed")
    expect(failed.message).toBe(VALID_MESSAGE)
    expect(failed.name).toBe("Sam")
    expect(failed.kind).toBe("BROKEN")
    expect(failed.includeDeviceDetails).toBe(true)

    const editing = feedbackFlowReducer(failed, { type: "edit" })
    expect(editing.phase).toBe("compose")
    expect(editing.message).toBe(VALID_MESSAGE)
  })

  it("retries straight from the failed phase", () => {
    const failed = run(
      composed,
      { type: "sendStarted" },
      { type: "sendFailed" },
    )
    expect(feedbackFlowReducer(failed, { type: "sendStarted" }).phase).toBe(
      "sending",
    )
  })

  it("only settles a phase that is actually sending", () => {
    expect(feedbackFlowReducer(composed, { type: "sendSucceeded" })).toBe(
      composed,
    )
    expect(feedbackFlowReducer(composed, { type: "sendFailed" })).toBe(composed)
    const pickKind = createFeedbackFlowState()
    expect(feedbackFlowReducer(pickKind, { type: "sendStarted" })).toBe(
      pickKind,
    )
  })
})

describe("the device-details disclosure (R9, AE4)", () => {
  const details = {
    appVersion: "1.0.0",
    appBuild: "7",
    osVersion: "26.0",
    deviceModel: "iPhone17,2",
  }

  it("names the platform first and then every field the switch adds", () => {
    expect(feedbackDisclosureRows("IOS", details)).toEqual([
      { label: "Platform", value: "iOS" },
      { label: "App version", value: "1.0.0" },
      { label: "App build", value: "7" },
      { label: "OS version", value: "26.0" },
      { label: "Device model", value: "iPhone17,2" },
    ])
    expect(feedbackDisclosureRows("ANDROID", details)[0]).toEqual({
      label: "Platform",
      value: "Android",
    })
  })

  it("shows Unknown for a value the phone cannot read", () => {
    const rows = feedbackDisclosureRows("IOS", {
      ...details,
      deviceModel: "Unknown",
    })
    expect(rows.at(-1)).toEqual({ label: "Device model", value: "Unknown" })
  })

  it("hints with the same list the disclosure renders", () => {
    const rows = feedbackDisclosureRows("IOS", details)
    expect(feedbackDisclosureHint(rows)).toBe(
      "This sends Platform, App version, App build, OS version, Device model.",
    )
  })
})
