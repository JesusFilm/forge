import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import {
  buildASTSchema,
  buildSchema,
  Kind,
  parse,
  print,
  validate,
  visit,
} from "graphql"
import {
  adminLegacyWatchExperienceFragment,
  adminWatchExperienceFragment,
} from "./watch-experience"

// Validate the actual shared client document against the committed real SDL,
// rather than checking a hand-built subset of union members. This catches
// FieldsInSetCanMerge conflicts from nullable/non-null sibling selections.
describe("Watch audience shared fragment against real Admin SDL", () => {
  it("validates the complete AdminWatchExperience selection", () => {
    const schema = buildSchema(
      readFileSync(
        new URL("../../../../apps/admin/schema.graphql", import.meta.url),
        "utf8",
      ),
    )
    const operation = parse(
      `query SharedWatchExperience($locale:String!){watchSetting(locale:$locale){defaultTemplateExperience{...AdminWatchExperience}}}`,
    )
    const document = visit(
      {
        kind: Kind.DOCUMENT,
        definitions: [
          ...operation.definitions,
          ...adminWatchExperienceFragment.definitions,
        ],
      },
      {
        Directive(node) {
          return node.name.value.startsWith("_") ? null : undefined
        },
      },
    )
    expect(validate(schema, document).map((error) => error.message)).toEqual([])
  })
  it("keeps released native legacy selections valid before and after the audience schema", () => {
    const sdl = readFileSync(
      new URL("../../../../apps/admin/schema.graphql", import.meta.url),
      "utf8",
    )
    const operation = parse(
      `query NativeLegacy($locale:String!){watchSetting(locale:$locale){defaultTemplateExperience{...AdminLegacyWatchExperience}}}`,
    )
    const document = visit(
      {
        kind: Kind.DOCUMENT,
        definitions: [
          ...operation.definitions,
          ...adminLegacyWatchExperienceFragment.definitions,
        ],
      },
      {
        Directive(node) {
          return node.name.value.startsWith("_") ? null : undefined
        },
      },
    )
    expect(print(document)).not.toContain("WatchAudienceBlock")
    expect(
      validate(buildSchema(sdl), document).map((error) => error.message),
    ).toEqual([])
    const old = buildASTSchema(
      visit(parse(sdl), {
        ObjectTypeDefinition(node) {
          if (
            ["WatchAudienceBlock", "WatchAudienceConfiguration"].includes(
              node.name.value,
            )
          )
            return null
          if (node.name.value === "WatchSetting")
            return {
              ...node,
              fields: node.fields?.filter(
                (field) => field.name.value !== "watchAudience",
              ),
            }
        },
        UnionTypeDefinition(node) {
          return {
            ...node,
            types: node.types?.filter(
              (type) => type.name.value !== "WatchAudienceBlock",
            ),
          }
        },
      }),
    )
    expect(old.getType("WatchAudienceBlock")).toBeUndefined()
    expect(validate(old, document).map((error) => error.message)).toEqual([])
  })
})
