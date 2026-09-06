import { describe, it, expect } from "vitest"
import fs from "node:fs"
import path from "node:path"
import YAML from "yaml"
import {
  sourceStatusFileSchema,
  deriveRowStatus,
} from "../src/contracts/source-status.js"
import { allSources } from "../src/registry/index.js"

// Composition-level guard: the COMMITTED tracker files must conform to the one
// status contract. A malformed file — whether a tool bug or a stray hand-edit —
// fails this in the existing `test` CI job. Lives in tests/** because it reads
// the filesystem (the import law keeps that out of src/**).

const repoRoot = path.resolve(import.meta.dirname, "..")
const read = (rel: string) => fs.readFileSync(path.join(repoRoot, rel), "utf8")
const file = sourceStatusFileSchema.parse(
  YAML.parse(read("docs/source-status.yaml")),
)

describe("docs/source-status.yaml conforms to the contract", () => {
  it("parses + validates against the per-language schema", () => {
    expect(Object.keys(file.sources).length).toBeGreaterThan(0)
  })

  it("every row's stored status equals the derived rollup", () => {
    for (const [key, row] of Object.entries(file.sources)) {
      expect(`${key}:${row.status}`).toBe(
        `${key}:${deriveRowStatus(row.languages)}`,
      )
    }
  })
})

describe("the lifecycle ledger agrees with the canonical Forge registry", () => {
  it("contains exactly the registry keys and each source's declared languages", () => {
    const registry = allSources()
    expect(Object.keys(file.sources).sort()).toEqual(
      registry.map(({ key }) => key).sort(),
    )
    for (const source of registry) {
      expect(Object.keys(file.sources[source.key].languages).sort()).toEqual(
        [...source.languages].sort(),
      )
    }
  })

  it("retains operational source-map metadata as valid YAML", () => {
    const sourceMap = YAML.parse(read("docs/source-map.yaml")) as Record<
      string,
      unknown
    >
    expect(sourceMap).toHaveProperty("gaps")
    expect(sourceMap).toHaveProperty("documented")
  })
})
