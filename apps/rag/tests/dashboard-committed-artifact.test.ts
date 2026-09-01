import { readFile } from "node:fs/promises"
import path from "node:path"
import { describe, expect, it } from "vitest"
import { assertHtmlMatchesTemplate } from "../scripts/lib/dashboard/verify.js"
import { assertDashboardPair } from "../scripts/lib/dashboard/publish.js"
import { compiledDataSchema } from "../scripts/lib/dashboard/types.js"

describe("committed dashboard artifact", () => {
  it("matches its marker and canonical template byte for byte", async () => {
    const root = path.resolve(import.meta.dirname, "..")
    const [raw, html, marker, template] = await Promise.all([
      readFile(path.join(root, "dashboard/compiled-data.json"), "utf8"),
      readFile(path.join(root, "dashboard/site/rag-status/index.html"), "utf8"),
      readFile(
        path.join(root, "dashboard/site/rag-status/.dashboard-commit.json"),
        "utf8",
      ),
      readFile(path.join(root, "dashboard/template.html"), "utf8"),
    ])
    assertDashboardPair(raw, html, marker)
    const data = compiledDataSchema.parse(JSON.parse(raw))
    expect(assertHtmlMatchesTemplate(template, html, data)).toEqual([])
  })
})
