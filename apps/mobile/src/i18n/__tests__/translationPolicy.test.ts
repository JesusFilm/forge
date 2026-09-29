// The pipeline's own files: the policy, the contexts, the model table, the stub
// manifest, and the provenance (KTD6, KTD8). Namespaces come from en.json at
// test time, so a new namespace without a context sentence fails here.
import {
  catalogTagsIn,
  contextProblems,
  manifestProblems,
  modelTableProblems,
  policyProblems,
  provenanceProblems,
  readCatalogDir,
  readJson,
  readPolicy,
  REAL_PATHS,
} from "../../../scripts/i18n/lib/catalogChecks"

const { source, catalogs } = readCatalogDir(REAL_PATHS.messagesDir)
const webTags = catalogTagsIn(REAL_PATHS.webMessagesDir)
const realPolicy = readPolicy(REAL_PATHS.policy)

type ModelTable = { defaultModel: string; locales: Record<string, string> }
type Contexts = { namespaces: Record<string, string> }
type Provenance = { machineTranslatedLocales: Record<string, unknown> }

describe("translation-policy.json", () => {
  it("is valid for the mobile command and web's --policy loader", () => {
    expect(
      policyProblems(readJson(REAL_PATHS.policy), source, webTags),
    ).toEqual([])
  })

  it("keeps the same English-only locales as web", () => {
    const webManifest = readJson(REAL_PATHS.webManifest) as {
      provisionalLocales: string[]
    }
    expect(realPolicy.englishOnlyLocales).toEqual(
      [...webManifest.provisionalLocales].sort(),
    )
  })

  it.each([
    [
      { pendingKeys: { "Common.nope": "2026-09-01" } },
      "pendingKeys: Common.nope is not in en.json",
    ],
    [
      { pendingKeys: { "Common.a": "01/09/2026" } },
      "pendingKeys.Common.a must be a YYYY-MM-DD date",
    ],
    [
      {
        intentionallyLocaleNeutral: ["Common.a"],
        pendingKeys: { "Common.a": "2026-09-01" },
      },
      "pendingKeys: Common.a is locale-neutral, so it cannot be pending",
    ],
    [
      { englishOnlyLocales: ["xx"] },
      "englishOnlyLocales: xx has no web catalog",
    ],
    [{ humanReviewedLocales: [] }, "humanReviewedLocales must include en"],
  ])("fails a bad policy %#", (over, problem) => {
    const raw = { humanReviewedLocales: ["en"], ...over }
    expect(policyProblems(raw, { "Common.a": "A" }, ["en", "crk"])).toEqual([
      expect.stringContaining(problem),
    ])
  })
})

describe("translation-contexts.json", () => {
  const contexts = readJson(REAL_PATHS.contexts)

  it("has a sentence for every namespace in en.json, and no unknown override", () => {
    expect(contextProblems(contexts, source)).toEqual([])
    const namespaces = [
      ...new Set(Object.keys(source).map((key) => key.split(".")[0])),
    ]
    expect(namespaces.length).toBeGreaterThan(0)
    for (const namespace of namespaces) {
      expect((contexts as Contexts).namespaces[namespace]).toEqual(
        expect.any(String),
      )
    }
  })

  it("fails a namespace with no sentence, and names the namespace", () => {
    expect(
      contextProblems(
        { product: "an app", namespaces: { Common: "Shared labels." } },
        { "Common.a": "A", "Player.play": "Play" },
      ),
    ).toEqual(["no sentence for namespace Player (add namespaces.Player)"])
  })

  it("fails an override for a key that en.json lacks, and an unknown field", () => {
    expect(
      contextProblems(
        {
          product: "an app",
          namespaces: { Common: "Shared labels." },
          keys: { "Common.gone": { tone: "warm" } },
        },
        { "Common.a": "A" },
      ),
    ).toEqual([
      "keys.Common.gone is not in en.json",
      "keys.Common.gone.tone must be a non-empty role, visibility, or composition",
    ])
  })
})

describe("model-table.json", () => {
  const table = readJson(REAL_PATHS.modelTable) as ModelTable

  it("names only OpenAI API model IDs, for translated web catalogs", () => {
    expect(
      modelTableProblems(table, webTags, realPolicy.englishOnlyLocales),
    ).toEqual([])
    expect(JSON.stringify(table)).not.toContain("codex-local-agent")
  })

  it("pins a real API model for the Chinese catalogs", () => {
    for (const tag of ["zh", "zh-Hans", "zh-Hant"]) {
      expect(table.locales[tag]).toMatch(/^gpt-/)
    }
  })

  it("fails a model that is not an API model ID", () => {
    expect(
      modelTableProblems(
        {
          defaultModel: "gpt-5.4-mini-2026-03-17",
          locales: { zh: "codex-local-agent" },
        },
        ["en", "zh"],
        [],
      ),
    ).toEqual(['locales.zh "codex-local-agent" is not an OpenAI API model ID'])
  })
})

describe("script-manifest.json", () => {
  it("is a stub with no provisional and no machine-translated locale", () => {
    expect(manifestProblems(readJson(REAL_PATHS.manifest))).toEqual([])
  })

  it("fails a stub that carries a machine-translated list", () => {
    expect(
      manifestProblems({
        authoredInventoryLocales: [],
        provisionalLocales: [],
        existingNonInventoryLocales: [],
        missingCatalogs: [],
        machineTranslatedLocales: ["es"],
      }),
    ).toEqual([
      "machineTranslatedLocales must be absent; provenance lives in translation-provenance.json",
    ])
  })
})

describe("translation-provenance.json", () => {
  const provenance = readJson(REAL_PATHS.provenance) as Provenance

  it("records only machine-translated locales that have a catalog", () => {
    expect(provenanceProblems(provenance, realPolicy)).toEqual([])
    for (const locale of Object.keys(provenance.machineTranslatedLocales)) {
      expect(Object.keys(catalogs)).toContain(locale)
    }
  })

  it("fails an entry without an API model or a date", () => {
    expect(
      provenanceProblems(
        {
          reviewStatus: "machine-translated",
          machineTranslatedLocales: { es: { model: "codex-local-agent" } },
        },
        realPolicy,
      ),
    ).toEqual([
      "es.model must be an OpenAI API model ID",
      "es.generatedOn must be a YYYY-MM-DD date",
    ])
  })
})
