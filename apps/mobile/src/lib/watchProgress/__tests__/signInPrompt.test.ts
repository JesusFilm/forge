import {
  PROMPT_DISMISS_COOLDOWN_MS,
  PROMPT_MIN_WATCHED_SECONDS,
  SIGN_IN_PROMPT_COPY,
  __resetSignInPromptSession,
  isPromptCooldownActive,
  markSignInPromptShown,
  noteSignedOutPlaybackStop,
  serializePromptDismissal,
  shouldShowSignInPrompt,
} from "../signInPrompt"

const NOW = Date.parse("2026-08-04T00:00:00.000Z")

beforeEach(() => {
  __resetSignInPromptSession()
})

describe("sign-in prompt trigger (R17/KTD13)", () => {
  it("arms only past the meaningful threshold", () => {
    noteSignedOutPlaybackStop(PROMPT_MIN_WATCHED_SECONDS - 1)
    expect(
      shouldShowSignInPrompt({
        signedIn: false,
        dismissedAtRaw: null,
        nowMs: NOW,
      }),
    ).toBe(false)

    noteSignedOutPlaybackStop(PROMPT_MIN_WATCHED_SECONDS + 30)
    expect(
      shouldShowSignInPrompt({
        signedIn: false,
        dismissedAtRaw: null,
        nowMs: NOW,
      }),
    ).toBe(true)
  })

  it("fires at most once per session globally — a second partially-watched video does not re-prompt", () => {
    noteSignedOutPlaybackStop(60)
    markSignInPromptShown()

    // A different video's stop in the same session must not re-arm.
    noteSignedOutPlaybackStop(120)
    expect(
      shouldShowSignInPrompt({
        signedIn: false,
        dismissedAtRaw: null,
        nowMs: NOW,
      }),
    ).toBe(false)
  })

  it("dismissal suppresses within the cooldown window across relaunches", () => {
    const dismissedAtRaw = serializePromptDismissal(NOW)

    // "Relaunch": fresh session state, persisted flag survives.
    __resetSignInPromptSession()
    noteSignedOutPlaybackStop(60)

    expect(
      shouldShowSignInPrompt({
        signedIn: false,
        dismissedAtRaw,
        nowMs: NOW + 1_000,
      }),
    ).toBe(false)
    expect(
      shouldShowSignInPrompt({
        signedIn: false,
        dismissedAtRaw,
        nowMs: NOW + PROMPT_DISMISS_COOLDOWN_MS + 1,
      }),
    ).toBe(true)
  })

  it("signing in disarms", () => {
    noteSignedOutPlaybackStop(60)
    expect(
      shouldShowSignInPrompt({
        signedIn: true,
        dismissedAtRaw: null,
        nowMs: NOW,
      }),
    ).toBe(false)
    // Disarmed for good — signing back out does not resurrect it.
    expect(
      shouldShowSignInPrompt({
        signedIn: false,
        dismissedAtRaw: null,
        nowMs: NOW,
      }),
    ).toBe(false)
  })

  it("degrades a corrupt cooldown flag to no-cooldown", () => {
    expect(isPromptCooldownActive("not-a-number", NOW)).toBe(false)
    expect(isPromptCooldownActive(null, NOW)).toBe(false)
  })

  it("the copy promises continuity from here on — never recovery of the position just watched (AE4)", () => {
    expect(SIGN_IN_PROMPT_COPY).toMatch(/from here on/)
    expect(SIGN_IN_PROMPT_COPY).not.toMatch(
      /left off|so far|this video|current position|just watched|resume/i,
    )
  })
})
