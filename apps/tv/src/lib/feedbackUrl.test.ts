import { feedbackUrl } from "./feedbackUrl"

describe("feedback QR context", () => {
  it("encodes the current screen and film without putting a grant in the URL builder", () => {
    expect(
      feedbackUrl("https://feedback.example/tv", {
        platform: "apple-tv",
        screen: "player",
        player: "native-b",
        filmTitle: "JESUS",
        timestamp: "1:02:03",
      }),
    ).toBe(
      "https://feedback.example/tv?platform=apple-tv&screen=player&player=native-b&filmTitle=JESUS&timestamp=1%3A02%3A03",
    )
  })
})
