// Plain JS (like the other guard suites): the RN tsconfig has no Node types,
// and this guard needs fs, path, and the TypeScript compiler.
/* eslint-disable @typescript-eslint/no-require-imports */
/* global describe, expect, it, require */
const fs = require("fs")
const path = require("path")
const ts = require("typescript")

// Guard (R14, KTD14): user-visible English lives in messages/en.json, and
// code reads the UI locale only through the store. The parser, not a regex,
// finds JSX text and copy props, so a string in a comment cannot trip it.
const MOBILE_ROOT = path.join(__dirname, "..", "..", "..")
const ROOTS = ["app", "src"]
const LOCALE_STORE = "src/i18n/localeStore.ts"

// The five KTD14 props, and the navigator's screen options that it draws as text.
const COPY_PROPS = new Set([
  "accessibilityLabel",
  "accessibilityHint",
  "title",
  "placeholder",
  "label",
  "headerTitle",
  "headerBackTitle",
  "tabBarLabel",
  "tabBarAccessibilityLabel",
])

// Allowed by rule: log text and GraphQL documents are never shown to a viewer.
const LOG_CALLEE =
  /(?:^|\.)(?:console|datadogLog|DdLogs|DdRum|telemetry)\.\w+$|(?:^|\.)reportDatadog\w*$/
const GRAPHQL_CALLEE = /(?:^|\.)(?:adminGraphql|graphql|gql)$/

// Store reads that go stale when a module runs them once, at load (KTD2).
const STORE_READS = new Set([
  "getT",
  "getActiveTranslator",
  "getCatalogTag",
  "getLocaleEpoch",
  "getPhoneLocales",
  "getLocaleResolution",
  "isPseudoLocale",
  "localeResolutionAttributes",
  "defaultAudioLanguage",
  "currentAdminForms",
])

// With no locale argument, these read the Intl default locale (KTD3).
const INTL_APIS = new Set([
  "Collator",
  "DateTimeFormat",
  "DisplayNames",
  "ListFormat",
  "NumberFormat",
  "PluralRules",
  "RelativeTimeFormat",
  "Segmenter",
])
const TO_LOCALE_METHODS = new Set([
  "toLocaleString",
  "toLocaleDateString",
  "toLocaleTimeString",
  "toLocaleUpperCase",
  "toLocaleLowerCase",
])

// Modules that build user text through `t` or `getT`. Each must still read
// the catalog, and must not return English as a literal.
const COPY_MODULES = {
  "src/components/feedback/feedbackFlow.ts":
    "Feedback: the form's headings, kinds, video tag, problems, and disclosure",
  "src/components/watch/progressAccessibilityText.ts":
    "Watch: the progress text in a card's accessibility label",
  "src/hooks/useBibleVerses.ts":
    "BibleQuotes: the citation labels of the Bible quote cards",
  "src/lib/appVersion.ts": "More: the app version line",
  "src/lib/bible/movement/useReaderMovement.ts":
    "BibleReader: the reader's move announcements",
  "src/lib/bible/reader/labels.ts":
    "BibleReader: the counter, passage, translation, and download labels",
  "src/lib/bible/sheets/downloadPrompt.ts":
    "BibleDownload: the Bible download alert",
  "src/lib/bible/sheets/partialSwitch.ts":
    "BibleTranslationPicker: the partial translation prompt",
  "src/lib/bible/sheets/translationList.ts":
    "BibleTranslationPicker: the language, coverage, and status labels",
  "src/lib/citationFormat.ts": "BibleQuotes: the citation reference",
  "src/lib/downloadGlyph.ts": "DownloadButton: the download control labels",
  "src/lib/downloadTiers.ts": "DownloadSheet: the file size text",
  "src/lib/exportReport.ts": "ExportReport: the export report text",
  "src/lib/feedbackCopy.ts": "Feedback: the one failure message",
  "src/lib/lapseReminders/copy.ts":
    "LapseReminder: the reminder body and the Android channel name",
  "src/lib/libraryDownloads.ts": "Library: the downloads list text",
  "src/lib/playbackTarget.ts": "Cast: the Cast button and indicator labels",
  "src/lib/push/copy.ts":
    "Push: the announcements channel name, the tap notice, and the test ID alert",
  "src/lib/rawModeLabel.ts": "DownloadSheet: the save-to-folder button label",
  "src/lib/seriesDownloadAggregate.ts":
    "DownloadButton: the series Download button's spoken label",
  "src/lib/seriesDownloadEnqueue.ts":
    "SeriesDownload: the series download text",
  "src/lib/tabBar.ts": "Tabs: the tab labels",
  "src/lib/videoLabel.ts": "VideoLabel: the kind of video",
  "src/lib/watchHome/fallbackConfig.ts":
    "HomeShelves: the fallback shelf titles",
  "src/lib/watchHome/heroConfig.ts": "HomeHero: the hero text",
  "src/lib/watchHome/model.ts": "Home: the Home model text",
  "src/lib/watchSearch.ts": "Discover: the search result text",
}

// Files that the copy rules skip. The locale rules still apply to them.
const COPY_EXEMPT_FILES = {
  "src/components/DevEndpointNotice.tsx":
    "Development only: app/_layout.tsx requires it under __DEV__",
  "src/lib/terms-of-use.ts":
    "Legal: English until a human reviews a translation (KD10, KTD17)",
  "src/lib/bible/sheets/copy.ts":
    "Legal: the Bible license and credit notices stay English (KD10, KTD17)",
  ...Object.fromEntries(
    [
      "src/components/PauseStage.tsx",
      "src/components/dailyPause/CloseButton.tsx",
      "src/components/dailyPause/CustomizeSheet.tsx",
      "src/components/dailyPause/OpeningScreen.tsx",
      "src/components/dailyPause/PartPlayer.tsx",
      "src/components/dailyPause/PrayScreen.tsx",
      "src/components/dailyPause/ReflectScreen.tsx",
      "src/components/dailyPause/ShareScreen.tsx",
      "src/components/dailyPause/StepperPills.tsx",
      "src/components/dailyPause/WatchScreen.tsx",
      "src/components/home/AnnouncementsButton.tsx",
      "src/components/home/DailyPauseCard.tsx",
      "src/lib/announcements.ts",
    ].map((file) => [
      file,
      "Daily Bible Pause review build: an English-only mock on a branch that never merges",
    ]),
  ),
}

// Exact strings that stay English on purpose. Match on file, rule, and text.
const ALLOWED = [
  {
    file: "app/_layout.tsx",
    rule: "jsx-text",
    text: "Startup Error",
    reason:
      "Shows when the guarded require block fails, which can be the i18n modules; the body is a raw stack trace",
  },
  {
    file: "app/_layout.tsx",
    rule: "jsx-text",
    text: "App Error",
    reason:
      "The root error boundary's panel must not call the translator that may have thrown; the body is a raw stack trace",
  },
  {
    file: "app/series/[slug].tsx",
    rule: "copy-prop",
    text: "SERIES",
    reason:
      "Admin's raw label enum, not text: VideoMetadata maps it to VideoLabel.series",
  },
  {
    file: "src/components/bible/sheets/ReaderStepSlider.tsx",
    rule: "jsx-text",
    text: "A",
    reason: "A sample letter that shows the text size, not a word",
  },
  {
    file: "src/components/home/HomeHeroPager.tsx",
    rule: "jsx-text",
    text: "JESUS FILM PROJECT",
    reason: "The brand wordmark, the same in every language",
  },
  {
    file: "src/components/home/HomeLogo.tsx",
    rule: "copy-prop",
    text: "Jesus Film Project",
    reason: "The logo's spoken name is the brand, as on web",
  },
  {
    file: "src/components/watch/PlayerControls.tsx",
    rule: "copy-prop",
    text: "AirPlay",
    reason: "Apple's product name, the same in every language",
  },
  ...["X", "Facebook", "Instagram", "YouTube"].map((text) => ({
    file: "src/lib/myWatchLinks.ts",
    rule: "copy-prop",
    text,
    reason: "A social network's brand name, the same in every language",
  })),
  {
    file: "src/lib/push/deviceEnvironment.ts",
    rule: "intl-default-locale",
    text: "Intl.DateTimeFormat()",
    reason:
      "Push registration reports the phone's own locale and time zone to admin; it formats no text",
  },
  {
    file: "src/lib/watchHome/fallbackConfig.ts",
    rule: "copy-prop",
    text: "NUA",
    reason: "A series name, the same in every language",
  },
  {
    file: "src/lib/watchHome/fallbackConfig.ts",
    rule: "copy-prop",
    text: "NUA Worth",
    reason: "A series name, the same in every language",
  },
]

const LETTER = /\p{L}/u
const hasLetters = (text) => LETTER.test(text)
// A returned literal reads as English copy when it has a lowercase word and
// a space or a capital. Units ("GB") and URLs stay raw (downloadTiers.ts).
const looksLikeCopy = (text) =>
  /\p{Ll}{2}/u.test(text) && (/\s/.test(text) || /^\p{Lu}\p{Ll}/u.test(text))

/** The literal texts that an expression can evaluate to, without calls. */
function literalLeaves(node) {
  if (!node) return []
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return [node.text]
  }
  if (ts.isTemplateExpression(node)) {
    const parts = node.templateSpans.map((span) => span.literal.text)
    return [[node.head.text, ...parts].join("{}")]
  }
  if (
    ts.isParenthesizedExpression(node) ||
    ts.isAsExpression(node) ||
    ts.isSatisfiesExpression(node) ||
    ts.isNonNullExpression(node) ||
    ts.isJsxExpression(node)
  ) {
    return literalLeaves(node.expression)
  }
  if (ts.isConditionalExpression(node)) {
    return [...literalLeaves(node.whenTrue), ...literalLeaves(node.whenFalse)]
  }
  if (ts.isBinaryExpression(node)) {
    const op = node.operatorToken.kind
    if (op === ts.SyntaxKind.AmpersandAmpersandToken) {
      return literalLeaves(node.right)
    }
    if (
      op === ts.SyntaxKind.BarBarToken ||
      op === ts.SyntaxKind.QuestionQuestionToken ||
      op === ts.SyntaxKind.PlusToken
    ) {
      return [...literalLeaves(node.left), ...literalLeaves(node.right)]
    }
  }
  return []
}

function isFunctionLike(node) {
  if (ts.isPropertyDeclaration(node)) {
    // An instance field runs at construction, not at module load.
    return !(ts.getCombinedModifierFlags(node) & ts.ModifierFlags.Static)
  }
  return (
    ts.isFunctionDeclaration(node) ||
    ts.isFunctionExpression(node) ||
    ts.isArrowFunction(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isConstructorDeclaration(node) ||
    ts.isGetAccessorDeclaration(node) ||
    ts.isSetAccessorDeclaration(node)
  )
}

function calleeName(call) {
  const callee = call.expression
  if (ts.isIdentifier(callee)) return callee.text
  if (ts.isPropertyAccessExpression(callee)) return callee.name.text
  return null
}

const isUndefined = (node) => ts.isIdentifier(node) && node.text === "undefined"
const isExpoLocalization = (specifier) =>
  /^expo-localization(?:\/|$)/.test(specifier)

function bindingNames(name, into) {
  if (ts.isIdentifier(name)) {
    into.add(name.text)
    return
  }
  for (const element of name.elements) {
    if (!ts.isOmittedExpression(element)) bindingNames(element.name, into)
  }
}

/** Parse one file and apply every rule. `translatorTypes` holds the aliases of
 *  `UiT` declared in other files, such as `DownloadButtonT`. */
function analyzeSource(file, source, translatorTypes = []) {
  const sf = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  )
  const offenders = []
  const report = (node, rule, text) => {
    const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf))
    const flat = text.replace(/\s+/g, " ").trim()
    offenders.push({ file, line: line + 1, rule, text: flat })
  }
  const copyRules = !Object.hasOwn(COPY_EXEMPT_FILES, file)
  const reportCopy = (node, rule) => {
    if (!copyRules) return
    for (const text of literalLeaves(node)) {
      if (hasLetters(text)) report(node, rule, text)
    }
  }
  const textOf = (node) =>
    node.getText(sf).replace(/\?\./g, ".").replace(/\s+/g, "")

  const types = new Set(["UiT", ...translatorTypes])
  ts.forEachChild(sf, function collect(node) {
    if (
      ts.isTypeAliasDeclaration(node) &&
      /\bUiT\s*</.test(textOf(node.type))
    ) {
      types.add(node.name.text)
    }
    ts.forEachChild(node, collect)
  })
  const translatorType = new RegExp(`\\b(?:${[...types].join("|")})\\b`)
  const translators = new Set()
  let readsCatalog = false

  function inLogOrGraphql(node) {
    for (let p = node.parent; p; p = p.parent) {
      const callee = ts.isCallExpression(p)
        ? p.expression
        : ts.isTaggedTemplateExpression(p)
          ? p.tag
          : null
      if (callee) {
        const text = textOf(callee)
        if (LOG_CALLEE.test(text) || GRAPHQL_CALLEE.test(text)) return true
      }
    }
    return false
  }

  function atModuleScope(node) {
    for (let p = node.parent; p; p = p.parent) {
      if (isFunctionLike(p)) return false
    }
    return true
  }

  function visitCall(node) {
    const name = calleeName(node)
    const callee = textOf(node.expression)
    const [first, second, third] = node.arguments

    if (
      ts.isPropertyAccessExpression(node.expression) &&
      TO_LOCALE_METHODS.has(name) &&
      (!first || isUndefined(first))
    ) {
      report(node, "intl-default-locale", node.getText(sf))
    }
    if (
      (callee === "require" ||
        node.expression.kind === ts.SyntaxKind.ImportKeyword) &&
      first &&
      ts.isStringLiteral(first) &&
      isExpoLocalization(first.text) &&
      file !== LOCALE_STORE
    ) {
      report(node, "expo-localization", first.text)
    }
    if (callee === "Alert.alert" || callee === "Alert.prompt") {
      reportCopy(first, "alert-text")
      reportCopy(second, "alert-text")
      const buttons =
        third && ts.isArrayLiteralExpression(third) ? third.elements : []
      for (const button of buttons) {
        if (!ts.isObjectLiteralExpression(button)) continue
        for (const prop of button.properties) {
          if (
            ts.isPropertyAssignment(prop) &&
            prop.name.getText(sf) === "text"
          ) {
            reportCopy(prop.initializer, "alert-text")
          }
        }
      }
    }
    if (name === "getT" && ts.isIdentifier(node.expression)) {
      if (file.endsWith(".tsx")) report(node, "getT-in-tsx", node.getText(sf))
    }
    if (STORE_READS.has(name) && atModuleScope(node)) {
      report(node, "top-level-store-read", node.getText(sf))
    }
    // A catalog read: `t(...)`, or `getT(...)(...)` and `useT(...)(...)`.
    if (
      (ts.isIdentifier(node.expression) &&
        translators.has(node.expression.text)) ||
      (ts.isCallExpression(node.expression) &&
        ["getT", "useT"].includes(calleeName(node.expression)))
    ) {
      readsCatalog = true
    }
  }

  function visit(node) {
    if (ts.isJsxText(node)) {
      if (copyRules && hasLetters(node.text)) {
        report(node, "jsx-text", node.text)
      }
    } else if (ts.isJsxAttribute(node)) {
      if (COPY_PROPS.has(node.name.getText(sf))) {
        reportCopy(node.initializer, "copy-prop")
      }
    } else if (ts.isPropertyAssignment(node)) {
      const key =
        ts.isIdentifier(node.name) || ts.isStringLiteral(node.name)
          ? node.name.text
          : null
      if (COPY_PROPS.has(key) && !inLogOrGraphql(node)) {
        reportCopy(node.initializer, "copy-prop")
      }
    } else if (ts.isParameter(node)) {
      if (node.type && translatorType.test(textOf(node.type))) {
        bindingNames(node.name, translators)
      }
    } else if (ts.isVariableDeclaration(node)) {
      const init = node.initializer
      if (
        init &&
        ts.isCallExpression(init) &&
        ["getT", "useT"].includes(calleeName(init))
      ) {
        bindingNames(node.name, translators)
      }
    } else if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      const specifier = node.moduleSpecifier
      if (
        specifier &&
        ts.isStringLiteral(specifier) &&
        isExpoLocalization(specifier.text) &&
        file !== LOCALE_STORE
      ) {
        report(node, "expo-localization", specifier.text)
      }
    }

    if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
      const callee = node.expression
      const first = node.arguments ? node.arguments[0] : undefined
      if (
        ts.isPropertyAccessExpression(callee) &&
        ts.isIdentifier(callee.expression) &&
        callee.expression.text === "Intl" &&
        INTL_APIS.has(callee.name.text) &&
        (!first || isUndefined(first))
      ) {
        report(node, "intl-default-locale", node.getText(sf))
      }
    }
    if (ts.isCallExpression(node)) visitCall(node)

    if (Object.hasOwn(COPY_MODULES, file)) {
      const returned = ts.isReturnStatement(node)
        ? node.expression
        : ts.isArrowFunction(node) && !ts.isBlock(node.body)
          ? node.body
          : null
      for (const text of literalLeaves(returned)) {
        if (looksLikeCopy(text)) report(returned, "copy-module-literal", text)
      }
    }
    ts.forEachChild(node, visit)
  }

  visit(sf)
  if (Object.hasOwn(COPY_MODULES, file) && !readsCatalog) {
    report(sf, "copy-module", "does not read the catalog")
  }
  return { offenders, readsCatalog }
}

function checkSource(file, source, translatorTypes) {
  return analyzeSource(file, source, translatorTypes).offenders
}

const rulesOf = (file, source) =>
  checkSource(file, source).map((offender) => offender.rule)

/** Every source file under app/ and src/, without tests or generated code. */
function sourceFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const skipped = ["node_modules", "__tests__", "__mocks__", "test-utils"]
    if (skipped.includes(entry.name)) return []
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) return sourceFiles(full)
    if (!/\.tsx?$/.test(entry.name)) return []
    if (/\.(?:test|spec)\.|\.generated\.|\.d\.ts$/.test(entry.name)) return []
    return [path.relative(MOBILE_ROOT, full).split(path.sep).join("/")]
  })
}

function scanTree() {
  const files = ROOTS.flatMap((root) =>
    sourceFiles(path.join(MOBILE_ROOT, root)),
  )
  const sources = new Map(
    files.map((file) => [
      file,
      fs.readFileSync(path.join(MOBILE_ROOT, file), "utf8"),
    ]),
  )
  const translatorTypes = new Set()
  const alias = /\btype\s+(\w+)\s*=\s*UiT\s*</g
  for (const source of sources.values()) {
    for (const match of source.matchAll(alias)) translatorTypes.add(match[1])
  }
  const offenders = []
  const readers = []
  for (const [file, source] of sources) {
    const result = analyzeSource(file, source, [...translatorTypes])
    offenders.push(...result.offenders)
    if (result.readsCatalog) readers.push(file)
  }
  return { files, offenders, readers }
}

const isAllowed = (offender) =>
  ALLOWED.some(
    (entry) =>
      entry.file === offender.file &&
      entry.rule === offender.rule &&
      entry.text === offender.text,
  )

const describeOffender = (offender) =>
  `${offender.file}:${offender.line} ${offender.rule} ${JSON.stringify(offender.text)}`

describe("no hard-coded English outside the catalog (R14, KTD14)", () => {
  describe("positive controls", () => {
    it.each([
      [
        "JSX text",
        "src/components/Fixture.tsx",
        `export const A = () => <Text>Save</Text>`,
        "jsx-text",
      ],
      [
        "a JSX copy attribute",
        "src/components/Fixture.tsx",
        `export const A = () => <Pressable accessibilityLabel="Play video" />`,
        "copy-prop",
      ],
      [
        "a JSX copy attribute in braces",
        "src/components/Fixture.tsx",
        `export const A = () => <TextInput placeholder={"Search videos"} />`,
        "copy-prop",
      ],
      [
        "a literal branch of a conditional",
        "src/components/Fixture.tsx",
        `export const A = ({ on, t }) => (
          <Pressable accessibilityHint={on ? "Stops the video" : t("play")} />
        )`,
        "copy-prop",
      ],
      [
        "a template literal with words",
        "src/components/Fixture.tsx",
        "export const A = ({ n }) => <Pressable accessibilityLabel={`${n} videos`} />",
        "copy-prop",
      ],
      [
        "a copy property in an options object",
        "app/fixture.tsx",
        `export const A = () => <Stack.Screen options={{ title: "Downloads" }} />`,
        "copy-prop",
      ],
      [
        "a copy property in an object passed as a prop",
        "src/lib/fixture.ts",
        `export const ITEMS = [{ key: "share", label: "Share" }]`,
        "copy-prop",
      ],
      [
        "the title of Alert.alert",
        "src/components/Fixture.tsx",
        `export function ask() { Alert.alert("Remove download?") }`,
        "alert-text",
      ],
      [
        "the message of Alert.alert",
        "src/components/Fixture.tsx",
        `export function ask(t) { Alert.alert(t("title"), "This cannot be undone.") }`,
        "alert-text",
      ],
      [
        "a button of Alert.alert",
        "src/components/Fixture.tsx",
        `export function ask(t) {
          Alert.alert(t("title"), undefined, [{ text: "Cancel", style: "cancel" }])
        }`,
        "alert-text",
      ],
      [
        "getT( in a .tsx file",
        "src/components/Fixture.tsx",
        `export function A() { const t = getT("Common"); return <Text>{t("back")}</Text> }`,
        "getT-in-tsx",
      ],
      [
        "an import of expo-localization outside the store",
        "src/lib/fixture.ts",
        `import { getLocales } from "expo-localization"`,
        "expo-localization",
      ],
      [
        "a type-only import of expo-localization outside the store",
        "src/lib/fixture.ts",
        `import type { Locale } from "expo-localization"`,
        "expo-localization",
      ],
      [
        "a require of expo-localization outside the store",
        "src/lib/fixture.ts",
        `export function tags() { return require("expo-localization").getLocales() }`,
        "expo-localization",
      ],
      [
        "Intl.DateTimeFormat().resolvedOptions().locale",
        "src/lib/fixture.ts",
        `export function tag() { return Intl.DateTimeFormat().resolvedOptions().locale }`,
        "intl-default-locale",
      ],
      [
        "new Intl.NumberFormat().resolvedOptions()",
        "src/lib/fixture.ts",
        `export function tag() { return new Intl.NumberFormat().resolvedOptions().locale }`,
        "intl-default-locale",
      ],
      [
        "an Intl formatter with an undefined locale",
        "src/lib/fixture.ts",
        `export function day(d) { return new Intl.DateTimeFormat(undefined, { weekday: "long" }).format(d) }`,
        "intl-default-locale",
      ],
      [
        "toLocaleString() with no locale",
        "src/lib/fixture.ts",
        `export function count(n) { return n.toLocaleString() }`,
        "intl-default-locale",
      ],
      [
        "a store read at the top level",
        "src/lib/fixture.ts",
        `import { getCatalogTag } from "../i18n/localeStore"
        export const TAG = getCatalogTag()`,
        "top-level-store-read",
      ],
      [
        "a top-level getT( read",
        "src/lib/fixture.ts",
        `export const LABEL = getT("Common")("back")`,
        "top-level-store-read",
      ],
      [
        "a registered copy module that stops reading the catalog",
        "src/lib/rawModeLabel.ts",
        `export function rawModeLabel(platformOS: string): string {
          return platformOS === "ios" ? "Save to Files" : "Save to Device"
        }`,
        "copy-module",
      ],
      [
        "a registered copy module that returns one literal",
        "src/lib/rawModeLabel.ts",
        `import type { UiT } from "../i18n/useT"
        export function rawModeLabel(platformOS: string, t: UiT<"DownloadSheet">): string {
          return platformOS === "ios" ? "Save to Files" : t("saveToDevice")
        }`,
        "copy-module-literal",
      ],
    ])("flags %s", (_name, file, source, rule) => {
      expect(rulesOf(file, source)).toContain(rule)
    })
  })

  describe("negative controls", () => {
    it.each([
      [
        "an accessibility action name",
        "src/components/Fixture.tsx",
        `export const A = ({ t }) => (
          <View accessibilityActions={[{ name: "increment", label: t("x") }]} />
        )`,
      ],
      [
        "a dd-action-name literal",
        "src/components/Fixture.tsx",
        `export const A = ({ t }) => (
          <Pressable dd-action-name="Play video" accessibilityLabel={t("play")} />
        )`,
      ],
      [
        "a spread dd-action-name literal",
        "src/components/Fixture.tsx",
        `export const A = () => <Pressable {...{ "dd-action-name": "Go back" }} />`,
      ],
      [
        "a catalog read in a copy property",
        "src/components/Fixture.tsx",
        `export const A = ({ t }) => <Pressable accessibilityLabel={t("playAriaLabel")} />`,
      ],
      [
        "JSX text with no letters",
        "src/components/Fixture.tsx",
        `export const A = ({ n }) => <Text>{n} · 3:05</Text>`,
      ],
      [
        "log text",
        "src/lib/fixture.ts",
        `export function log(e) {
          console.warn("Save failed", { label: "Retry" })
          datadogLog.info("Download started", { title: "none" })
          reportDatadogError(e, { label: "boot failed" })
        }`,
      ],
      [
        "a GraphQL document",
        "src/lib/fixture.ts",
        "export const Q = adminGraphql(`query Video { video { title label } }`)",
      ],
      [
        "an Alert.alert button style",
        "src/components/Fixture.tsx",
        `export function ask(t) {
          Alert.alert(t("title"), t("body"), [{ text: t("cancel"), style: "cancel" }])
        }`,
      ],
      [
        "a store read inside a function",
        "src/lib/fixture.ts",
        `import { getCatalogTag } from "../i18n/localeStore"
        export function tag() { return getCatalogTag() }
        export const later = () => getT("Common")("back")`,
      ],
      [
        "expo-localization inside the store",
        "src/i18n/localeStore.ts",
        `import type { Locale } from "expo-localization"
        export function read() { return require("expo-localization").getLocales() }`,
      ],
      [
        "an Intl formatter with a locale",
        "src/lib/fixture.ts",
        `export function day(tag, d) {
          const time = Intl.DateTimeFormat(tag).resolvedOptions().timeZone
          return new Intl.DateTimeFormat([tag, "en-US"], { weekday: "long" }).format(d) + time
        }`,
      ],
      [
        "a registered copy module that reads the catalog",
        "src/lib/rawModeLabel.ts",
        `import type { UiT } from "../i18n/useT"
        export function rawModeLabel(platformOS: string, t: UiT<"DownloadSheet">): string {
          return platformOS === "ios" ? t("saveToFiles") : t("saveToDevice")
        }`,
      ],
      [
        "a non-copy key with a literal",
        "src/lib/fixture.ts",
        `export const SHELF = { layout: "rail", orientation: "vertical", testID: "Home shelf" }`,
      ],
      [
        "copy in a development-only file",
        "src/components/DevEndpointNotice.tsx",
        `export const A = () => <Text>Admin endpoint unreachable</Text>`,
      ],
    ])("does not flag %s", (_name, file, source) => {
      expect(checkSource(file, source)).toEqual([])
    })

    it("still applies the locale rules to a copy-exempt file", () => {
      const source = `import { getLocales } from "expo-localization"`
      expect(rulesOf("src/lib/terms-of-use.ts", source)).toEqual([
        "expo-localization",
      ])
    })
  })

  describe("the real tree", () => {
    const tree = scanTree()

    it("scans more than 100 files", () => {
      expect(tree.files.length).toBeGreaterThan(100)
    })

    it("has no hard-coded English and no stale locale read", () => {
      const offenders = tree.offenders.filter((o) => !isAllowed(o))
      expect(offenders.map(describeOffender)).toEqual([])
    })

    it("uses every allowlist entry", () => {
      const unused = ALLOWED.filter(
        (entry) =>
          !tree.offenders.some(
            (o) =>
              o.file === entry.file &&
              o.rule === entry.rule &&
              o.text === entry.text,
          ),
      )
      expect(unused).toEqual([])
    })

    it("names only files that exist", () => {
      const named = [
        ...Object.keys(COPY_MODULES),
        ...Object.keys(COPY_EXEMPT_FILES),
      ]
      const missing = named.filter(
        (file) => !fs.existsSync(path.join(MOBILE_ROOT, file)),
      )
      expect(missing).toEqual([])
    })

    // A new .ts module that builds text through `t` joins COPY_MODULES, so
    // a later edit that drops the catalog read fails here.
    it("registers every .ts module that reads the catalog", () => {
      const unregistered = tree.readers.filter(
        (file) => file.endsWith(".ts") && !Object.hasOwn(COPY_MODULES, file),
      )
      expect(unregistered).toEqual([])
    })
  })
})
