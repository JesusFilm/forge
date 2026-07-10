import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { schema } from "@/graphql/schema"
import { VIDEO_MAPPER_CATALOG_NON_INDEXABLE_REASONS } from "@/services/video.service"

type FieldsHolder = { getFields(): Record<string, { type: unknown }> }
type EnumHolder = { getValues(): Array<{ name: string }> }

function fieldsOf(typeName: string): Record<string, { type: unknown }> {
  const type = schema.getType(typeName)
  expect(type, `type ${typeName} should exist on the schema`).toBeTruthy()
  return (type as unknown as FieldsHolder).getFields()
}

function nonNull(fields: Record<string, { type: unknown }>, key: string) {
  return String(fields[key]?.type).endsWith("!")
}

function resolverBlock(name: string) {
  const source = readFileSync(resolve(__dirname, "types/video.ts"), "utf8")
  const marker = `${name}: t.field({`
  const start = source.indexOf(marker)
  expect(start, `resolver ${name} should be declared`).toBeGreaterThanOrEqual(0)

  let index = start + marker.length - 1
  let depth = 0
  let inString: '"' | "'" | "`" | null = null
  let previous = ""
  while (index < source.length) {
    const char = source[index]
    if (inString) {
      if (char === inString && previous !== "\\") inString = null
    } else if (char === '"' || char === "'" || char === "`") {
      inString = char
    } else if (char === "{") {
      depth += 1
    } else if (char === "}") {
      depth -= 1
      if (depth === 0) return source.slice(start, index + 1)
    }
    previous = char
    index += 1
  }
  throw new Error(`resolver ${name} block did not close`)
}

describe("GraphQL videoMapperCatalog query", () => {
  it("exposes the mapper catalog root query with cursor pagination args", () => {
    const query = schema.getQueryType()
    expect(query).toBeTruthy()

    const field = query!.getFields().videoMapperCatalog
    expect(field).toBeDefined()
    expect(String(field.type)).toBe("VideoMapperCatalogConnection!")
    expect(field.args.map((arg) => arg.name).sort()).toEqual(["after", "first"])
    const argsByName = new Map(field.args.map((arg) => [arg.name, arg]))
    expect(String(argsByName.get("first")?.type)).toBe("Int")
    expect(String(argsByName.get("after")?.type)).toBe("String")
    expect(argsByName.get("first")?.description).toContain("Defaults to 100")
    expect(argsByName.get("first")?.description).toContain("capped at 250")
    expect(argsByName.get("after")?.description).toContain("endCursor")
  })

  it("keeps the mapper catalog query behind the dedicated non-public permission", () => {
    const block = resolverBlock("videoMapperCatalog")

    expect(block).toMatch(
      /authScopes:\s*\{\s*hasPermission:\s*"read:video-mapper-catalog"\s*\}/,
    )
    expect(block).not.toMatch(/authScopes:\s*\{\s*public:\s*true\s*\}/)
    expect(block).not.toMatch(/hasPermission:\s*"read:video-metadata"/)
  })

  it("maps validation failures to BAD_USER_INPUT for mapper clients", () => {
    const block = resolverBlock("videoMapperCatalog")

    expect(block).toMatch(/VideoLookupValidationErrorClass/)
    expect(block).toMatch(/GraphQLError/)
    expect(block).toMatch(/code:\s*"BAD_USER_INPUT"/)
  })

  it("exposes the flat mapper-required item fields with stable names", () => {
    const fields = fieldsOf("VideoMapperCatalogItem")
    expect(Object.keys(fields)).toEqual(
      expect.arrayContaining([
        "coreId",
        "sourceTitle",
        "sourceTitleLocale",
        "videoVariantId",
        "adminVideoId",
        "adminDubId",
        "languageId",
        "languageSlug",
        "locale",
        "editionCoreId",
        "editionName",
        "durationSeconds",
        "lengthInMilliseconds",
        "hlsUrl",
        "dashUrl",
        "shareUrl",
        "downloadUrl",
        "downloadQuality",
        "downloadWidth",
        "downloadHeight",
        "mediaSourceType",
        "mediaSourceUrl",
        "videoPublished",
        "dubPublished",
        "videoNoIndex",
        "videoDeleted",
        "dubDeleted",
        "deletedAt",
        "indexable",
        "nonIndexableReason",
      ]),
    )

    expect(nonNull(fields, "coreId")).toBe(true)
    expect(nonNull(fields, "sourceTitle")).toBe(true)
    expect(nonNull(fields, "videoVariantId")).toBe(true)
    expect(nonNull(fields, "adminVideoId")).toBe(true)
    expect(nonNull(fields, "adminDubId")).toBe(true)
    expect(nonNull(fields, "mediaSourceType")).toBe(true)
    expect(nonNull(fields, "indexable")).toBe(true)
    expect(nonNull(fields, "nonIndexableReason")).toBe(false)
    expect(fields.nonIndexableReason.type).toBeDefined()
    expect(String(fields.nonIndexableReason.type)).toBe("String")
    expect(
      fields.nonIndexableReason as { description?: string | null },
    ).toMatchObject({
      description: expect.stringContaining("media_missing"),
    })
    const description = (
      fields.nonIndexableReason as { description?: string | null }
    ).description
    for (const reason of VIDEO_MAPPER_CATALOG_NON_INDEXABLE_REASONS) {
      expect(description).toContain(reason)
    }
  })

  it("exposes connection pageInfo and media source enum values", () => {
    const connectionFields = fieldsOf("VideoMapperCatalogConnection")
    expect(Object.keys(connectionFields)).toEqual(
      expect.arrayContaining(["nodes", "pageInfo"]),
    )
    expect(nonNull(connectionFields, "nodes")).toBe(true)
    expect(nonNull(connectionFields, "pageInfo")).toBe(true)

    const pageInfoFields = fieldsOf("VideoMapperCatalogPageInfo")
    expect(Object.keys(pageInfoFields)).toEqual(
      expect.arrayContaining(["startCursor", "endCursor", "hasNextPage"]),
    )
    expect(nonNull(pageInfoFields, "hasNextPage")).toBe(true)

    const mediaSourceType = schema.getType("VideoMapperCatalogMediaSourceType")
    expect(
      (mediaSourceType as unknown as EnumHolder)
        .getValues()
        .map((value) => value.name)
        .sort(),
    ).toEqual(["DASH", "DOWNLOAD", "HLS", "NONE"])
  })
})
