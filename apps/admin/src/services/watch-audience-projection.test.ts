import { describe, expect, it } from "vitest"
import { createWatchAudienceConfiguration } from "@forge/experience-schema"
import { projectPublishedWatchAudience } from "./watch-audience-projection"
const row = (configuration: unknown) => ({
  id: "locale-id",
  locale: "fr",
  blocks: [{ t: "watchAudience", sectionKey: "audience", configuration }],
})
describe("published Watch audience projection", () => {
  it("returns null only for absent authored content", () => {
    expect(projectPublishedWatchAudience(null)).toBeNull()
    expect(
      projectPublishedWatchAudience({ id: "x", locale: "fr", blocks: [] }),
    ).toBeNull()
  })
  it("preserves source identity and validated JSON", () => {
    const config = createWatchAudienceConfiguration()
    const projection = projectPublishedWatchAudience(row(config))!
    expect(projection).toMatchObject({
      sourceLocale: "fr",
      sourceBlockId: "audience",
      rejected: false,
    })
    expect(JSON.parse(projection.configJson!)).toEqual(config)
  })
  it("preserves rejected authored presence and deterministic historical identity", () => {
    const input = row({ roles: [] })
    delete (input.blocks[0] as Partial<(typeof input.blocks)[number]>)
      .sectionKey
    expect(projectPublishedWatchAudience(input)).toEqual({
      configJson: null,
      sourceLocale: "fr",
      sourceBlockId: "locale-id:block:0",
      rejected: true,
    })
  })
  it("drops an unsafe historical action AND its scores without replacing authored copy", () => {
    const config = createWatchAudienceConfiguration()
    config.roles[0]!.heading = "Authored heading"
    config.roles[0]!.actions[0]!.target = {
      kind: "resource",
      url: "javascript:alert(1)",
    }
    const projection = projectPublishedWatchAudience(row(config))!
    expect(projection.rejected).toBe(false)
    const parsed = JSON.parse(projection.configJson!)
    expect(parsed.roles[0].heading).toBe("Authored heading")
    expect(parsed.roles[0].actions.map((a: { id: string }) => a.id)).toEqual([
      "view-history",
    ])
    expect(parsed.roles[0].questions[0].options[0].scores).toEqual([])
  })
  it("rejects if all actions of any role are unsafe", () => {
    const config = createWatchAudienceConfiguration()
    config.roles[0]!.actions.forEach((a) => {
      a.target = { kind: "resource", url: "//bad.test" }
    })
    expect(projectPublishedWatchAudience(row(config))?.rejected).toBe(true)
  })
  it("rejects duplicate authored blocks without treating them as absent", () => {
    const input = row(createWatchAudienceConfiguration())
    input.blocks.push(structuredClone(input.blocks[0]!))
    expect(projectPublishedWatchAudience(input)).toMatchObject({
      configJson: null,
      rejected: true,
      sourceBlockId: "audience",
    })
  })
})
