import { describe, expect, it } from "vitest"
import { createWatchAudienceConfiguration } from "@forge/experience-schema"
import {
  BlocksSchema,
  SectionContentBlockSchema,
  ContainerContentBlockSchema,
} from "./blocks"
const block = () => ({
  t: "watchAudience",
  sectionKey: "audience",
  configuration: createWatchAudienceConfiguration(),
})
describe("Watch audience block scope", () => {
  it("round-trips at top level alongside existing blocks", () => {
    const blocks = [{ t: "text", heading: "Existing content" }, block()]
    expect(BlocksSchema.parse(blocks)).toEqual(blocks)
  })
  it("rejects nested placement and duplicate instances", () => {
    expect(SectionContentBlockSchema.safeParse(block()).success).toBe(false)
    expect(ContainerContentBlockSchema.safeParse(block()).success).toBe(false)
    expect(
      BlocksSchema.safeParse([block(), { ...block(), sectionKey: "other" }])
        .success,
    ).toBe(false)
  })
  it("rejects a fourth question at the persistence boundary", () => {
    const b = block()
    b.configuration.roles[0]!.questions.push({
      ...structuredClone(b.configuration.roles[0]!.questions[0]!),
      id: "fourth-question",
    })
    expect(BlocksSchema.safeParse([b]).success).toBe(false)
  })
})
