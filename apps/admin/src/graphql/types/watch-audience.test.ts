import { describe, expect, it, vi } from "vitest"
import { schema } from "@/graphql/schema"
import type { GraphQLObjectType } from "graphql"

describe("Watch audience public SDL and resolver", () => {
  it("distinguishes rejected from absent in the exact public contract", () => {
    const configuration = schema.getType(
      "WatchAudienceConfiguration",
    ) as GraphQLObjectType
    const fields = configuration.getFields()
    expect(String(fields.configJson!.type)).toBe("String")
    expect(String(fields.rejected!.type)).toBe("Boolean!")
    expect(String(fields.sourceLocale!.type)).toBe("String!")
    expect(String(fields.sourceBlockId!.type)).toBe("String!")
    const setting = schema.getType("WatchSetting") as GraphQLObjectType
    expect(String(setting.getFields().watchAudience!.type)).toBe(
      "WatchAudienceConfiguration",
    )
    expect(
      String(
        setting
          .getFields()
          .watchAudience!.args.find((a) => a.name === "locale")!.type,
      ),
    ).toBe("String")
  })
  it("matches sibling union response shapes for shared unaliased selections", () => {
    const fields = (
      schema.getType("WatchAudienceBlock") as GraphQLObjectType
    ).getFields()
    expect(String(fields.t!.type)).toBe("String")
    expect(String(fields.sectionKey!.type)).toBe("String")
    expect(String(fields.configurationJson!.type)).toBe("String!")
  })
  it("passes the source row and optional locale to the published service", async () => {
    const fields = (
      schema.getType("WatchSetting") as GraphQLObjectType
    ).getFields()
    const getWatchAudience = vi.fn().mockResolvedValue({
      configJson: null,
      rejected: true,
      sourceLocale: "fr",
      sourceBlockId: "authored",
    })
    const root = {
      locale: "fr",
      defaultTemplateExperience: { id: "published" },
    }
    const ctx = { services: { watchSetting: { getWatchAudience } } }
    // Field resolver is deliberately service-mediated, with no relation/draft path.
    const resolved = await fields.watchAudience!.resolve!(
      root,
      { locale: "es" },
      ctx,
      {} as never,
    )
    expect(getWatchAudience).toHaveBeenCalledWith(root, "es")
    expect(resolved).toMatchObject({ rejected: true, configJson: null })
  })
})
