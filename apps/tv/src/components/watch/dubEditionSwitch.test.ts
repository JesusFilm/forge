import {
  audioSwitchConfirmation,
  DIFFERENT_EDITION_MESSAGE,
  dubEditionRelation,
} from "./dubEditionSwitch"

// Canonical public JESUS edition IDs observed on 2026-10-28. The English North
// American Indigenous dub is a different cut from Thai and standard English.
const indigenousEnglish = { editionId: "cmp722p2707sfo001piphemoe" }
const thai = { editionId: "cmp71zmk2076lo001oo2174vh" }
const english = { editionId: "cmp71zmk2076lo001oo2174vh" }

it("requires a warning for the observed different-edition switch", () => {
  expect(dubEditionRelation(indigenousEnglish, thai)).toBe("different")
  expect(audioSwitchConfirmation(indigenousEnglish, thai)).toBe(
    DIFFERENT_EDITION_MESSAGE,
  )
  expect(audioSwitchConfirmation(thai, indigenousEnglish)).toBe(
    DIFFERENT_EDITION_MESSAGE,
  )
})

it("leaves a known shared-edition language switch seamless", () => {
  expect(dubEditionRelation(english, thai)).toBe("same")
  expect(audioSwitchConfirmation(english, thai)).toBeUndefined()
})

it.each([undefined, null, {}, { editionId: null }, { editionId: " " }])(
  "does not classify missing canonical identity as the same edition: %p",
  (unknown) => {
    expect(dubEditionRelation(unknown, english)).toBe("unknown")
    expect(dubEditionRelation(english, unknown)).toBe("unknown")
    expect(dubEditionRelation(unknown, unknown)).toBe("unknown")
    expect(audioSwitchConfirmation(unknown, english)).toBeUndefined()
  },
)
