import { describe, expect, it } from "vitest"
import type { WorkspaceFilesystem } from "@mastra/core/workspace"
import { readFileSync } from "node:fs"
import path from "node:path"

import { DEVOTIONAL_AUTHORED_PATHS } from "../authored-data"
import {
  createWorkspaceInventoryFilesystem,
  DEVOTIONAL_INVENTORY_DEFAULTS,
  inventoryDevotionalInputs,
  type InventoryFilesystem,
} from "./inventory"
import { DevotionalWorkspaceError } from "./errors"

type Fixture = { content: Buffer; modifiedAt: Date }

function filesystem(
  values: Record<string, string | Buffer>,
): InventoryFilesystem {
  const files = new Map<string, Fixture>(
    Object.entries(values).map(([path, content]) => [
      path,
      {
        content: Buffer.isBuffer(content) ? content : Buffer.from(content),
        modifiedAt: new Date("2026-07-31T12:00:00.000Z"),
      },
    ]),
  )

  return {
    async listFiles(root) {
      return [...files.keys()]
        .filter((filePath) => filePath.startsWith(`${root}/`))
        .reverse()
    },
    async readFile(path) {
      const file = files.get(path)
      if (!file) throw new Error("missing")
      return file.content
    },
    async stat(path) {
      const file = files.get(path)
      if (!file) throw new Error("missing")
      return {
        size: file.content.byteLength,
        modifiedAt: file.modifiedAt,
      }
    },
  }
}

const REQUIRED_FILES: Record<string, string | Buffer> = {
  ...Object.fromEntries(
    Object.values(DEVOTIONAL_AUTHORED_PATHS).map((workspacePath) => [
      workspacePath,
      readFileSync(
        path.join("devotional-workspace", workspacePath.replace(/^\//u, "")),
        "utf8",
      ),
    ]),
  ),
  "/inputs/scripture/john/3-16.md": "For God so loved the world",
  "/inputs/reflections/grace.txt": "Grace meets us before we are ready.",
}

describe("inventoryDevotionalInputs", () => {
  it("translates canonical absolute paths to native relative filesystem paths", async () => {
    const calls: string[] = []
    const native = {
      async readdir(path: string) {
        calls.push(`list:${path}`)
        if (path === "") return [{ name: "inputs", type: "directory" }]
        if (path === "inputs") {
          return [{ name: "scripture", type: "directory" }]
        }
        return [{ name: "john.md", type: "file" }]
      },
      async readFile(path: string) {
        calls.push(`read:${path}`)
        return "John"
      },
      async stat(path: string) {
        calls.push(`stat:${path}`)
        return {
          size: 4,
          modifiedAt: new Date("2026-07-31T12:00:00.000Z"),
        }
      },
    } as unknown as WorkspaceFilesystem
    const adapter = createWorkspaceInventoryFilesystem(native)

    await expect(adapter.listFiles("/")).resolves.toEqual([
      "/inputs/scripture/john.md",
    ])
    await adapter.readFile("/inputs/scripture/john.md")
    await adapter.stat("/inputs/scripture/john.md")
    expect(calls).toEqual([
      "list:",
      "list:inputs",
      "list:inputs/scripture",
      "read:inputs/scripture/john.md",
      "stat:inputs/scripture/john.md",
    ])
  })

  it("discovers supported files deterministically and reports unsupported files", async () => {
    const result = await inventoryDevotionalInputs(
      filesystem({
        ...REQUIRED_FILES,
        "/inputs/reflections/second.yaml": "title: Hope\nbody: Hope endures",
        "/inputs/reflections/notes.pdf": Buffer.from("%PDF"),
        "/runs/attempt-1/content.md": "must never be rediscovered",
      }),
    )

    expect(result.eligible.map((entry) => entry.path)).toEqual(
      expect.arrayContaining([
        "/inputs/reflections/grace.txt",
        "/inputs/reflections/second.yaml",
        "/inputs/safety/rubric.json",
        "/inputs/scripture/john/3-16.md",
      ]),
    )
    expect(result.excluded).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "/inputs/reflections/notes.pdf",
          reason: "unsupported-extension",
        }),
      ]),
    )
    expect(result.excluded).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "/runs/attempt-1/content.md" }),
      ]),
    )
    expect(result.eligible[0]?.digest).toMatch(/^[a-f0-9]{64}$/)
  })

  it("excludes one malformed optional source when valid alternatives remain", async () => {
    const result = await inventoryDevotionalInputs(
      filesystem({
        ...REQUIRED_FILES,
        "/inputs/reflections/broken.json": "{broken",
      }),
    )

    expect(result.excluded).toContainEqual(
      expect.objectContaining({
        path: "/inputs/reflections/broken.json",
        reason: "invalid-content",
      }),
    )
    expect(result.eligibleByCategory.reflections).toHaveLength(1)
  })

  it("fails closed when required config or a required corpus is invalid", async () => {
    await expect(
      inventoryDevotionalInputs(
        filesystem({
          ...REQUIRED_FILES,
          "/inputs/safety/rubric.json": "{}",
        }),
      ),
    ).rejects.toMatchObject({ code: "required-input-invalid" })

    await expect(
      inventoryDevotionalInputs(
        filesystem({
          "/inputs/reflections/grace.md": "Grace",
          "/inputs/safety/rubric.json":
            REQUIRED_FILES["/inputs/safety/rubric.json"],
        }),
      ),
    ).rejects.toMatchObject({ code: "required-category-empty" })
  })

  it("fails the entire inventory instead of committing a partial bounded listing", async () => {
    const tooMany = Object.fromEntries(
      Array.from({ length: 4 }, (_, index) => [
        `/inputs/reflections/${index}.md`,
        `Reflection ${index}`,
      ]),
    )

    await expect(
      inventoryDevotionalInputs(filesystem({ ...REQUIRED_FILES, ...tooMany }), {
        ...DEVOTIONAL_INVENTORY_DEFAULTS,
        maxFilesPerCategory: 3,
      }),
    ).rejects.toEqual(
      expect.objectContaining<Partial<DevotionalWorkspaceError>>({
        code: "inventory-limit-exceeded",
      }),
    )
  })

  it("rejects traversal and duplicate-normalized paths", async () => {
    await expect(
      inventoryDevotionalInputs(
        filesystem({
          ...REQUIRED_FILES,
          "/inputs/reflections/../safety/rubric.md": "unsafe alias",
        }),
      ),
    ).rejects.toMatchObject({ code: "unsafe-path" })
  })
})
