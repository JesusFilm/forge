import {
  PERSONA_ROSTER,
  PERSONA_ROSTER_VERSION,
} from "../../config/personas/persona-roster"
import {
  PersonaSchema,
  type Persona,
  type PersonaSummary,
} from "./persona.schemas"

const personaCache = new Map<string, Persona>()

/**
 * Build (once) a validated id → persona index. Parsing here fails fast on a
 * malformed committed roster while keeping unknown-id lookups a graceful miss.
 */
function index(): Map<string, Persona> {
  if (personaCache.size === 0) {
    for (const raw of PERSONA_ROSTER) {
      const persona = PersonaSchema.parse(raw)
      personaCache.set(persona.id, persona)
    }
  }
  return personaCache
}

/** Returns the persona definition for an id, or undefined if unknown. */
export function loadPersona(id: string): Persona | undefined {
  return index().get(id)
}

/** Compact roster for picker/listing surfaces. */
export function listPersonaSummaries(): PersonaSummary[] {
  return [...index().values()].map(({ id, name, blurb }) => ({
    id,
    name,
    blurb,
  }))
}

export { PERSONA_ROSTER_VERSION }

export const _internals = { personaCache }
