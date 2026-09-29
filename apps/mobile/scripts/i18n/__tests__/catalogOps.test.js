/* eslint-disable @typescript-eslint/no-require-imports */
/* global describe, expect, it, require */
// Pure helpers behind scripts/i18n/translate-catalogs.mjs (KTD6 steps 1-4, 6).
const ops = require("../lib/catalogOps")
const { contractError } = require("../lib/catalogChecks")

function state({ source, catalogs = {}, record, policy = {} }) {
  return {
    source,
    catalogs,
    record: {
      englishHashes:
        record ??
        Object.fromEntries(
          Object.entries(source).map(([key, text]) => [
            key,
            ops.englishHash(text),
          ]),
        ),
    },
    policy: {
      humanReviewedLocales: ["en"],
      intentionallyLocaleNeutral: [],
      englishOnlyLocales: [],
      pendingKeys: {},
      ...policy,
    },
  }
}

describe("flattenCatalog and unflattenCatalog", () => {
  it("round-trips a nested catalog in source order", () => {
    const tree = { A: { x: "1", y: "2" }, B: { z: "3" } }
    const flat = ops.flattenCatalog(tree)
    expect(flat).toEqual({ "A.x": "1", "A.y": "2", "B.z": "3" })
    expect(ops.unflattenCatalog(flat)).toEqual(tree)
  })

  it("rejects a value that is not a string or an object", () => {
    expect(() => ops.flattenCatalog({ A: { x: 1 } })).toThrow(/A\.x/)
  })

  it("orders a catalog like the source and keeps extra keys last", () => {
    const source = { "A.x": "1", "A.y": "2", "B.z": "3" }
    const ordered = ops.orderLikeSource(
      { "B.z": "c", "Old.k": "o", "A.y": "b", "A.x": "a" },
      source,
    )
    expect(Object.keys(ordered)).toEqual(["A.x", "A.y", "B.z", "Old.k"])
  })
})

describe("normalizePolicy", () => {
  it("fills defaults and sorts every list", () => {
    expect(
      ops.normalizePolicy({
        humanReviewedLocales: ["en"],
        englishOnlyLocales: ["mey-Latn", "crk"],
        pendingKeys: { "B.b": "2026-09-02", "A.a": "2026-09-01" },
      }),
    ).toEqual({
      humanReviewedLocales: ["en"],
      intentionallyLocaleNeutral: [],
      englishOnlyLocales: ["crk", "mey-Latn"],
      pendingKeys: { "A.a": "2026-09-01", "B.b": "2026-09-02" },
    })
  })

  it.each([
    [{ intentionallyLocaleNeutral: "A.a" }, /intentionallyLocaleNeutral/],
    [{ pendingKeys: ["A.a"] }, /pendingKeys/],
    [{ pendingKeys: { "A.a": "yesterday" } }, /A\.a/],
    [{ pendingKeys: { "A.a": "2026-02-31" } }, /A\.a/],
    [{ pendingKey: {} }, /pendingKey/],
  ])("rejects a malformed policy %#", (raw, message) => {
    expect(() => ops.normalizePolicy(raw, "policy.json")).toThrow(message)
    try {
      ops.normalizePolicy(raw, "policy.json")
    } catch (error) {
      expect(error.code).toBe("INVALID_TRANSLATION_POLICY")
    }
  })
})

describe("normalizeRecord", () => {
  it("rejects a hash that is not 16 hexadecimal characters", () => {
    expect(() =>
      ops.normalizeRecord({ englishHashes: { "A.a": "xyz" } }, "record.json"),
    ).toThrow(/A\.a/)
  })
})

describe("seedCatalogs (step 1)", () => {
  it("creates an empty catalog for a locale that has none", () => {
    const s = state({ source: { "A.a": "Hello" }, catalogs: { es: {} } })
    expect(ops.seedCatalogs(s, ["es", "fr"])).toEqual(["fr"])
    expect(s.catalogs.fr).toEqual({})
  })
})

describe("pruneDeletedKeys (step 2)", () => {
  it("removes a deleted key from every catalog, the record, and the policy", () => {
    const s = state({
      source: { "A.a": "Hello" },
      catalogs: {
        es: { "A.a": "Hola", "A.gone": "Adiós" },
        fr: { "A.gone": "Adieu" },
      },
      record: { "A.a": ops.englishHash("Hello"), "A.gone": "0".repeat(16) },
      policy: {
        pendingKeys: { "A.gone": "2026-09-01" },
        intentionallyLocaleNeutral: ["A.gone"],
      },
    })
    const result = ops.pruneDeletedKeys(s)
    expect(result.catalogs).toEqual({ es: ["A.gone"], fr: ["A.gone"] })
    expect(s.catalogs).toEqual({ es: { "A.a": "Hola" }, fr: {} })
    expect(s.record.englishHashes).toEqual({ "A.a": ops.englishHash("Hello") })
    expect(s.policy.pendingKeys).toEqual({})
    expect(s.policy.intentionallyLocaleNeutral).toEqual([])
  })
})

describe("syncEnglishOnly", () => {
  it("copies the English catalog into each English-only catalog that exists", () => {
    const s = state({
      source: { "A.a": "Hello", "A.b": "Bye" },
      catalogs: { crk: { "A.a": "Hello" }, es: {} },
      policy: { englishOnlyLocales: ["crk", "mey-Latn"] },
    })
    expect(ops.syncEnglishOnly(s)).toEqual(["crk"])
    expect(s.catalogs.crk).toEqual({ "A.a": "Hello", "A.b": "Bye" })
    expect(s.catalogs["mey-Latn"]).toBeUndefined()
    expect(s.catalogs.es).toEqual({})
  })
})

describe("invalidateChangedKeys (step 3)", () => {
  it("deletes a changed key in every translated locale and records the new hash", () => {
    const s = state({
      source: { "A.a": "Hello there", "A.b": "Bye" },
      catalogs: {
        es: { "A.a": "Hola", "A.b": "Adiós" },
        fr: { "A.a": "Bonjour", "A.b": "Au revoir" },
        crk: { "A.a": "Hello", "A.b": "Bye" },
      },
      record: {
        "A.a": ops.englishHash("Hello"),
        "A.b": ops.englishHash("Bye"),
      },
      policy: { englishOnlyLocales: ["crk"] },
    })
    const result = ops.invalidateChangedKeys(s)
    expect(result.changed).toEqual(["A.a"])
    expect(result.deleted).toEqual({ es: ["A.a"], fr: ["A.a"] })
    expect(s.catalogs.es).toEqual({ "A.b": "Adiós" })
    expect(s.catalogs.fr).toEqual({ "A.b": "Au revoir" })
    // English-only catalogs follow syncEnglishOnly, not invalidation.
    expect(s.catalogs.crk).toEqual({ "A.a": "Hello", "A.b": "Bye" })
    expect(s.record.englishHashes["A.a"]).toBe(ops.englishHash("Hello there"))
  })

  it("records a new key and deletes a value that no record explains", () => {
    const s = state({
      source: { "A.new": "New" },
      catalogs: { es: { "A.new": "Nuevo" } },
      record: {},
    })
    const result = ops.invalidateChangedKeys(s)
    expect(result.unrecorded).toEqual(["A.new"])
    expect(s.catalogs.es).toEqual({})
    expect(s.record.englishHashes).toEqual({ "A.new": ops.englishHash("New") })
  })

  it("keeps a translation whose English still matches its record", () => {
    const s = state({
      source: { "A.a": "Hello" },
      catalogs: { es: { "A.a": "Hola" } },
    })
    expect(ops.invalidateChangedKeys(s)).toEqual({
      changed: [],
      unrecorded: [],
      deleted: {},
    })
    expect(s.catalogs.es).toEqual({ "A.a": "Hola" })
  })
})

describe("predictKeys and planRun (step 4)", () => {
  const source = {
    "A.fine": "Hello",
    "A.missing": "Missing",
    "A.copy": "Copy",
    "A.count": "{count, plural, one {# video} other {# videos}}",
    "A.brand": "BibleProject",
  }

  it("uses the script's predicate: missing, English copies, and contract failures", () => {
    const keys = ops.predictKeys({
      sourceFlat: source,
      catalogFlat: {
        "A.fine": "Hola",
        "A.copy": "Copy",
        "A.count": "{count} vídeos",
        "A.brand": "BibleProject",
      },
      neutral: new Set(["A.brand"]),
      messageContractError: contractError,
    })
    expect(keys).toEqual(["A.missing", "A.copy", "A.count"])
  })

  it("groups locales by model and leaves out a locale with nothing to do", () => {
    const s = state({
      source: { "A.a": "Hello" },
      catalogs: { ar: {}, es: {}, fr: { "A.a": "Bonjour" } },
    })
    const plan = ops.planRun(s, {
      locales: ["es", "fr", "ar"],
      modelFor: (locale) => (locale === "ar" ? "gpt-5.6" : "gpt-mini"),
      messageContractError: contractError,
    })
    expect(plan.groups).toEqual([
      { model: "gpt-5.6", keysByLocale: { ar: ["A.a"] } },
      { model: "gpt-mini", keysByLocale: { es: ["A.a"] } },
    ])
    expect(plan.upToDate).toEqual(["fr"])
  })
})

describe("settlePendingKeys (step 6)", () => {
  it("removes a pending key only when every translated locale is complete", () => {
    const s = state({
      source: { "A.a": "Hello", "A.b": "Bye" },
      catalogs: {
        es: { "A.a": "Hola", "A.b": "Adiós" },
        fr: { "A.a": "Bonjour", "A.b": "Bye" },
        crk: { "A.a": "Hello", "A.b": "Bye" },
      },
      policy: {
        englishOnlyLocales: ["crk"],
        pendingKeys: { "A.a": "2026-09-01", "A.b": "2026-09-01" },
      },
    })
    expect(ops.settlePendingKeys(s, contractError)).toEqual(["A.a"])
    expect(s.policy.pendingKeys).toEqual({ "A.b": "2026-09-01" })
  })
})

describe("markPending", () => {
  it("writes the new English of a changed key into every translated locale", () => {
    const s = state({
      source: { "A.a": "Hello there" },
      catalogs: {
        es: { "A.a": "Hola" },
        fr: {},
        crk: { "A.a": "Hello" },
      },
      record: { "A.a": ops.englishHash("Hello") },
      policy: { englishOnlyLocales: ["crk"] },
    })
    const result = ops.markPending(s, ["A.a"], "2026-09-29")
    expect(result).toEqual({ "A.a": { replaced: ["es"], filled: ["fr"] } })
    expect(s.catalogs.es["A.a"]).toBe("Hello there")
    expect(s.catalogs.fr["A.a"]).toBe("Hello there")
    expect(s.policy.pendingKeys).toEqual({ "A.a": "2026-09-29" })
    expect(s.record.englishHashes["A.a"]).toBe(ops.englishHash("Hello there"))
  })

  it("keeps a current translation, fills only the locales that lack the key, and keeps the first pending date", () => {
    const s = state({
      source: { "A.a": "Hello" },
      catalogs: { es: { "A.a": "Hola" }, fr: {} },
      policy: { pendingKeys: { "A.a": "2026-09-01" } },
    })
    expect(ops.markPending(s, ["A.a"], "2026-09-29")).toEqual({
      "A.a": { replaced: [], filled: ["fr"] },
    })
    expect(s.catalogs.es["A.a"]).toBe("Hola")
    expect(s.policy.pendingKeys["A.a"]).toBe("2026-09-01")
  })

  it("refuses an unknown key and a locale-neutral key", () => {
    const s = state({
      source: { "A.a": "Hello" },
      policy: { intentionallyLocaleNeutral: ["A.a"] },
    })
    expect(() => ops.markPending(s, ["A.nope"], "2026-09-29")).toThrow(
      /A\.nope/,
    )
    expect(() => ops.markPending(s, ["A.a"], "2026-09-29")).toThrow(
      /locale-neutral/,
    )
  })
})

describe("restamp", () => {
  it("records a key that no translated locale contradicts", () => {
    const s = state({
      source: { "A.a": "Hello", "A.b": "Bye" },
      catalogs: { es: { "A.b": "Bye" } },
      record: { "A.gone": "0".repeat(16) },
    })
    expect(ops.restamp(s)).toEqual({
      stamped: ["A.a", "A.b"],
      refused: [],
      removed: ["A.gone"],
    })
    expect(s.record.englishHashes).toEqual({
      "A.a": ops.englishHash("Hello"),
      "A.b": ops.englishHash("Bye"),
    })
  })

  it("refuses a changed key while a locale holds a translation of the old English", () => {
    const s = state({
      source: { "A.a": "Hello there" },
      catalogs: { es: { "A.a": "Hola" }, fr: { "A.a": "Hello there" } },
      record: { "A.a": ops.englishHash("Hello") },
    })
    expect(ops.restamp(s).refused).toEqual([{ key: "A.a", locales: ["es"] }])
    expect(s.record.englishHashes["A.a"]).toBe(ops.englishHash("Hello"))
  })
})

describe("progressFileName", () => {
  const base = {
    messagesDir: "/repo/apps/mobile/messages",
    sourceFlat: { "A.a": "Hello" },
    policy: { pendingKeys: {} },
    model: "gpt-5.4-mini-2026-03-17",
  }

  it("names the English digest, the policy digest, and the model, and changes with each", () => {
    const name = ops.progressFileName(base)
    expect(name).toMatch(
      /^forge-mobile-ui-[0-9a-f]{8}-en[0-9a-f]{12}-policy[0-9a-f]{12}-gpt-5\.4-mini-2026-03-17\.json$/,
    )
    expect(
      ops.progressFileName({ ...base, sourceFlat: { "A.a": "Hi" } }),
    ).not.toBe(name)
    expect(
      ops.progressFileName({ ...base, policy: { pendingKeys: { x: "y" } } }),
    ).not.toBe(name)
    expect(ops.progressFileName({ ...base, model: "gpt-5.6" })).not.toBe(name)
  })
})
