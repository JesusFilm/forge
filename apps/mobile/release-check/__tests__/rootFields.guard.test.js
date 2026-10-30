/* eslint-disable @typescript-eslint/no-require-imports */
/* global afterAll, describe, expect, it, require */
// KTD8 guard: every root field of every document the app sends is in exactly
// one class of config/operations.json. The read-only server forwards a request
// only when all its root fields are read-only, so a new field needs a decision.
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const { parse } = require("graphql")

const {
  CONFIG_DIR,
  MOBILE_DIR,
  OPERATION_CLASSES,
  classifyCoordinate,
  readJson,
  rootFieldCoordinates,
} = require("../lib/lists")

const queries = require("../../src/lib/queries")
const feedbackQueries = require("../../src/lib/feedbackQueries")
const watchProgressQueries = require("../../src/lib/watchProgressQueries")
const recommendations = require("../../src/lib/recommendations/operations")
const push = require("../../src/lib/push/operations")
const {
  videoThumbnailsDocument,
} = require("../../src/hooks/useVideoThumbnails")

const operations = readJson(path.join(CONFIG_DIR, "operations.json"))

// Only this file builds a document at run time; the guard loads its builder.
const KNOWN_GRAPHQL_PARSE_FILES = ["src/hooks/useVideoThumbnails.ts"]

function documentsOf(moduleExports) {
  return Object.values(moduleExports).filter(
    (item) => item && item.kind === "Document",
  )
}

const APP_DOCUMENTS = [
  ...documentsOf(queries),
  ...documentsOf(feedbackQueries),
  ...documentsOf(watchProgressQueries),
  ...documentsOf(recommendations),
  ...Object.values(recommendations.RECOMMENDATION_DOCUMENTS),
  ...documentsOf(push),
  ...Object.values(push.PUSH_DOCUMENTS),
  videoThumbnailsDocument(1),
]

function appCoordinates(documents) {
  return [...new Set(documents.flatMap(rootFieldCoordinates))].sort()
}

function unclassified(coordinates) {
  return coordinates.filter(
    (coordinate) => classifyCoordinate(operations, coordinate) === null,
  )
}

const GRAPHQL_FROM =
  /\b(?:import|export)\s+(type\s+)?([^;"'`]*?)\s*from\s*["']graphql["']/g

function clauseExposesParse(clause) {
  const named = clause.match(/\{([^}]*)\}/)
  const outside = clause
    .replace(/\{[^}]*\}/, "")
    .replace(/,/g, "")
    .trim()
  if (outside !== "") return true
  if (!named) return false
  return named[1].split(",").some((part) => {
    const item = part.trim()
    return !item.startsWith("type ") && item.split(/\s+as\s+/)[0] === "parse"
  })
}

function importsGraphqlParse(source) {
  if (/\b(?:require|import)\s*\(\s*["']graphql["']\s*\)/.test(source)) {
    return true
  }
  return [...source.matchAll(GRAPHQL_FROM)].some(
    (match) => !match[1] && clauseExposesParse(match[2]),
  )
}

function appSourceFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === "node_modules" || entry.name === "__tests__") return []
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) return appSourceFiles(full)
    if (/\.test\./.test(entry.name)) return []
    return /\.(ts|tsx|js|jsx|mjs|cjs)$/.test(entry.name) ? [full] : []
  })
}

function unknownParseImporters(root, known) {
  return ["src", "app"]
    .flatMap((dir) => appSourceFiles(path.join(root, dir)))
    .map((file) => path.relative(root, file).split(path.sep).join("/"))
    .filter((file) => !known.includes(file))
    .filter((file) =>
      importsGraphqlParse(fs.readFileSync(path.join(root, file), "utf8")),
    )
}

const tempDirs = []
afterAll(() => {
  for (const dir of tempDirs) fs.rmSync(dir, { recursive: true, force: true })
})

describe("the root-field table", () => {
  const coordinates = appCoordinates(APP_DOCUMENTS)

  it("collects the read-only fields from the app's documents (positive control)", () => {
    expect(coordinates).toEqual(
      expect.arrayContaining([
        "Query.experienceBySlug",
        "Query.watchSetting",
        "Query.video",
        "Query.videoBySlug",
        "Query.videoDub",
        "Query.watchHomeVideos",
        "Query.watchLanguageInventory",
      ]),
    )
  })

  it("puts every root field the app sends in exactly one class", () => {
    expect(unclassified(coordinates)).toEqual([])
  })

  it("fails on a document that adds a query field the table does not name", () => {
    const fixture = parse(
      `query Fixture($slug: String!) {
        videoBySlug(slug: $slug) { id }
        brandNewField { id }
      }`,
    )
    expect(unclassified(appCoordinates([...APP_DOCUMENTS, fixture]))).toEqual([
      "Query.brandNewField",
    ])
  })

  it("never puts watchSearch or userRecommendations in the read-only class", () => {
    expect(operations.readOnly).not.toContain("Query.watchSearch")
    expect(operations.readOnly).not.toContain("Query.userRecommendations")
  })

  it("reads `video` in the runtime-built VideoThumbnails document as read-only", () => {
    const document = videoThumbnailsDocument(1)
    expect(rootFieldCoordinates(document)).toEqual(["Query.video"])
    expect(classifyCoordinate(operations, "Query.video")).toBe("readOnly")
  })

  it("has the four classes the read-only server reads", () => {
    for (const name of OPERATION_CLASSES) {
      expect(Array.isArray(operations[name])).toBe(true)
    }
  })
})

describe("documents built at run time", () => {
  it("finds no unknown file in src/ or app/ that imports parse from graphql", () => {
    expect(appSourceFiles(path.join(MOBILE_DIR, "src")).length).toBeGreaterThan(
      100,
    )
    expect(
      unknownParseImporters(MOBILE_DIR, KNOWN_GRAPHQL_PARSE_FILES),
    ).toEqual([])
  })

  it("flags a fixture file that imports parse and is not on the known list", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "release-check-parse-"))
    tempDirs.push(root)
    fs.mkdirSync(path.join(root, "src/hooks"), { recursive: true })
    fs.mkdirSync(path.join(root, "app"), { recursive: true })
    fs.writeFileSync(
      path.join(root, "src/hooks/useVideoThumbnails.ts"),
      'import { parse, print, type DocumentNode } from "graphql"\n',
    )
    fs.writeFileSync(
      path.join(root, "src/hooks/useNewDocument.ts"),
      'import { print, parse as toDocument } from "graphql"\n',
    )
    fs.writeFileSync(
      path.join(root, "app/printOnly.tsx"),
      'import { print, type DocumentNode } from "graphql"\n',
    )
    expect(unknownParseImporters(root, KNOWN_GRAPHQL_PARSE_FILES)).toEqual([
      "src/hooks/useNewDocument.ts",
    ])
  })
})
