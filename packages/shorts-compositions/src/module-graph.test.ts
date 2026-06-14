// GUARD: the "./schema", "./captions", and "./registry" subpath exports are
// imported by manager server/workflow/SSR'd-client code and must stay
// React/Remotion-free (plan arch P1-1). Two layers of proof:
//   1. runtime — importing them in this node environment (no React, no DOM)
//      must succeed;
//   2. static — their import specifiers must stay inside an allowlist.
import { readFileSync } from "node:fs"

import { describe, expect, it } from "vitest"

const readSource = (file: string): string =>
  readFileSync(new URL(`./${file}`, import.meta.url), "utf8")

const importSpecifiers = (source: string): string[] => {
  const specifiers: string[] = []
  const staticImports = source.matchAll(/from\s+["']([^"']+)["']/g)
  for (const match of staticImports) specifiers.push(match[1])
  const dynamicImports = source.matchAll(/import\(\s*["']([^"']+)["']\s*\)/g)
  for (const match of dynamicImports) specifiers.push(match[1])
  return specifiers
}

describe("module graph guard", () => {
  it("schema.ts imports nothing but zod", () => {
    const specifiers = importSpecifiers(readSource("schema.ts"))
    expect(specifiers).toEqual(["zod"])
  })

  it("captions.ts imports only @remotion/captions and the schema module", () => {
    const specifiers = importSpecifiers(readSource("captions.ts"))
    const allowed = new Set(["@remotion/captions", "./schema"])
    expect(specifiers.length).toBeGreaterThan(0)
    for (const specifier of specifiers) {
      expect(allowed.has(specifier), `disallowed import "${specifier}"`).toBe(
        true,
      )
    }
  })

  it("templates/registry.ts imports only the schema module", () => {
    const specifiers = importSpecifiers(readSource("templates/registry.ts"))
    expect(specifiers).toEqual(["../schema"])
  })

  it.each(["schema.ts", "captions.ts", "templates/registry.ts"])(
    "%s never imports react, remotion core, or .tsx modules",
    (file) => {
      const specifiers = importSpecifiers(readSource(file))
      for (const specifier of specifiers) {
        expect(specifier).not.toBe("react")
        expect(specifier).not.toMatch(/^react\//)
        expect(specifier).not.toBe("remotion")
        expect(specifier).not.toMatch(/^remotion\//)
        expect(specifier).not.toMatch(/\.tsx$/)
      }
    },
  )

  it("schema module imports and executes without React in the environment", async () => {
    expect((globalThis as Record<string, unknown>).React).toBeUndefined()
    const schema = await import("./schema")
    expect(schema.SHORT_COMPOSITION_ID).toBe("short")
    expect(schema.draftSchema).toBeDefined()
  })

  it("captions module imports and executes without React in the environment", async () => {
    expect((globalThis as Record<string, unknown>).React).toBeUndefined()
    const captions = await import("./captions")
    expect(typeof captions.buildCaptionPages).toBe("function")
  })

  it("registry module imports and executes without React in the environment", async () => {
    expect((globalThis as Record<string, unknown>).React).toBeUndefined()
    const registry = await import("./templates/registry")
    expect(registry.SHORT_TEMPLATES.length).toBeGreaterThanOrEqual(2)
  })
})
