import { describe, expect, it } from "vitest"
import {
  WATCH_AUDIENCE_NON_TEMPLATE_MESSAGE,
  WATCH_AUDIENCE_SINGLE_MESSAGE,
  watchAudienceInsertBlocker,
} from "./watch-audience-availability"

describe("watchAudienceInsertBlocker", () => {
  it("allows the first questionnaire on the default template", () => {
    expect(
      watchAudienceInsertBlocker({ isDefaultTemplate: true, blocks: [] }),
    ).toBeNull()
    expect(
      watchAudienceInsertBlocker({
        isDefaultTemplate: true,
        blocks: [{ t: "text" }],
      }),
    ).toBeNull()
  })

  // Public reads project only the default template's published block, so an
  // ordinary page, route or homepage copy would preview a questionnaire that
  // publish never delivers.
  it("blocks every non-template Experience with the template warning", () => {
    expect(
      watchAudienceInsertBlocker({ isDefaultTemplate: false, blocks: [] }),
    ).toBe(WATCH_AUDIENCE_NON_TEMPLATE_MESSAGE)
    expect(WATCH_AUDIENCE_NON_TEMPLATE_MESSAGE).toMatch(/default template/i)
  })

  it("keeps one questionnaire per template and names that reason", () => {
    expect(
      watchAudienceInsertBlocker({
        isDefaultTemplate: true,
        blocks: [{ t: "watchAudience" }],
      }),
    ).toBe(WATCH_AUDIENCE_SINGLE_MESSAGE)
  })

  it("reports the template reason first for a non-template that already carries a block", () => {
    expect(
      watchAudienceInsertBlocker({
        isDefaultTemplate: false,
        blocks: [{ t: "watchAudience" }],
      }),
    ).toBe(WATCH_AUDIENCE_NON_TEMPLATE_MESSAGE)
  })

  it("does not treat malformed entries as an existing questionnaire", () => {
    expect(
      watchAudienceInsertBlocker({
        isDefaultTemplate: true,
        blocks: [null, "watchAudience", 3, { t: 7 }],
      }),
    ).toBeNull()
  })
})
