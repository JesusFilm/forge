import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"

import {
  contentDigest,
  flattenCatalog,
  main,
  sourceDigestForFlatCatalog,
  updateManifestAfterTranslation,
  validateCatalogIntegrity,
} from "./translate-ui-catalogs.mjs"
import {
  buildUserPrompt,
  explicitScriptContractError,
  isSourceEquivalent,
  messageContractError,
  requestTranslations,
} from "./openai-catalog-translator.mjs"
import {
  COMPLETED_CATALOG_POLICY,
  PROVISIONAL_CATALOG_POLICY,
} from "./ui-catalog-policy.mjs"

const MODEL = "gpt-5.4-mini-2026-03-17"
const temporaryDirectories = []

describe("Watch search contextual translation contract", () => {
  it("supplies each message with its UI surface and copy role", () => {
    const prompt = JSON.parse(
      buildUserPrompt({
        locale: "zh-Hans",
        inventoryEntry: { countries: [{ name: "China" }] },
        messages: {
          "WatchUnavailableLanguage.title":
            "<contentTitle>{title}</contentTitle> is not available in <languageName>{language}</languageName>",
          "DownloadModal.signInToDownload": "Sign in to download",
        },
        references: {},
      }),
    )

    expect(prompt.messageContexts).toEqual({
      "WatchUnavailableLanguage.title": expect.objectContaining({
        surface: expect.stringContaining("recovery page"),
        role: "page heading",
      }),
      "DownloadModal.signInToDownload": expect.objectContaining({
        surface: expect.stringContaining("download dialog"),
        role: "action label",
      }),
    })
  })

  it("identifies accessibility-only copy that cannot be inferred from its key", () => {
    const prompt = JSON.parse(
      buildUserPrompt({
        locale: "zh-Hans",
        inventoryEntry: { countries: [{ name: "China" }] },
        messages: {
          "BibleQuotes.previousQuote": "Previous Bible quote",
          "WatchUnavailableLanguage.languageVersionLabel": "Audio language",
        },
        references: {},
      }),
    )

    expect(prompt.messageContexts).toEqual({
      "BibleQuotes.previousQuote": expect.objectContaining({
        role: "carousel navigation accessibility label",
        visibility: "assistive technology only",
      }),
      "WatchUnavailableLanguage.languageVersionLabel": expect.objectContaining({
        role: "audio-language selector accessibility label",
        visibility: "assistive technology only",
      }),
    })
  })

  it("distinguishes status and error copy from similarly named actions", () => {
    const prompt = JSON.parse(
      buildUserPrompt({
        locale: "zh-Hans",
        inventoryEntry: { countries: [{ name: "China" }] },
        messages: {
          "BetaTesterModal.loading": "Loading...",
          "SearchOverlay.loadMoreFailed": "Failed to load more results.",
          "CollectionDownloadModal.signInTitle": "Sign in to download",
          "ShareModal.shareOnXUnavailable":
            "Share on X (unavailable on this build)",
        },
        references: {},
      }),
    )

    expect(prompt.messageContexts).toEqual({
      "BetaTesterModal.loading": expect.objectContaining({
        role: "status message",
      }),
      "SearchOverlay.loadMoreFailed": expect.objectContaining({
        role: "error or unavailable-state message",
      }),
      "CollectionDownloadModal.signInTitle": expect.objectContaining({
        role: "download authentication heading",
      }),
      "ShareModal.shareOnXUnavailable": expect.objectContaining({
        role: "disabled action label",
      }),
    })
  })

  it("uses authoritative roles for controls, alt text, and section headings", () => {
    const prompt = JSON.parse(
      buildUserPrompt({
        locale: "zh-Hans",
        inventoryEntry: { countries: [{ name: "China" }] },
        messages: {
          "WatchUnavailableLanguage.audioVersionsTitle": "Other audio versions",
          "WatchHome.mutePreview": "Mute preview",
          "DownloadModal.posterAlt": "Video poster",
          "LanguagePickerModal.translateWithAi": "Translate with AI",
        },
        references: {},
      }),
    )

    expect(prompt.messageContexts).toEqual({
      "WatchUnavailableLanguage.audioVersionsTitle": expect.objectContaining({
        role: "section heading",
      }),
      "WatchHome.mutePreview": expect.objectContaining({
        role: "video-preview accessibility action label",
        visibility: "assistive technology only",
      }),
      "DownloadModal.posterAlt": expect.objectContaining({
        role: "image alternative text",
      }),
      "LanguagePickerModal.translateWithAi": expect.objectContaining({
        role: "action label",
      }),
    })
  })

  it("describes strings that components compose with runtime values", () => {
    const prompt = JSON.parse(
      buildUserPrompt({
        locale: "zh-Hans",
        inventoryEntry: { countries: [{ name: "China" }] },
        messages: {
          "LanguagePickerModal.noSubtitles": "No subtitles",
          "LanguagePickerModal.toggleOn": "On",
          "HeroPlayerControls.changeAudioLanguage": "Change audio language",
          "SubtitleTranscript.aiSuffix": " · AI",
        },
        references: {},
      }),
    )

    expect(prompt.messageContexts).toEqual({
      "LanguagePickerModal.noSubtitles": expect.objectContaining({
        role: "subtitle unavailable-state message",
        composition: expect.stringContaining("languageName"),
      }),
      "LanguagePickerModal.toggleOn": expect.objectContaining({
        role: "toggle state label",
        composition: expect.stringContaining("language code"),
      }),
      "HeroPlayerControls.changeAudioLanguage": expect.objectContaining({
        role: "player-control accessibility action label",
        composition: expect.stringContaining("languageCode"),
      }),
      "SubtitleTranscript.aiSuffix": expect.objectContaining({
        role: "AI-generated subtitle marker",
        composition: expect.stringContaining("subtitle language name"),
      }),
    })
  })

  it("identifies player slider copy as assistive-only labels and values", () => {
    const prompt = JSON.parse(
      buildUserPrompt({
        locale: "zh-Hans",
        inventoryEntry: { countries: [{ name: "China" }] },
        messages: {
          "HeroPlayerControls.seek": "Seek",
          "HeroPlayerControls.seekValue": "{current} of {total}",
          "HeroPlayerControls.volume": "Volume",
          "HeroPlayerControls.volumeValue": "{percent} percent",
        },
        references: {},
      }),
    )

    expect(prompt.messageContexts).toEqual({
      "HeroPlayerControls.seek": expect.objectContaining({
        role: "timeline slider accessibility label",
        visibility: "assistive technology only",
      }),
      "HeroPlayerControls.seekValue": expect.objectContaining({
        role: "timeline slider accessibility value",
        visibility: "assistive technology only",
      }),
      "HeroPlayerControls.volume": expect.objectContaining({
        role: "volume slider accessibility label",
        visibility: "assistive technology only",
      }),
      "HeroPlayerControls.volumeValue": expect.objectContaining({
        role: "volume slider accessibility value",
        visibility: "assistive technology only",
      }),
    })
  })

  it("tells the translator to judge composed messages after rendering", () => {
    const prompt = JSON.parse(
      buildUserPrompt({
        locale: "zh-Hans",
        inventoryEntry: { countries: [{ name: "China" }] },
        messages: {
          "WatchUnavailableLanguage.title":
            "<contentTitle>{title}</contentTitle> is not available in <languageName>{language}</languageName>",
        },
        references: {},
      }),
    )

    expect(
      prompt.messageContexts["WatchUnavailableLanguage.title"].composition,
    ).toContain("complete rendered message")
    expect(prompt.targetLanguageWritingInstructions).toEqual(
      expect.arrayContaining([
        expect.stringContaining("mentally render representative values"),
        expect.stringContaining("screen reader"),
      ]),
    )
  })

  it("supplies omitted neighboring source messages from the same UI namespace", () => {
    const prompt = JSON.parse(
      buildUserPrompt({
        locale: "zh-Hans",
        inventoryEntry: { countries: [{ name: "China" }] },
        messages: {
          "BibleQuotes.joinBibleStudy": "Join our Bible study",
        },
        references: {},
        sourceMessages: {
          "BibleQuotes.promoHeading":
            "Want to understand the Bible more deeply?",
          "BibleQuotes.joinBibleStudy": "Join our Bible study",
          "SearchOverlay.noResults": "No results found",
        },
      }),
    )

    expect(prompt.surroundingSourceMessages).toEqual({
      "BibleQuotes.promoHeading": "Want to understand the Bible more deeply?",
    })
  })

  it("does not duplicate source messages already being translated", () => {
    const messages = {
      "BibleQuotes.promoHeading": "Want to understand the Bible more deeply?",
      "BibleQuotes.joinBibleStudy": "Join our Bible study",
    }
    const prompt = JSON.parse(
      buildUserPrompt({
        locale: "zh-Hans",
        inventoryEntry: { countries: [{ name: "China" }] },
        messages,
        references: {},
        sourceMessages: messages,
      }),
    )

    expect(prompt.surroundingSourceMessages).toEqual({})
  })

  it("has explicit surface context for every current catalog namespace", () => {
    const source = JSON.parse(
      readFileSync(join(process.cwd(), "messages/en.json"), "utf8"),
    )
    const messages = flattenCatalog(source)
    const prompt = JSON.parse(
      buildUserPrompt({
        locale: "zh-Hans",
        inventoryEntry: { countries: [{ name: "China" }] },
        messages,
        references: {},
      }),
    )

    expect(Object.keys(prompt.messageContexts)).toEqual(Object.keys(messages))
    expect(
      Object.values(prompt.messageContexts).filter(({ surface }) =>
        surface.endsWith("area of the Watch experience"),
      ),
    ).toEqual([])
  })

  it("adds universal localization guidance and keeps Chinese-specific guidance scoped", () => {
    const chinesePrompt = JSON.parse(
      buildUserPrompt({
        locale: "zh-Hans",
        inventoryEntry: { countries: [{ name: "China" }] },
        messages: { "ExperienceError.pageLoadFailed": "Something went wrong." },
        references: {},
      }),
    )
    const russianPrompt = JSON.parse(
      buildUserPrompt({
        locale: "ru",
        inventoryEntry: { countries: [{ name: "Russia" }] },
        messages: { "ExperienceError.pageLoadFailed": "Something went wrong." },
        references: {},
      }),
    )

    expect(chinesePrompt.targetLanguageWritingInstructions).toEqual(
      expect.arrayContaining([
        expect.stringContaining("native product writer in the target language"),
        expect.stringContaining("established Christian terminology"),
        expect.stringContaining("reference materials"),
        expect.stringContaining("English sentence structure"),
        expect.stringContaining("verb to verb"),
        expect.stringContaining("X后Y or X并Y"),
        expect.stringContaining("biblical metaphor"),
        expect.stringContaining("word for word"),
        expect.stringContaining("exact failure category"),
        expect.stringContaining("original-language source"),
        expect.stringContaining("self-contained"),
        expect.stringContaining("equivalent target-catalog copy"),
        expect.stringContaining("Traditional Chinese vocabulary"),
        expect.stringContaining("Do not add product claims"),
      ]),
    )
    expect(russianPrompt.targetLanguageWritingInstructions).toEqual(
      expect.arrayContaining([
        expect.stringContaining("native product writer in the target language"),
        expect.stringContaining("established Christian terminology"),
        expect.stringContaining("reference materials"),
        expect.stringContaining("biblical metaphor"),
        expect.stringContaining("Do not add product claims"),
      ]),
    )
    expect(russianPrompt.targetLanguageWritingInstructions).not.toEqual(
      expect.arrayContaining([
        expect.stringContaining("originally written in Chinese"),
        expect.stringContaining("Traditional Chinese vocabulary"),
      ]),
    )
  })

  it("adds authoritative context for Chinese error, scripture, and sign-in copy", () => {
    const prompt = JSON.parse(
      buildUserPrompt({
        locale: "zh-Hans",
        inventoryEntry: { countries: [{ name: "China" }] },
        messages: {
          "ExperienceError.authFailed":
            "Unable to authenticate with the content service. Please contact support if this persists.",
          "WatchHomePromo.buildingNext": "What we are building next",
          "WatchHomeSections.scriptureAsWrittenTitle":
            "Scripture, Spoken Exactly as Written",
          "CollectionDownloadModal.signIn": "Sign in to download",
        },
        references: {},
      }),
    )

    expect(prompt.messageContexts).toEqual({
      "ExperienceError.authFailed": expect.objectContaining({
        role: "authentication failure message",
      }),
      "WatchHomePromo.buildingNext": expect.objectContaining({
        role: "heading introducing the following feature cards",
      }),
      "WatchHomeSections.scriptureAsWrittenTitle": expect.objectContaining({
        composition: expect.stringContaining("does not refer"),
      }),
      "CollectionDownloadModal.signIn": expect.objectContaining({
        composition: expect.stringContaining("returns them to the dialog"),
      }),
    })
  })

  it("supplies the model with action, status, heading, and language-chip context", () => {
    const prompt = JSON.parse(
      buildUserPrompt({
        locale: "ru",
        inventoryEntry: { countries: [{ name: "Russia" }] },
        messages: {
          "SearchOverlay.searchSuggestionWithLanguage":
            'Search in {language} for "{suggestion}"',
        },
        references: {},
      }),
    )

    expect(prompt.contextualInstructions).toEqual(
      expect.arrayContaining([
        expect.stringContaining("heading above proposed search phrases"),
        expect.stringContaining("clickable action"),
        expect.stringContaining("static scope label"),
        expect.stringContaining("must not say that a search is active"),
        expect.stringContaining("natural native-language interface writing"),
        expect.stringContaining("Case particles, postpositions"),
      ]),
    )
  })

  it("rejects loading-style copy for the completed-results status", () => {
    expect(
      messageContractError(
        "SearchOverlay.searchingInLanguage",
        "Searching in {language}",
        "Результаты поиска. Язык: {language}",
      ),
    ).toBeNull()
    expect(
      messageContractError(
        "SearchOverlay.searchingInLanguage",
        "Searching in {language}",
        "Searching in {language}…",
      ),
    ).toContain("must not look like loading copy")
  })

  it("allows target-language grammar immediately around the language chip", () => {
    const source = "Search in {language}"

    expect(
      messageContractError(
        "SearchOverlay.searchInLanguage",
        source,
        "Язык поиска: {language}",
      ),
    ).toBeNull()
    expect(
      messageContractError(
        "SearchOverlay.searchInLanguage",
        source,
        "{language}ত সন্ধান কৰক",
      ),
    ).toBeNull()
  })

  it("rejects translations that ignore an explicit script subtag", () => {
    expect(
      explicitScriptContractError("az-Cyrl", {
        "SearchOverlay.searchSuggestions": "Axtarış təklifləri",
      }),
    ).toContain("Explicit Cyrl script mismatch")
    expect(
      explicitScriptContractError("az-Cyrl", {
        "SearchOverlay.searchSuggestions": "Ахтарыш теклифлери",
      }),
    ).toBeNull()
  })
})

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)
}

function sourceCatalog() {
  return {
    common: Object.fromEntries(
      Array.from({ length: 20 }, (_, index) => [
        `message${index}`,
        `Message ${index}`,
      ]),
    ),
  }
}

function translatedCatalog(source) {
  return {
    common: Object.fromEntries(
      Object.entries(source.common).map(([key], index) => [
        key,
        `Mensaje ${index}`,
      ]),
    ),
  }
}

function createBatchFixture({
  source = sourceCatalog(),
  catalogs,
  manifest,
  progress,
  selectedLocales = Object.keys(catalogs),
  concurrency = 1,
}) {
  const root = mkdtempSync(join(tmpdir(), "watch-ui-translator-"))
  temporaryDirectories.push(root)
  const messagesDir = join(root, "messages")
  mkdirSync(messagesDir)

  const sourceFlat = flattenCatalog(source)
  const inventoryPath = join(root, "inventory.json")
  const manifestPath = join(root, "manifest.json")
  const progressPath = join(root, "progress.json")

  writeJson(join(messagesDir, "en.json"), source)
  for (const [locale, catalog] of Object.entries(catalogs)) {
    writeJson(join(messagesDir, `${locale}.json`), catalog)
  }
  writeJson(inventoryPath, {
    languages: Object.keys(catalogs).map((tag) => ({
      tag,
      countries: [{ name: tag.toUpperCase() }],
    })),
  })
  writeJson(manifestPath, manifest)
  writeJson(progressPath, {
    ...progress,
    model: MODEL,
    sourceDigest: sourceDigestForFlatCatalog(sourceFlat),
  })

  return {
    args: [
      "node",
      "translate-ui-catalogs.mjs",
      "--messages-dir",
      messagesDir,
      "--inventory",
      inventoryPath,
      "--manifest",
      manifestPath,
      "--progress",
      progressPath,
      "--model",
      MODEL,
      "--locales",
      selectedLocales.join(","),
      "--concurrency",
      String(concurrency),
    ],
    manifestPath,
    messagesDir,
    progressPath,
    source,
  }
}

function createFixture({
  source = sourceCatalog(),
  currentCatalog,
  progressCatalog,
}) {
  return createBatchFixture({
    source,
    catalogs: { es: currentCatalog },
    manifest: {
      metadata: {},
      authoredInventoryLocales: [],
      machineTranslatedLocales: [],
      provisionalLocales: ["es"],
      existingNonInventoryLocales: [],
      missingCatalogs: [],
    },
    progress: {
      completedLocales: ["es"],
      generatedLocales: ["es"],
      catalogDigests: {
        es: contentDigest(flattenCatalog(progressCatalog)),
      },
      usage: {},
    },
    selectedLocales: ["es"],
  })
}

function chatCompletion(translations) {
  return new Response(
    JSON.stringify({
      choices: [
        {
          message: {
            content: JSON.stringify({ translations }),
          },
        },
      ],
      usage: {
        prompt_tokens: 10,
        completion_tokens: 5,
        total_tokens: 15,
      },
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  )
}

function promptFromRequest(options) {
  const requestBody = JSON.parse(options.body)
  return JSON.parse(requestBody.messages[1].content)
}

function translatedPromptResponse(options, prefix) {
  const prompt = promptFromRequest(options)
  return chatCompletion(
    Object.keys(prompt.messagesToTranslate).map((key) => ({
      key,
      value: `${prefix} ${key}`,
    })),
  )
}

function unreadableErrorResponse(status) {
  return {
    ok: false,
    status,
    headers: new Headers(),
    text: vi.fn().mockRejectedValue(new Error("response stream aborted")),
  }
}

function withLocales(args, locales, promote = false) {
  const nextArgs = [...args]
  nextArgs[nextArgs.indexOf("--locales") + 1] = locales.join(",")
  if (promote) nextArgs.push("--promote")
  return nextArgs
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  process.exitCode = undefined
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe("translate UI catalogs", () => {
  it("accepts an empty translation only when its English source is empty", () => {
    const key = "DownloadModal.termsAgreementSuffix"

    expect(() =>
      validateCatalogIntegrity({ [key]: "" }, { [key]: "" }, 0),
    ).not.toThrow()
    expect(() =>
      validateCatalogIntegrity({ [key]: "Terms apply" }, { [key]: "" }, 0),
    ).toThrow(`Empty translation: ${key}`)
  })

  it("allows an explicitly locale-neutral source copy", () => {
    const key = "WatchHomeMuxInserts.datedTitle"
    const value = "{date}: {title}"

    expect(() =>
      validateCatalogIntegrity({ [key]: value }, { [key]: value }, 0),
    ).not.toThrow()
  })

  it("reprocesses a completed catalog that retains one English source copy", async () => {
    const source = sourceCatalog()
    const currentCatalog = translatedCatalog(source)
    currentCatalog.common.message19 = source.common.message19
    const fixture = createFixture({
      currentCatalog,
      progressCatalog: currentCatalog,
    })
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        chatCompletion([
          { key: "common.message19", value: "Mensaje diecinueve" },
        ]),
      )
    vi.stubGlobal("fetch", fetchMock)
    vi.spyOn(console, "log").mockImplementation(() => {})
    vi.spyOn(console, "warn").mockImplementation(() => {})

    await main({
      args: fixture.args,
      environment: { OPENAI_API_KEY: "test-api-key" },
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(
      JSON.parse(readFileSync(join(fixture.messagesDir, "es.json"), "utf-8"))
        .common.message19,
    ).toBe("Mensaje diecinueve")
  })

  it("limits a stale-provenance refresh to explicitly requested keys", async () => {
    const source = sourceCatalog()
    source.other = { unrelated: "Unrelated message" }
    const catalog = translatedCatalog(source)
    catalog.other = { unrelated: "Mensaje no relacionado" }
    const fixture = createBatchFixture({
      source,
      catalogs: { es: catalog },
      manifest: {
        metadata: {
          translation: {
            localeProvenance: {
              es: {
                model: "gpt-old-primary",
                sourceDigest: "old-source",
                catalogDigest: "old-catalog",
                generatedOn: "2026-07-01",
              },
            },
          },
        },
        authoredInventoryLocales: ["es"],
        machineTranslatedLocales: ["es"],
        provisionalLocales: [],
        existingNonInventoryLocales: [],
        missingCatalogs: [],
      },
      progress: {
        completedLocales: [],
        generatedLocales: [],
        catalogDigests: {},
        usage: {},
      },
    })
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        chatCompletion([
          { key: "common.message19", value: "Mensaje diecinueve" },
        ]),
      )
    vi.stubGlobal("fetch", fetchMock)
    vi.spyOn(console, "log").mockImplementation(() => {})

    await main({
      args: [...fixture.args, "--keys", "common.message19"],
      environment: { OPENAI_API_KEY: "test-api-key" },
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(
      Object.keys(
        promptFromRequest(fetchMock.mock.calls[0][1]).messagesToTranslate,
      ),
    ).toEqual(["common.message19"])
    expect(
      Object.keys(
        promptFromRequest(fetchMock.mock.calls[0][1])
          .existingReferenceTranslations,
      ),
    ).toHaveLength(19)
    expect(
      promptFromRequest(fetchMock.mock.calls[0][1])
        .existingReferenceTranslations,
    ).not.toHaveProperty("other.unrelated")
    expect(
      Object.keys(
        promptFromRequest(fetchMock.mock.calls[0][1]).surroundingSourceMessages,
      ),
    ).toEqual(
      Object.keys(source.common)
        .filter((key) => key !== "message19")
        .map((key) => `common.${key}`),
    )
    expect(
      promptFromRequest(fetchMock.mock.calls[0][1]).surroundingSourceMessages,
    ).not.toHaveProperty("other.unrelated")
  })

  it("reprocesses an explicitly requested key for a completed current catalog", async () => {
    const source = sourceCatalog()
    const catalog = translatedCatalog(source)
    const fixture = createFixture({
      currentCatalog: catalog,
      progressCatalog: catalog,
    })
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        chatCompletion([
          { key: "common.message19", value: "Mensaje diecinueve" },
        ]),
      )
    vi.stubGlobal("fetch", fetchMock)
    vi.spyOn(console, "log").mockImplementation(() => {})

    await main({
      args: [...fixture.args, "--keys", "common.message19"],
      environment: { OPENAI_API_KEY: "test-api-key" },
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(
      Object.keys(
        promptFromRequest(fetchMock.mock.calls[0][1]).messagesToTranslate,
      ),
    ).toEqual(["common.message19"])
  })

  it("promotes scoped translations only when prior drift is limited to those keys", async () => {
    const source = sourceCatalog()
    const sourceFlat = flattenCatalog(source)
    const catalog = translatedCatalog(source)
    const scopedBaselineDigest = sourceDigestForFlatCatalog(
      Object.fromEntries(
        Object.entries(sourceFlat).filter(
          ([key]) => key !== "common.message19",
        ),
      ),
    )
    const fixture = createBatchFixture({
      source,
      catalogs: { es: catalog },
      manifest: {
        metadata: {
          translation: {
            localeProvenance: {
              es: {
                model: "gpt-old-primary",
                sourceDigest: scopedBaselineDigest,
                catalogDigest: contentDigest(flattenCatalog(catalog)),
                generatedOn: "2026-07-01",
              },
            },
          },
        },
        authoredInventoryLocales: ["es"],
        machineTranslatedLocales: ["es"],
        provisionalLocales: [],
        existingNonInventoryLocales: [],
        missingCatalogs: [],
      },
      progress: {
        completedLocales: [],
        generatedLocales: [],
        catalogDigests: {},
        usage: {},
      },
    })
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        chatCompletion([
          { key: "common.message19", value: "Mensaje diecinueve" },
        ]),
      )
    vi.stubGlobal("fetch", fetchMock)
    vi.spyOn(console, "log").mockImplementation(() => {})

    await main({
      args: [...fixture.args, "--keys", "common.message19", "--promote"],
      environment: { OPENAI_API_KEY: "test-api-key" },
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(
      JSON.parse(readFileSync(fixture.manifestPath, "utf-8")).metadata
        .translation.localeProvenance.es.sourceDigest,
    ).toBe(sourceDigestForFlatCatalog(sourceFlat))
  })

  it("rejects scoped promotion when source drift extends beyond requested keys", async () => {
    const source = sourceCatalog()
    const catalog = translatedCatalog(source)
    const fixture = createBatchFixture({
      source,
      catalogs: { es: catalog },
      manifest: {
        metadata: {
          translation: {
            localeProvenance: {
              es: {
                model: "gpt-old-primary",
                sourceDigest: "unrelated-source-digest",
                catalogDigest: contentDigest(flattenCatalog(catalog)),
                generatedOn: "2026-07-01",
              },
            },
          },
        },
        authoredInventoryLocales: ["es"],
        machineTranslatedLocales: ["es"],
        provisionalLocales: [],
        existingNonInventoryLocales: [],
        missingCatalogs: [],
      },
      progress: {
        completedLocales: [],
        generatedLocales: [],
        catalogDigests: {},
        usage: {},
      },
    })
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)

    await expect(
      main({
        args: [...fixture.args, "--keys", "common.message19", "--promote"],
        environment: { OPENAI_API_KEY: "test-api-key" },
      }),
    ).rejects.toThrow(
      "Cannot promote a scoped translation when prior source drift is not limited to --keys: es",
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("rejects unknown scoped keys before writing catalogs", async () => {
    const source = sourceCatalog()
    const catalog = translatedCatalog(source)
    const fixture = createFixture({
      currentCatalog: catalog,
      progressCatalog: catalog,
    })

    await expect(
      main({
        args: [...fixture.args, "--keys", "common.missing"],
        environment: { OPENAI_API_KEY: "test-api-key" },
      }),
    ).rejects.toThrow("Unknown message keys: common.missing")
    expect(
      JSON.parse(readFileSync(join(fixture.messagesDir, "es.json"), "utf-8")),
    ).toEqual(catalog)
  })

  it("rejects non-neutral English copies after case and format normalization", () => {
    expect(() =>
      validateCatalogIntegrity(
        { "common.greeting": "Hello" },
        { "common.greeting": "Hello" },
        0,
      ),
    ).toThrow("Catalog retains 1 exact English messages; maximum is 0")
    expect(() =>
      validateCatalogIntegrity(
        { "common.greeting": "Download" },
        { "common.greeting": "download\u200b" },
        0,
      ),
    ).toThrow(
      "Catalog retains 1 case/format-only English messages; maximum is 0",
    )
    expect(isSourceEquivalent("  Account", "account\u200b")).toBe(true)
  })

  it("retries when a successful response leaves a selected message unchanged", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        chatCompletion([{ key: "common.greeting", value: "Hello" }]),
      )
      .mockResolvedValueOnce(
        chatCompletion([{ key: "common.greeting", value: "Hola" }]),
      )
    const waitForRetry = vi.fn().mockResolvedValue(undefined)

    const result = await requestTranslations({
      apiKey: "test-api-key",
      locale: "es",
      inventoryEntry: { countries: [{ name: "Spain" }] },
      messages: { "common.greeting": "Hello" },
      references: {},
      model: MODEL,
      maxAttempts: 2,
      minimumChangeRatio: 1,
      fetchImpl,
      waitForRetry,
    })

    expect(result.translations).toEqual({ "common.greeting": "Hola" })
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(waitForRetry).toHaveBeenCalledTimes(1)
  })

  it("retries explicit-script mismatches before accepting the requested script", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        chatCompletion([
          {
            key: "SearchOverlay.searchSuggestions",
            value: "Axtarış təklifləri",
          },
        ]),
      )
      .mockResolvedValueOnce(
        chatCompletion([
          {
            key: "SearchOverlay.searchSuggestions",
            value: "Ахтарыш теклифлери",
          },
        ]),
      )
    const waitForRetry = vi.fn().mockResolvedValue(undefined)

    const result = await requestTranslations({
      apiKey: "test-api-key",
      locale: "az-Cyrl",
      inventoryEntry: { countries: [{ name: "Azerbaijan" }] },
      messages: { "SearchOverlay.searchSuggestions": "Search Suggestions" },
      references: {},
      model: MODEL,
      maxAttempts: 2,
      minimumChangeRatio: 1,
      fetchImpl,
      waitForRetry,
    })

    expect(result.translations).toEqual({
      "SearchOverlay.searchSuggestions": "Ахтарыш теклифлери",
    })
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(waitForRetry).toHaveBeenCalledTimes(1)
  })

  it("retries a malformed HTTP 200 body before accepting valid JSON", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        new Response("{", {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        chatCompletion([{ key: "common.greeting", value: "Hola" }]),
      )
    const waitForRetry = vi.fn().mockResolvedValue(undefined)

    const result = await requestTranslations({
      apiKey: "test-api-key",
      locale: "es",
      inventoryEntry: { countries: [{ name: "Spain" }] },
      messages: { "common.greeting": "Hello" },
      references: {},
      model: MODEL,
      maxAttempts: 2,
      minimumChangeRatio: 1,
      fetchImpl,
      waitForRetry,
    })

    expect(result.translations).toEqual({ "common.greeting": "Hola" })
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(waitForRetry).toHaveBeenCalledTimes(1)
    expect(waitForRetry.mock.calls[0][0]).toBeGreaterThan(0)
  })

  it("uses the Responses API contract for gpt-5.6 translation models", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          output: [
            {
              content: [
                {
                  type: "output_text",
                  text: JSON.stringify({
                    translations: [{ key: "common.greeting", value: "Hola" }],
                  }),
                },
              ],
            },
          ],
          usage: {
            input_tokens: 12,
            output_tokens: 7,
            total_tokens: 19,
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    )
    const timeoutSignal = new AbortController().signal
    const timeoutSpy = vi
      .spyOn(AbortSignal, "timeout")
      .mockReturnValue(timeoutSignal)

    const result = await requestTranslations({
      apiKey: "test-api-key",
      locale: "es",
      inventoryEntry: { countries: [{ name: "Spain" }] },
      messages: { "common.greeting": "Hello" },
      references: {},
      model: "gpt-5.6-sol",
      maxAttempts: 1,
      minimumChangeRatio: 1,
      fetchImpl,
    })

    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(fetchImpl.mock.calls[0][0]).toBe(
      "https://api.openai.com/v1/responses",
    )
    const request = JSON.parse(fetchImpl.mock.calls[0][1].body)
    expect(request).toMatchObject({
      model: "gpt-5.6-sol",
      store: false,
      max_output_tokens: 40_000,
      text: { format: { type: "json_schema" } },
    })
    expect(request.instructions).toContain("senior software localization")
    expect(JSON.parse(request.input).messagesToTranslate).toEqual({
      "common.greeting": "Hello",
    })
    expect(JSON.parse(request.input)).toMatchObject({
      targetLocale: "es",
      explicitScript: "not specified",
      defaultScript: "Latn",
    })
    expect(request.instructions).toContain(
      "Honor an explicit BCP-47 script subtag",
    )
    expect(timeoutSpy).toHaveBeenCalledWith(900_000)
    expect(result).toEqual({
      translations: { "common.greeting": "Hola" },
      usage: {
        prompt_tokens: 12,
        completion_tokens: 7,
        total_tokens: 19,
      },
    })
  })

  it("surfaces a Responses API refusal after retries are exhausted", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          output: [
            {
              content: [{ type: "refusal", refusal: "Cannot translate" }],
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    )

    await expect(
      requestTranslations({
        apiKey: "test-api-key",
        locale: "es",
        inventoryEntry: { countries: [{ name: "Spain" }] },
        messages: { "common.greeting": "Hello" },
        references: {},
        model: "gpt-5.6-sol",
        maxAttempts: 1,
        minimumChangeRatio: 1,
        fetchImpl,
      }),
    ).rejects.toThrow("Model refused: Cannot translate")
  })

  it("retries a retryable status when its response body cannot be read", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(unreadableErrorResponse(503))
      .mockResolvedValueOnce(
        chatCompletion([{ key: "common.greeting", value: "Hola" }]),
      )
    const waitForRetry = vi.fn().mockResolvedValue(undefined)

    const result = await requestTranslations({
      apiKey: "test-api-key",
      locale: "es",
      inventoryEntry: { countries: [{ name: "Spain" }] },
      messages: { "common.greeting": "Hello" },
      references: {},
      model: MODEL,
      maxAttempts: 2,
      minimumChangeRatio: 1,
      fetchImpl,
      waitForRetry,
    })

    expect(result.translations).toEqual({ "common.greeting": "Hola" })
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(waitForRetry).toHaveBeenCalledTimes(1)
  })

  it("keeps an unreadable permanent status non-retryable", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(unreadableErrorResponse(401))
    const waitForRetry = vi.fn().mockResolvedValue(undefined)

    await expect(
      requestTranslations({
        apiKey: "test-api-key",
        locale: "es",
        inventoryEntry: { countries: [{ name: "Spain" }] },
        messages: { "common.greeting": "Hello" },
        references: {},
        model: MODEL,
        maxAttempts: 2,
        minimumChangeRatio: 1,
        fetchImpl,
        waitForRetry,
      }),
    ).rejects.toThrow("OpenAI HTTP 401")

    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(waitForRetry).not.toHaveBeenCalled()
  })

  it("reprocesses a completed provisional catalog when its digest changes", async () => {
    const source = sourceCatalog()
    const progressCatalog = translatedCatalog(source)
    const currentCatalog = structuredClone(progressCatalog)
    currentCatalog.common.message19 = source.common.message19
    const fixture = createFixture({ currentCatalog, progressCatalog })
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        chatCompletion([
          { key: "common.message19", value: "Mensaje actualizado" },
        ]),
      )
    vi.stubGlobal("fetch", fetchMock)
    vi.spyOn(console, "log").mockImplementation(() => {})

    await main({
      args: fixture.args,
      environment: { OPENAI_API_KEY: "test-api-key" },
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const requestBody = JSON.parse(fetchMock.mock.calls[0][1].body)
    const userPayload = JSON.parse(requestBody.messages[1].content)
    expect(Object.keys(userPayload.messagesToTranslate)).toEqual([
      "common.message19",
    ])

    const updatedCatalog = JSON.parse(
      readFileSync(join(fixture.messagesDir, "es.json"), "utf-8"),
    )
    const updatedProgress = JSON.parse(
      readFileSync(fixture.progressPath, "utf-8"),
    )
    expect(updatedCatalog.common.message19).toBe("Mensaje actualizado")
    expect(updatedProgress.catalogDigests.es).toBe(
      contentDigest(flattenCatalog(updatedCatalog)),
    )
  })

  it("does not leak a concurrently failed locale into progress or promotion", async () => {
    const source = sourceCatalog()
    source.LanguageInventory = { bibleProject: "BibleProject" }
    const esCatalog = structuredClone(source)
    const frCatalog = structuredClone(source)
    frCatalog.LanguageInventory.bibleProject = ""
    const fixture = createBatchFixture({
      source,
      catalogs: { es: esCatalog, fr: frCatalog },
      manifest: {
        metadata: {},
        authoredInventoryLocales: [],
        machineTranslatedLocales: [],
        provisionalLocales: ["es", "fr"],
        existingNonInventoryLocales: [],
        missingCatalogs: [],
      },
      progress: {
        completedLocales: [],
        generatedLocales: [],
        catalogDigests: {},
        usage: {},
      },
      selectedLocales: ["es", "fr"],
      concurrency: 2,
    })
    let esRequestOptions
    let resolveEsResponse
    const esResponse = new Promise((resolve) => {
      resolveEsResponse = resolve
    })
    const fetchMock = vi.fn((_url, options) => {
      const prompt = promptFromRequest(options)
      if (prompt.targetLocale === "es") {
        esRequestOptions = options
        return esResponse
      }

      setTimeout(() => {
        resolveEsResponse(translatedPromptResponse(esRequestOptions, "ES"))
      }, 0)
      return Promise.resolve(translatedPromptResponse(options, "FR"))
    })
    vi.stubGlobal("fetch", fetchMock)
    vi.spyOn(console, "log").mockImplementation(() => {})
    vi.spyOn(console, "error").mockImplementation(() => {})

    await main({
      args: fixture.args,
      environment: { OPENAI_API_KEY: "test-api-key" },
    })

    const progress = JSON.parse(readFileSync(fixture.progressPath, "utf-8"))
    expect(progress.completedLocales).toEqual(["es"])
    expect(progress.generatedLocales).toEqual(["es"])
    expect(
      JSON.parse(readFileSync(join(fixture.messagesDir, "fr.json"), "utf-8")),
    ).toEqual(frCatalog)

    process.exitCode = undefined
    const noFetch = vi.fn()
    vi.stubGlobal("fetch", noFetch)
    await main({
      args: withLocales(fixture.args, ["es"], true),
      environment: { OPENAI_API_KEY: "test-api-key" },
    })

    const manifest = JSON.parse(readFileSync(fixture.manifestPath, "utf-8"))
    expect(noFetch).not.toHaveBeenCalled()
    expect(manifest.machineTranslatedLocales).toEqual(["es"])
    expect(manifest.provisionalLocales).toEqual(["fr"])
    expect(manifest.metadata.policy).toBe(PROVISIONAL_CATALOG_POLICY)
  })

  it("rejects drifted completed provisional catalogs before promotion", async () => {
    const source = sourceCatalog()
    const recordedEsCatalog = translatedCatalog(source)
    const currentEsCatalog = structuredClone(recordedEsCatalog)
    currentEsCatalog.common.message0 = "Edited after completion"
    const frCatalog = translatedCatalog(source)
    const originalManifest = {
      metadata: {},
      authoredInventoryLocales: ["fr"],
      machineTranslatedLocales: ["fr"],
      provisionalLocales: ["es"],
      existingNonInventoryLocales: [],
      missingCatalogs: [],
    }
    const fixture = createBatchFixture({
      source,
      catalogs: { es: currentEsCatalog, fr: frCatalog },
      manifest: originalManifest,
      progress: {
        completedLocales: ["es", "fr"],
        generatedLocales: ["es", "fr"],
        catalogDigests: {
          es: contentDigest(flattenCatalog(recordedEsCatalog)),
          fr: contentDigest(flattenCatalog(frCatalog)),
        },
        usage: {},
      },
      selectedLocales: ["fr"],
    })
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)
    vi.spyOn(console, "log").mockImplementation(() => {})

    await expect(
      main({
        args: [...fixture.args, "--promote"],
        environment: { OPENAI_API_KEY: "test-api-key" },
      }),
    ).rejects.toThrow("catalog changed after its progress digest was recorded")
    expect(fetchMock).not.toHaveBeenCalled()
    expect(JSON.parse(readFileSync(fixture.manifestPath, "utf-8"))).toEqual(
      originalManifest,
    )

    writeJson(join(fixture.messagesDir, "es.json"), recordedEsCatalog)
    await main({
      args: [...fixture.args, "--promote"],
      environment: { OPENAI_API_KEY: "test-api-key" },
    })

    const promotedManifest = JSON.parse(
      readFileSync(fixture.manifestPath, "utf-8"),
    )
    expect(promotedManifest.provisionalLocales).toEqual([])
    expect(promotedManifest.machineTranslatedLocales).toEqual(["es", "fr"])
    expect(promotedManifest.metadata.policy).toBe(COMPLETED_CATALOG_POLICY)
  })

  it("translates only newly added source keys and restores catalog parity", async () => {
    const previousSource = sourceCatalog()
    const expandedSource = structuredClone(previousSource)
    expandedSource.common.message20 = "New message"
    expandedSource.LanguageInventory = { bibleProject: "BibleProject" }
    const currentCatalog = translatedCatalog(previousSource)
    const fixture = createFixture({
      source: expandedSource,
      currentCatalog,
      progressCatalog: currentCatalog,
    })
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        chatCompletion([{ key: "common.message20", value: "Mensaje nuevo" }]),
      )
    vi.stubGlobal("fetch", fetchMock)
    vi.spyOn(console, "log").mockImplementation(() => {})

    await main({
      args: fixture.args,
      environment: { OPENAI_API_KEY: "test-api-key" },
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const requestBody = JSON.parse(fetchMock.mock.calls[0][1].body)
    const userPayload = JSON.parse(requestBody.messages[1].content)
    expect(Object.keys(userPayload.messagesToTranslate)).toEqual([
      "common.message20",
    ])

    const updatedCatalog = JSON.parse(
      readFileSync(join(fixture.messagesDir, "es.json"), "utf-8"),
    )
    expect(flattenCatalog(updatedCatalog)).toEqual({
      ...flattenCatalog(currentCatalog),
      "common.message20": "Mensaje nuevo",
      "LanguageInventory.bibleProject": "BibleProject",
    })
    expect(Object.keys(flattenCatalog(updatedCatalog)).sort()).toEqual(
      Object.keys(flattenCatalog(expandedSource)).sort(),
    )
  })

  it("regenerates a machine catalog when final locale provenance is missing", async () => {
    const source = sourceCatalog()
    const fixture = createBatchFixture({
      source,
      catalogs: { es: translatedCatalog(source) },
      manifest: {
        metadata: { translation: { model: "gpt-old-primary" } },
        authoredInventoryLocales: ["es"],
        machineTranslatedLocales: ["es"],
        provisionalLocales: [],
        existingNonInventoryLocales: [],
        missingCatalogs: [],
      },
      progress: {
        completedLocales: [],
        generatedLocales: [],
        catalogDigests: {},
        usage: {},
      },
      selectedLocales: ["es"],
    })
    const fetchMock = vi
      .fn()
      .mockImplementation((_url, options) =>
        Promise.resolve(translatedPromptResponse(options, "ES")),
      )
    vi.stubGlobal("fetch", fetchMock)
    vi.spyOn(console, "log").mockImplementation(() => {})

    await main({
      args: [...fixture.args, "--promote"],
      environment: { OPENAI_API_KEY: "test-api-key" },
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const prompt = promptFromRequest(fetchMock.mock.calls[0][1])
    expect(Object.keys(prompt.messagesToTranslate)).toEqual(
      Object.keys(flattenCatalog(source)),
    )
    const manifest = JSON.parse(readFileSync(fixture.manifestPath, "utf-8"))
    expect(manifest.metadata.translation.model).toBe(MODEL)
    expect(manifest.metadata.translation.fallbackModels).toBeUndefined()
    expect(manifest.metadata.translation.localeProvenance.es).toMatchObject({
      model: MODEL,
      sourceDigest: sourceDigestForFlatCatalog(flattenCatalog(source)),
    })
  })

  it("regenerates a machine catalog when its source provenance is stale", async () => {
    const source = sourceCatalog()
    const fixture = createBatchFixture({
      source,
      catalogs: { es: translatedCatalog(source) },
      manifest: {
        metadata: {
          translation: {
            model: "gpt-old-primary",
            localeProvenance: {
              es: {
                model: "gpt-old-primary",
                sourceDigest: "old-source",
                catalogDigest: "old-catalog",
                generatedOn: "2026-07-01",
              },
            },
          },
        },
        authoredInventoryLocales: ["es"],
        machineTranslatedLocales: ["es"],
        provisionalLocales: [],
        existingNonInventoryLocales: [],
        missingCatalogs: [],
      },
      progress: {
        completedLocales: [],
        generatedLocales: [],
        catalogDigests: {},
        usage: {},
      },
      selectedLocales: ["es"],
    })
    const fetchMock = vi
      .fn()
      .mockImplementation((_url, options) =>
        Promise.resolve(translatedPromptResponse(options, "ES")),
      )
    vi.stubGlobal("fetch", fetchMock)
    vi.spyOn(console, "log").mockImplementation(() => {})

    await main({
      args: [...fixture.args, "--promote"],
      environment: { OPENAI_API_KEY: "test-api-key" },
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const prompt = promptFromRequest(fetchMock.mock.calls[0][1])
    expect(Object.keys(prompt.messagesToTranslate)).toEqual(
      Object.keys(flattenCatalog(source)),
    )
    const manifest = JSON.parse(readFileSync(fixture.manifestPath, "utf-8"))
    expect(manifest.metadata.translation.localeProvenance.es).toMatchObject({
      model: MODEL,
      sourceDigest: sourceDigestForFlatCatalog(flattenCatalog(source)),
    })
  })

  it("rejects scoped promotion while another machine locale has stale source provenance", async () => {
    const source = sourceCatalog()
    const staleProvenance = (locale) => ({
      model: "gpt-old-primary",
      sourceDigest: "old-source",
      catalogDigest: `old-${locale}`,
      generatedOn: "2026-07-01",
    })
    const fixture = createBatchFixture({
      source,
      catalogs: {
        es: translatedCatalog(source),
        fr: translatedCatalog(source),
      },
      manifest: {
        metadata: {
          translation: {
            model: "gpt-old-primary",
            localeProvenance: {
              es: staleProvenance("es"),
              fr: staleProvenance("fr"),
            },
          },
        },
        authoredInventoryLocales: ["es", "fr"],
        machineTranslatedLocales: ["es", "fr"],
        provisionalLocales: [],
        existingNonInventoryLocales: [],
        missingCatalogs: [],
      },
      progress: {
        completedLocales: [],
        generatedLocales: [],
        catalogDigests: {},
        usage: {},
      },
      selectedLocales: ["es"],
    })
    const originalManifest = readFileSync(fixture.manifestPath, "utf-8")
    const fetchMock = vi
      .fn()
      .mockImplementation((_url, options) =>
        Promise.resolve(translatedPromptResponse(options, "ES")),
      )
    vi.stubGlobal("fetch", fetchMock)
    vi.spyOn(console, "log").mockImplementation(() => {})

    await expect(
      main({
        args: [...fixture.args, "--promote"],
        environment: { OPENAI_API_KEY: "test-api-key" },
      }),
    ).rejects.toThrow(
      "Cannot promote while machine-translated locales retain stale source provenance: fr",
    )

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(readFileSync(fixture.manifestPath, "utf-8")).toBe(originalManifest)
  })

  it("replaces regenerated locale provenance and derives disjoint fallback models", () => {
    const generatedOn = "2026-07-14"
    const manifest = updateManifestAfterTranslation({
      manifest: {
        metadata: {
          translation: {
            model: "gpt-primary",
            fallbackModels: {
              "gpt-old-fallback": ["es"],
            },
            localeProvenance: {
              es: {
                model: "gpt-old-fallback",
                sourceDigest: "old-source",
                catalogDigest: "old-es",
                generatedOn: "2026-07-01",
              },
              fr: {
                model: "gpt-primary",
                sourceDigest: "old-source",
                catalogDigest: "old-fr",
                generatedOn: "2026-07-01",
              },
            },
          },
        },
        machineTranslatedLocales: ["es", "fr"],
        provisionalLocales: [],
        existingNonInventoryLocales: [],
        missingCatalogs: [],
      },
      inventory: { languages: [{ tag: "es" }, { tag: "fr" }] },
      completedLocales: ["es", "fr"],
      generatedLocales: ["es"],
      model: MODEL,
      sourceDigest: "current-source",
      catalogDigests: { es: "current-es", fr: "current-fr" },
      generatedOn,
    })

    expect(manifest.metadata.translation.localeProvenance).toEqual({
      es: {
        model: MODEL,
        sourceDigest: "current-source",
        catalogDigest: "current-es",
        generatedOn,
      },
      fr: {
        model: "gpt-primary",
        sourceDigest: "old-source",
        catalogDigest: "old-fr",
        generatedOn: "2026-07-01",
      },
    })
    expect(manifest.metadata.translation.fallbackModels).toEqual({
      [MODEL]: ["es"],
    })
  })

  it("records scoped revisions without replacing whole-catalog model provenance", () => {
    const manifest = updateManifestAfterTranslation({
      manifest: {
        metadata: {
          translation: {
            model: "gpt-base",
            localeProvenance: {
              es: {
                model: "gpt-base",
                sourceDigest: "old-source",
                catalogDigest: "old-es",
                generatedOn: "2026-07-01",
              },
            },
          },
        },
        machineTranslatedLocales: ["es"],
        provisionalLocales: [],
        existingNonInventoryLocales: [],
        missingCatalogs: [],
      },
      inventory: { languages: [{ tag: "es" }] },
      completedLocales: ["es"],
      generatedLocales: ["es"],
      model: MODEL,
      sourceDigest: "current-source",
      catalogDigests: { es: "current-es" },
      scopeMessagePaths: ["SearchOverlay.searchInLanguage"],
      generatedOn: "2026-08-12",
    })

    expect(manifest.metadata.translation.localeProvenance.es).toEqual({
      model: "gpt-base",
      sourceDigest: "current-source",
      catalogDigest: "current-es",
      generatedOn: "2026-08-12",
      scopedRevisions: [
        {
          model: MODEL,
          messagePaths: ["SearchOverlay.searchInLanguage"],
          generatedOn: "2026-08-12",
        },
      ],
    })
    expect(manifest.metadata.translation.model).toBe("gpt-base")
  })

  it("preserves human-reviewed catalog ownership after scoped generation", () => {
    const manifest = updateManifestAfterTranslation({
      manifest: {
        metadata: {
          translation: {
            localeProvenance: {},
          },
        },
        machineTranslatedLocales: [],
        provisionalLocales: [],
        existingNonInventoryLocales: [],
        missingCatalogs: [],
      },
      inventory: { languages: [{ tag: "en" }] },
      completedLocales: ["en"],
      generatedLocales: ["en"],
      model: MODEL,
      sourceDigest: "current-source",
      catalogDigests: { en: "current-en" },
      generatedOn: "2026-07-23",
    })

    expect(manifest.machineTranslatedLocales).toEqual([])
    expect(manifest.metadata.translation.localeProvenance).toEqual({})
  })
})
