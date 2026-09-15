import { describe, it, expect } from "vitest"
import {
  STAGES,
  stageStateSchema,
  rowStatusSchema,
  lifecycleLabelSchema,
  STAGE_STATE_DESCRIPTIONS,
  ROW_STATUS_DESCRIPTIONS,
  LIFECYCLE_LABEL_DESCRIPTIONS,
  languageEntrySchema,
  sourceRowSchema,
  sourceStatusFileSchema,
  deriveRowStatus,
  deriveLifecycleLabel,
} from "./source-status.js"
import type { RowStatus, Stages } from "./source-status.js"

// Fakes-only unit test for the source-status contract — the single place that
// defines the status vocabulary, its descriptions, and the two derived views.
// Filesystem validation of the committed file lives in tests/source-status.test.ts
// (composition-level — the import law keeps fs out of src/**).

const allGreen = {
  acquire: "green",
  ingest: "green",
  retrieve: "green",
  evaluate: "green",
} as const
const allPending = {
  acquire: "pending",
  ingest: "pending",
  retrieve: "pending",
  evaluate: "pending",
} as const

describe("status vocabulary is the single source of truth", () => {
  it("tracks exactly the four /slice stages, in order", () => {
    expect(STAGES).toEqual(["acquire", "ingest", "retrieve", "evaluate"])
  })

  it("gives every enum value a non-empty description (no value undocumented)", () => {
    const cover = (
      schema: { options: readonly string[] },
      descs: Record<string, string>,
    ) => {
      expect(Object.keys(descs).sort()).toEqual([...schema.options].sort())
      for (const v of schema.options)
        expect(descs[v]?.length ?? 0).toBeGreaterThan(0)
    }
    cover(stageStateSchema, STAGE_STATE_DESCRIPTIONS)
    cover(rowStatusSchema, ROW_STATUS_DESCRIPTIONS)
    cover(lifecycleLabelSchema, LIFECYCLE_LABEL_DESCRIPTIONS)
  })
})

describe("deriveRowStatus — the tool-derived rollup (blocked > in-progress > deferred > done)", () => {
  const lang = (status: RowStatus, stages: Stages = allGreen) => ({
    status,
    stages,
  })

  it("is done only when every language is done", () => {
    expect(deriveRowStatus({ en: lang("done") })).toBe("done")
    expect(deriveRowStatus({ en: lang("done"), es: lang("done") })).toBe("done")
  })
  it("in-progress beats deferred and done", () => {
    expect(
      deriveRowStatus({
        en: lang("done"),
        es: lang("in-progress", allPending),
      }),
    ).toBe("in-progress")
    expect(
      deriveRowStatus({
        en: lang("deferred", allPending),
        es: lang("in-progress", allPending),
      }),
    ).toBe("in-progress")
  })
  it("blocked outranks everything", () => {
    expect(
      deriveRowStatus({
        en: lang("done"),
        es: lang("blocked", { ...allPending, acquire: "red" }),
      }),
    ).toBe("blocked")
  })
  it("deferred beats done", () => {
    expect(
      deriveRowStatus({ en: lang("done"), es: lang("deferred", allPending) }),
    ).toBe("deferred")
  })
})

describe("deriveLifecycleLabel — the sources.md view (retrieve collapses into Ingested)", () => {
  it("maps a blocked/deferred language to its terminal label", () => {
    expect(
      deriveLifecycleLabel({
        status: "blocked",
        stages: { ...allPending, acquire: "red" },
      }),
    ).toBe("Blocked")
    expect(
      deriveLifecycleLabel({ status: "deferred", stages: allPending }),
    ).toBe("Deferred")
  })
  it("maps by furthest green stage otherwise", () => {
    expect(
      deriveLifecycleLabel({ status: "in-progress", stages: allPending }),
    ).toBe("Not started")
    expect(
      deriveLifecycleLabel({
        status: "in-progress",
        stages: { ...allPending, acquire: "green" },
      }),
    ).toBe("Acquired")
    expect(
      deriveLifecycleLabel({
        status: "in-progress",
        stages: {
          acquire: "green",
          ingest: "green",
          retrieve: "green",
          evaluate: "pending",
        },
      }),
    ).toBe("Ingested")
    expect(deriveLifecycleLabel({ status: "done", stages: allGreen })).toBe(
      "Evaluated",
    )
  })
})

describe("languageEntrySchema cross-field invariants", () => {
  it("accepts a done language with all stages green", () => {
    expect(
      languageEntrySchema.safeParse({ status: "done", stages: allGreen })
        .success,
    ).toBe(true)
  })
  it("rejects done when a stage is not green", () => {
    expect(
      languageEntrySchema.safeParse({
        status: "done",
        stages: { ...allGreen, ingest: "pending" },
      }).success,
    ).toBe(false)
  })
  it("accepts a blocked language with a blocker and a red stage", () => {
    expect(
      languageEntrySchema.safeParse({
        status: "blocked",
        stages: { ...allPending, acquire: "red" },
        blocker: "Cloudflare wall",
      }).success,
    ).toBe(true)
  })
  it("rejects blocked without a blocker", () => {
    expect(
      languageEntrySchema.safeParse({
        status: "blocked",
        stages: { ...allPending, acquire: "red" },
      }).success,
    ).toBe(false)
  })
  it("rejects blocked without any red stage", () => {
    expect(
      languageEntrySchema.safeParse({
        status: "blocked",
        stages: allPending,
        blocker: "x",
      }).success,
    ).toBe(false)
  })
  it("rejects unknown fields (strict)", () => {
    expect(
      languageEntrySchema.safeParse({
        status: "done",
        stages: allGreen,
        audience: "seeker",
      }).success,
    ).toBe(false)
  })

  // CodeRabbit #3: stages move in pipeline order — a later stage can't be non-pending
  // while an earlier one isn't green (else deriveLifecycleLabel under-reports).
  it("rejects out-of-order stages (a later stage advanced past an earlier one)", () => {
    expect(
      languageEntrySchema.safeParse({
        status: "in-progress",
        stages: {
          acquire: "pending",
          ingest: "green",
          retrieve: "pending",
          evaluate: "pending",
        },
      }).success,
    ).toBe(false)
    expect(
      languageEntrySchema.safeParse({
        status: "in-progress",
        stages: {
          acquire: "green",
          ingest: "pending",
          retrieve: "green",
          evaluate: "pending",
        },
      }).success,
    ).toBe(false)
  })
  it("allows a red stage once earlier stages are green (a stage may fail after progress)", () => {
    expect(
      languageEntrySchema.safeParse({
        status: "in-progress",
        stages: {
          acquire: "green",
          ingest: "green",
          retrieve: "red",
          evaluate: "pending",
        },
      }).success,
    ).toBe(true)
  })
})

describe("sourceRowSchema — stored status must equal the derived rollup", () => {
  const enDone = { en: { status: "done", stages: allGreen } }

  it("accepts a row whose status matches the derivation", () => {
    expect(
      sourceRowSchema.safeParse({
        name: "Starting With God",
        status: "done",
        languages: enDone,
        slice_file: "docs/slices/starting-with-god.md",
        last_updated: "2026-05-25",
      }).success,
    ).toBe(true)
  })
  it("rejects a row whose stored status disagrees with its languages", () => {
    expect(
      sourceRowSchema.safeParse({
        name: "Starting With God",
        status: "in-progress", // lie — derivation says done
        languages: enDone,
        slice_file: "docs/slices/starting-with-god.md",
        last_updated: "2026-05-25",
      }).success,
    ).toBe(false)
  })
  it("rejects a non-ISO last_updated", () => {
    expect(
      sourceRowSchema.safeParse({
        name: "x",
        status: "done",
        languages: enDone,
        slice_file: "docs/slices/x.md",
        last_updated: "June 2026",
      }).success,
    ).toBe(false)
  })
  it("requires at least one language", () => {
    expect(
      sourceRowSchema.safeParse({
        name: "x",
        status: "done",
        languages: {},
        slice_file: "docs/slices/x.md",
        last_updated: "2026-05-25",
      }).success,
    ).toBe(false)
  })
})

describe("sourceStatusFileSchema", () => {
  it("wraps rows under a sources map", () => {
    expect(
      sourceStatusFileSchema.safeParse({
        sources: {
          "starting-with-god": {
            name: "Starting With God",
            status: "done",
            languages: { en: { status: "done", stages: allGreen } },
            slice_file: "docs/slices/starting-with-god.md",
            last_updated: "2026-05-25",
          },
        },
      }).success,
    ).toBe(true)
  })
})
