import { beforeEach, describe, expect, it } from "vitest"

import { PERSONA_ROSTER } from "../../config/personas/persona-roster"
import {
  _internals,
  listPersonaSummaries,
  loadPersona,
} from "./persona-library"
import { PersonaSchema } from "./persona.schemas"

describe("persona-library", () => {
  beforeEach(() => {
    _internals.personaCache.clear()
  })

  it("loads a known persona that satisfies PersonaSchema", () => {
    const persona = loadPersona("grieving")
    expect(persona).toBeDefined()
    expect(() => PersonaSchema.parse(persona)).not.toThrow()
    expect(persona?.name).toBe("Grieving")
    expect(persona?.needs.length).toBeGreaterThan(0)
  })

  it("returns undefined for an unknown persona without throwing", () => {
    expect(loadPersona("does-not-exist")).toBeUndefined()
  })

  it("lists id + name + blurb (only) for every roster entry", () => {
    const summaries = listPersonaSummaries()
    expect(summaries).toHaveLength(PERSONA_ROSTER.length)
    for (const s of summaries) {
      expect(s.id).toBeTruthy()
      expect(s.name).toBeTruthy()
      expect(s.blurb).toBeTruthy()
      expect(Object.keys(s).sort()).toEqual(["blurb", "id", "name"])
    }
  })

  it("validates every committed roster entry and enforces unique ids", () => {
    for (const raw of PERSONA_ROSTER) {
      expect(() => PersonaSchema.parse(raw)).not.toThrow()
    }
    const ids = PERSONA_ROSTER.map((p) => p.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})
