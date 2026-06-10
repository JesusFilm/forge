import {
  composeAudioSubsPillSub,
  composePlayerStatusChip,
} from "./playerChrome"

describe("composePlayerStatusChip", () => {
  it("shows language + CC segment while subtitles are on", () => {
    expect(composePlayerStatusChip("English", "Español")).toBe(
      "English · CC Español",
    )
  })

  it("shows language alone while subtitles are off", () => {
    expect(composePlayerStatusChip("English", null)).toBe("English")
  })

  it("hides the chip entirely without a language (no-session playback)", () => {
    expect(composePlayerStatusChip(null, null)).toBeNull()
    // Subtitles without a resolvable language never render a dangling chip.
    expect(composePlayerStatusChip(null, "English")).toBeNull()
  })
})

describe("composeAudioSubsPillSub", () => {
  it("states the active subtitle language", () => {
    expect(composeAudioSubsPillSub("English", "Português")).toBe(
      "English · CC Português",
    )
  })

  it("states Off explicitly when subtitles are off", () => {
    expect(composeAudioSubsPillSub("English", null)).toBe("English · CC Off")
  })

  it("hides the sub-caption without a language", () => {
    expect(composeAudioSubsPillSub(null, "English")).toBeNull()
  })
})
