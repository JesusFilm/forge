import { readFile } from "node:fs/promises"

import { describe, expect, it } from "vitest"

import { buildOpenApiDocument } from "../scripts/generate-openapi.js"

describe("published /v1 OpenAPI artifact", () => {
  it("matches the canonical runtime schemas", async () => {
    const committed = JSON.parse(
      await readFile(new URL("../openapi.v1.json", import.meta.url), "utf8"),
    )
    expect(committed).toEqual(buildOpenApiDocument())
    expect(committed.components.schemas.Error.properties.issues.items).toEqual({
      type: "object",
    })
  })
})
