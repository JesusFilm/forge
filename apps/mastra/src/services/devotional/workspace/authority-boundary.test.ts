import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

import { DEVOTIONAL_AUTHORED_PATHS } from "../authored-data"
import { CatalogDocumentSchema } from "./catalog-schema"
import {
  inventoryDevotionalInputs,
  type InventoryFilesystem,
} from "./inventory"
import { categoryForWorkspacePath } from "./schemas"

const GENERATED_PATHS = [
  "/runs/run-1/content.json",
  "/_system/catalog/head.json",
] as const

describe("devotional Workspace authority boundary", () => {
  it.each(GENERATED_PATHS)(
    "never categorizes generated path %s as input",
    (path) => {
      expect(categoryForWorkspacePath(path)).toBeUndefined()
    },
  )

  it.each(GENERATED_PATHS)(
    "rejects generated path %s from catalog documents",
    (path) => {
      expect(() =>
        CatalogDocumentSchema.parse({
          path,
          category: "reflections",
          digest: "a".repeat(64),
          size: 10,
          modifiedAt: "2026-07-31T12:00:00.000Z",
          title: "generated",
          content: "must not be an input",
        }),
      ).toThrow()
    },
  )

  it("reports /runs and /_system files as outside inputs during inventory", async () => {
    const modifiedAt = new Date("2026-07-31T12:00:00.000Z")
    const inputPaths = [
      ...Object.values(DEVOTIONAL_AUTHORED_PATHS),
      "/inputs/reflections/README.md",
    ]
    const values = new Map(
      inputPaths.map((path) => [
        path,
        readFileSync(
          new URL(`../../../../devotional-workspace${path}`, import.meta.url),
        ),
      ]),
    )
    values.set("/runs/run-1/content.json", Buffer.from("generated output"))
    values.set("/_system/catalog/head.json", Buffer.from("generated metadata"))
    const filesystem: InventoryFilesystem = {
      async listFiles() {
        return [...values.keys()]
      },
      async readFile(path: string) {
        const value = values.get(path)
        if (!value) throw new Error(`missing fixture: ${path}`)
        return value
      },
      async stat(path: string) {
        const value = values.get(path)
        if (!value) throw new Error(`missing fixture: ${path}`)
        return { size: value.byteLength, modifiedAt }
      },
    }

    const inventory = await inventoryDevotionalInputs(filesystem)

    expect(inventory.eligible.map(({ path }) => path)).not.toEqual(
      expect.arrayContaining([...GENERATED_PATHS]),
    )
    expect(inventory.excluded).toEqual(
      expect.arrayContaining(
        GENERATED_PATHS.map((path) => ({ path, reason: "outside-inputs" })),
      ),
    )
  })
})
