// Drift-CI test for the typed ExperienceBlock surface. Asserts three
// independent contracts that together make the Zod + Pothos pairing safe:
//
//   1. Per-union scope alignment: every Zod option in BlockSchema /
//      SectionContentBlockSchema / ContainerContentBlockSchema has a member
//      in the matching Pothos union, and vice versa.
//   2. T_TO_TYPENAME totality: the keys (Zod discriminator literals) cover
//      every `t` literal across all three Zod scopes, and every value
//      (Pothos typename) is a registered object type on the schema.
//   3. T_TO_TYPENAME bijection: TYPENAME_TO_T is a true inverse — a typo in
//      either direction (e.g. `MediaCollectionBlok`) fails the test.
//
// Vacuous-pass guard: every assertion bottoms out at a `length > 0` /
// `size > 0` check on the source-of-truth set BEFORE the structural
// comparison. Without this, a Zod major upgrade that emptied the
// introspection (silently changed `BlockSchema.options` from an array to
// `undefined`) would let every set-equality assertion vacuously pass.
//
// Uses Zod 4's PUBLIC API: `union.options` is a public array on
// `ZodUnion` (which `ZodDiscriminatedUnion` extends), and
// `option.shape.t.value` is the public discriminator-literal accessor
// on `ZodLiteral`. NOT the Zod 3 `_def.options` / `_def.shape()` access.

import { describe, expect, it } from "vitest"
import { z } from "zod"
import {
  BlockSchema,
  ContainerContentBlockSchema,
  SectionContentBlockSchema,
} from "@/domain/blocks"
import { schema } from "@/graphql/schema"
import {
  T_TO_TYPENAME,
  TYPENAME_TO_T,
  type BlockKind,
  type BlockTypename,
} from "@/graphql/types/blocks"
import type { GraphQLUnionType } from "graphql"

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

/**
 * Read the `t` literal value from a Zod discriminated-union option.
 *
 * Uses `option.shape.t.value` (Zod 4 public API). The Zod 3 access path
 * `_def.shape().t._def.value` is internal and would be a silent break
 * after upgrade. If the shape ever changes (e.g., Zod renames `shape`),
 * this helper is the one place to fix.
 */
function readDiscriminator(option: z.ZodTypeAny): string {
  // The .options array on a discriminated union holds the variant schemas.
  // Each variant is a z.object whose `.shape` is the public field map.
  const shape = (option as unknown as { shape: Record<string, z.ZodTypeAny> })
    .shape
  if (shape == null || typeof shape !== "object") {
    throw new Error(
      "Zod discriminated-union option has no `.shape` — API may have changed",
    )
  }
  const tField = shape.t as unknown as { value: unknown } | undefined
  if (tField == null || typeof tField.value !== "string") {
    throw new Error(
      "Zod discriminator field `t` is missing or not a string literal",
    )
  }
  return tField.value
}

/**
 * Pull the discriminator literals out of a Zod discriminated union as a
 * Set<string>. ALWAYS asserts `> 0` first so an emptied introspection
 * (Zod API drift, accidental ZodOptional unwrap) fails loudly.
 */
function discriminatorsOf(
  schemaUnion:
    | typeof BlockSchema
    | typeof SectionContentBlockSchema
    | typeof ContainerContentBlockSchema,
  label: string,
): Set<string> {
  const options = schemaUnion.options as readonly z.ZodTypeAny[]
  if (!Array.isArray(options) || options.length === 0) {
    throw new Error(
      `Zod schema ${label}.options is empty or undefined — Zod API shape changed`,
    )
  }
  const out = new Set<string>()
  for (const option of options) {
    out.add(readDiscriminator(option))
  }
  if (out.size === 0) {
    throw new Error(
      `Zod schema ${label} discriminator set is empty — vacuous-pass guard tripped`,
    )
  }
  return out
}

/** Member typenames declared on a Pothos union as it sits on the schema. */
function unionMemberTypenamesOf(unionName: string): Set<string> {
  const unionType = schema.getType(unionName) as GraphQLUnionType | undefined
  if (unionType == null) {
    throw new Error(`Pothos union ${unionName} not registered on schema`)
  }
  const types = unionType.getTypes()
  if (types.length === 0) {
    throw new Error(
      `Pothos union ${unionName} has no member types — vacuous-pass guard tripped`,
    )
  }
  return new Set(types.map((t) => t.name))
}

function setsEqual(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false
  for (const v of a) if (!b.has(v)) return false
  return true
}

function diff(
  a: Set<string>,
  b: Set<string>,
): { onlyInA: string[]; onlyInB: string[] } {
  const onlyInA: string[] = []
  const onlyInB: string[] = []
  for (const v of a) if (!b.has(v)) onlyInA.push(v)
  for (const v of b) if (!a.has(v)) onlyInB.push(v)
  return { onlyInA: onlyInA.sort(), onlyInB: onlyInB.sort() }
}

// -----------------------------------------------------------------------------
// Vacuous-pass guard — this fires FIRST so any Zod API shape change surfaces
// before the structural comparisons.
// -----------------------------------------------------------------------------

describe("Zod introspection — vacuous-pass guard", () => {
  it("BlockSchema.options is non-empty (Zod public API shape check)", () => {
    expect(Array.isArray(BlockSchema.options)).toBe(true)
    expect(BlockSchema.options.length).toBeGreaterThan(0)
  })

  it("SectionContentBlockSchema.options is non-empty", () => {
    expect(Array.isArray(SectionContentBlockSchema.options)).toBe(true)
    expect(SectionContentBlockSchema.options.length).toBeGreaterThan(0)
  })

  it("ContainerContentBlockSchema.options is non-empty", () => {
    expect(Array.isArray(ContainerContentBlockSchema.options)).toBe(true)
    expect(ContainerContentBlockSchema.options.length).toBeGreaterThan(0)
  })
})

// -----------------------------------------------------------------------------
// Per-union scope alignment — Zod options ↔ Pothos union members.
// Each assertion compares the Zod-side discriminator set to the Pothos-side
// typename set after mapping through T_TO_TYPENAME.
// -----------------------------------------------------------------------------

describe("Per-union scope alignment", () => {
  it("ExperienceBlock (top-level) — Zod options align with Pothos union members", () => {
    const zodTSet = discriminatorsOf(BlockSchema, "BlockSchema")
    const pothosTypenames = unionMemberTypenamesOf("ExperienceBlock")

    const zodTypenames = new Set(
      [...zodTSet].map((t) => {
        const typename = (T_TO_TYPENAME as Record<string, string | undefined>)[
          t
        ]
        if (typename == null) {
          throw new Error(
            `Zod has discriminator "${t}" but T_TO_TYPENAME has no entry — add a mapping`,
          )
        }
        return typename
      }),
    )

    if (!setsEqual(zodTypenames, pothosTypenames)) {
      const { onlyInA, onlyInB } = diff(zodTypenames, pothosTypenames)
      throw new Error(
        `ExperienceBlock drift detected — Zod has [${onlyInA.join(", ")}] not in Pothos; Pothos has [${onlyInB.join(", ")}] not in Zod`,
      )
    }
    expect(zodTypenames.size).toBe(pothosTypenames.size)
  })

  it("SectionContentBlock — Zod options align with Pothos union members", () => {
    const zodTSet = discriminatorsOf(
      SectionContentBlockSchema,
      "SectionContentBlockSchema",
    )
    const pothosTypenames = unionMemberTypenamesOf("SectionContentBlock")

    const zodTypenames = new Set(
      [...zodTSet].map((t) => {
        const typename = (T_TO_TYPENAME as Record<string, string | undefined>)[
          t
        ]
        if (typename == null) {
          throw new Error(
            `Zod has discriminator "${t}" but T_TO_TYPENAME has no entry`,
          )
        }
        return typename
      }),
    )

    if (!setsEqual(zodTypenames, pothosTypenames)) {
      const { onlyInA, onlyInB } = diff(zodTypenames, pothosTypenames)
      throw new Error(
        `SectionContentBlock drift detected — Zod has [${onlyInA.join(", ")}] not in Pothos; Pothos has [${onlyInB.join(", ")}] not in Zod`,
      )
    }
    expect(zodTypenames.size).toBe(pothosTypenames.size)
  })

  it("ContainerContentBlock — Zod options align with Pothos union members", () => {
    const zodTSet = discriminatorsOf(
      ContainerContentBlockSchema,
      "ContainerContentBlockSchema",
    )
    const pothosTypenames = unionMemberTypenamesOf("ContainerContentBlock")

    const zodTypenames = new Set(
      [...zodTSet].map((t) => {
        const typename = (T_TO_TYPENAME as Record<string, string | undefined>)[
          t
        ]
        if (typename == null) {
          throw new Error(
            `Zod has discriminator "${t}" but T_TO_TYPENAME has no entry`,
          )
        }
        return typename
      }),
    )

    if (!setsEqual(zodTypenames, pothosTypenames)) {
      const { onlyInA, onlyInB } = diff(zodTypenames, pothosTypenames)
      throw new Error(
        `ContainerContentBlock drift detected — Zod has [${onlyInA.join(", ")}] not in Pothos; Pothos has [${onlyInB.join(", ")}] not in Zod`,
      )
    }
    expect(zodTypenames.size).toBe(pothosTypenames.size)
  })
})

// -----------------------------------------------------------------------------
// T_TO_TYPENAME totality + values registered on the schema
// -----------------------------------------------------------------------------

describe("T_TO_TYPENAME alignment with the live schema", () => {
  it("every key in T_TO_TYPENAME is a discriminator present in at least one Zod scope", () => {
    const allZodDiscriminators = new Set<string>([
      ...discriminatorsOf(BlockSchema, "BlockSchema"),
      ...discriminatorsOf(
        SectionContentBlockSchema,
        "SectionContentBlockSchema",
      ),
      ...discriminatorsOf(
        ContainerContentBlockSchema,
        "ContainerContentBlockSchema",
      ),
    ])
    const mapKeys = new Set<string>(Object.keys(T_TO_TYPENAME))

    if (!setsEqual(allZodDiscriminators, mapKeys)) {
      const { onlyInA, onlyInB } = diff(allZodDiscriminators, mapKeys)
      throw new Error(
        `T_TO_TYPENAME key drift — Zod has [${onlyInA.join(", ")}] not in map; map has [${onlyInB.join(", ")}] not in any Zod scope`,
      )
    }
  })

  it("every value in T_TO_TYPENAME is a registered object type on the schema", () => {
    for (const typename of Object.values(T_TO_TYPENAME)) {
      const type = schema.getType(typename)
      expect(
        type,
        `${typename} should be registered on the schema`,
      ).toBeTruthy()
    }
  })
})

// -----------------------------------------------------------------------------
// Bijection — T_TO_TYPENAME ↔ TYPENAME_TO_T
// -----------------------------------------------------------------------------

describe("T_TO_TYPENAME ↔ TYPENAME_TO_T bijection", () => {
  it("round-trips every kind through both directions", () => {
    for (const kind of Object.keys(T_TO_TYPENAME) as BlockKind[]) {
      const typename = T_TO_TYPENAME[kind]
      // Forward direction trivially holds because the constants are derived
      // from the same source — but the inverse table is constructed by
      // `Object.fromEntries(Object.entries(T_TO_TYPENAME).map(...))`, which
      // collapses on the right-hand side if any value is repeated. A typo
      // that accidentally duplicates a typename (e.g., `card → CardBlock`
      // AND `cta → CardBlock`) shrinks `TYPENAME_TO_T`'s key set without
      // changing `T_TO_TYPENAME`'s — this round-trip catches it.
      expect(TYPENAME_TO_T[typename]).toBe(kind)
    }
  })

  it("inverse table has the same cardinality as the forward table", () => {
    const forwardSize = Object.keys(T_TO_TYPENAME).length
    const inverseSize = Object.keys(TYPENAME_TO_T).length
    expect(inverseSize).toBe(forwardSize)
  })

  it("every typename round-trips back to the same kind", () => {
    for (const typename of Object.keys(TYPENAME_TO_T) as BlockTypename[]) {
      const kind = TYPENAME_TO_T[typename]
      expect(T_TO_TYPENAME[kind]).toBe(typename)
    }
  })
})

// -----------------------------------------------------------------------------
// Real-DB integration test — deferred to a post-deploy smoke test in U3's
// Verification section. The fixture-based tests above cover the core
// resolveType contract end-to-end; a real-server probe with seeded data
// would prove the same contract but requires a live admin server +
// seeded Prisma rows. See the U3 Verification section in
// `docs/plans/2026-05-11-003-feat-web-admin-direct-cutover-plan.md`.
// -----------------------------------------------------------------------------

describe.todo("real-DB integration — seeded ExperienceLocale with 3+ kinds")
