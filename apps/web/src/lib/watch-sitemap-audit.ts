import { createHash } from "node:crypto"

import { XMLParser, XMLValidator } from "fast-xml-parser"
import { isLanguageLessWatchVideoPathEligible } from "@forge/watch-url-policy/routes"

import {
  DEFAULT_MAX_SITEMAP_BYTES,
  DEFAULT_MAX_SITEMAP_URLS,
} from "./watch-sitemap-limits"

export type WatchSitemapAuditDocument = {
  body: Uint8Array
  contentType: string | null
  redirected: boolean
  referenceUrl?: string
  status: number
  url: string
}

export type WatchSitemapAuditIssueCode =
  | "alternate_target_missing"
  | "child_too_large"
  | "child_too_many_urls"
  | "contextual_route"
  | "duplicate_child_document"
  | "duplicate_child_reference"
  | "duplicate_hreflang"
  | "duplicate_loc"
  | "explicit_english_alias"
  | "http_redirect"
  | "http_status"
  | "invalid_child_sequence"
  | "invalid_content_type"
  | "invalid_index"
  | "invalid_utf8"
  | "invalid_xml"
  | "missing_child"
  | "missing_self_alternate"
  | "non_reciprocal_alternate_set"
  | "unreferenced_child"

export type WatchSitemapAuditIssue = {
  code: WatchSitemapAuditIssueCode
  message: string
  url?: string
}

export type WatchSitemapAuditIndex = {
  bytes: number
  childCount: number
  status: number
  url: string
  validUtf8: boolean
  validXml: boolean
}

export type WatchSitemapAuditChild = {
  bytes: number
  hreflangCount: number
  id: number | null
  locCount: number
  referenceUrl: string
  status: number
  url: string
  validUtf8: boolean
  validXml: boolean
}

export type WatchSitemapAuditReport = {
  children: WatchSitemapAuditChild[]
  index: WatchSitemapAuditIndex
  issues: WatchSitemapAuditIssue[]
  ok: boolean
  totals: {
    bytes: number
    children: number
    hreflang: number
    locs: number
  }
}

type WatchSitemapAuditLimits = {
  maxBytes?: number
  maxUrls?: number
}

type InspectedIndex = {
  childUrls: string[]
  index: WatchSitemapAuditIndex
  issues: WatchSitemapAuditIssue[]
}

type ParsedDocument = {
  parsed: Record<string, unknown> | null
  validUtf8: boolean
  validXml: boolean
}

const xmlParser = new XMLParser({
  allowBooleanAttributes: true,
  attributeNamePrefix: "",
  ignoreAttributes: false,
  parseTagValue: false,
  trimValues: true,
})

function asArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) return []
  return Array.isArray(value) ? value : [value]
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function asText(value: unknown): string | null {
  if (typeof value === "string") return value
  if (typeof value === "number") return String(value)
  const record = asRecord(value)
  return typeof record?.["#text"] === "string" ? record["#text"] : null
}

function documentIssue(
  code: WatchSitemapAuditIssueCode,
  message: string,
  url?: string,
): WatchSitemapAuditIssue {
  return { code, message, ...(url ? { url } : {}) }
}

function inspectDocument(
  document: WatchSitemapAuditDocument,
  issues: WatchSitemapAuditIssue[],
): ParsedDocument {
  if (document.status !== 200) {
    issues.push(
      documentIssue(
        "http_status",
        `Expected direct HTTP 200, received ${document.status}`,
        document.url,
      ),
    )
  }
  if (
    document.redirected ||
    (document.status >= 300 && document.status < 400)
  ) {
    issues.push(
      documentIssue(
        "http_redirect",
        "Sitemap response must not redirect",
        document.url,
      ),
    )
  }
  if (
    !document.contentType ||
    !/^(?:application|text)\/xml\b/i.test(document.contentType)
  ) {
    issues.push(
      documentIssue(
        "invalid_content_type",
        `Expected an XML content type, received ${document.contentType ?? "none"}`,
        document.url,
      ),
    )
  }

  let xml: string
  try {
    xml = new TextDecoder("utf-8", { fatal: true }).decode(document.body)
  } catch {
    issues.push(
      documentIssue(
        "invalid_utf8",
        "Sitemap body is not valid UTF-8",
        document.url,
      ),
    )
    return { parsed: null, validUtf8: false, validXml: false }
  }

  const validation = XMLValidator.validate(xml)
  if (validation !== true) {
    issues.push(
      documentIssue(
        "invalid_xml",
        `Sitemap body is not valid XML: ${validation.err.msg}`,
        document.url,
      ),
    )
    return { parsed: null, validUtf8: true, validXml: false }
  }

  const parsed = asRecord(xmlParser.parse(xml))
  if (!parsed) {
    issues.push(
      documentIssue(
        "invalid_xml",
        "Sitemap XML did not produce an object document",
        document.url,
      ),
    )
  }
  return {
    parsed,
    validUtf8: true,
    validXml: parsed !== null,
  }
}

function childId(url: string): number | null {
  try {
    const match = new URL(url).pathname.match(/\/sitemap\/(\d+)\.xml$/)
    if (!match) return null
    const parsed = Number(match[1])
    return Number.isSafeInteger(parsed) ? parsed : null
  } catch {
    return null
  }
}

type WatchSitemapUrlClassification = {
  contextual: boolean
  eligibleExplicitEnglishAlias: boolean
}

function classifyWatchSitemapUrl(url: string): WatchSitemapUrlClassification {
  try {
    const parsed = new URL(url)
    if (parsed.origin !== "https://www.jesusfilm.org") {
      return { contextual: false, eligibleExplicitEnglishAlias: false }
    }
    const contextual = Boolean(
      parsed.pathname.match(
        /^\/watch\/([^/]+)\.html\/([^/.]+)\/([^/]+)\.html$/,
      ),
    )
    const explicitEnglishMatch = parsed.pathname.match(
      /^\/watch\/([a-z0-9_-]+)\.html\/english\.html$/,
    )
    return {
      contextual,
      eligibleExplicitEnglishAlias: Boolean(
        explicitEnglishMatch?.[1] &&
        isLanguageLessWatchVideoPathEligible(explicitEnglishMatch[1]),
      ),
    }
  } catch {
    return { contextual: false, eligibleExplicitEnglishAlias: false }
  }
}

export function isContextualWatchSitemapUrl(url: string): boolean {
  return classifyWatchSitemapUrl(url).contextual
}

function alternateSignature(
  alternates: Array<{ href: string; hreflang: string }>,
): string {
  const hash = createHash("sha256")
  for (const alternate of alternates
    .map(({ href, hreflang }) => `${hreflang}\0${href}`)
    .sort()) {
    hash.update(alternate)
    hash.update("\n")
  }
  return hash.digest("hex")
}

export function inspectWatchSitemapIndex(
  document: WatchSitemapAuditDocument,
): InspectedIndex {
  const issues: WatchSitemapAuditIssue[] = []
  const inspected = inspectDocument(document, issues)
  const sitemapIndex = asRecord(inspected.parsed?.sitemapindex)
  const sitemapNodes = asArray(sitemapIndex?.sitemap)
  const childUrls = sitemapNodes
    .map((node) => asText(asRecord(node)?.loc))
    .filter((url): url is string => Boolean(url))

  if (
    !sitemapIndex ||
    sitemapNodes.length === 0 ||
    childUrls.length !== sitemapNodes.length
  ) {
    issues.push(
      documentIssue(
        "invalid_index",
        "Expected a sitemapindex containing one loc per sitemap child",
        document.url,
      ),
    )
  }

  const seenUrls = new Set<string>()
  for (const url of childUrls) {
    if (seenUrls.has(url)) {
      issues.push(
        documentIssue(
          "duplicate_child_reference",
          "Sitemap index references a child more than once",
          url,
        ),
      )
    }
    seenUrls.add(url)
  }

  const ids = [...seenUrls]
    .map(childId)
    .filter((id): id is number => id !== null)
    .sort((a, b) => a - b)
  if (ids.length !== seenUrls.size || ids.some((id, index) => id !== index)) {
    issues.push(
      documentIssue(
        "invalid_child_sequence",
        "Sitemap child references must use one contiguous numeric sequence starting at zero",
        document.url,
      ),
    )
  }

  return {
    childUrls,
    index: {
      bytes: document.body.byteLength,
      childCount: childUrls.length,
      status: document.status,
      url: document.url,
      validUtf8: inspected.validUtf8,
      validXml: inspected.validXml,
    },
    issues,
  }
}

export class WatchSitemapAuditSession {
  readonly childReferences: string[]
  readonly index: WatchSitemapAuditIndex

  private readonly actualSignatureByLoc = new Map<string, string>()
  private readonly children: WatchSitemapAuditChild[] = []
  private readonly expectedChildren: Set<string>
  private readonly issues: WatchSitemapAuditIssue[]
  private readonly maxBytes: number
  private readonly maxUrls: number
  private readonly receivedChildren = new Set<string>()
  private readonly requiredSignatureByLoc = new Map<string, string>()
  private readonly urlClassificationByUrl = new Map<
    string,
    WatchSitemapUrlClassification
  >()

  constructor(
    indexDocument: WatchSitemapAuditDocument,
    limits: WatchSitemapAuditLimits = {},
  ) {
    const inspected = inspectWatchSitemapIndex(indexDocument)
    this.childReferences = inspected.childUrls
    this.expectedChildren = new Set(inspected.childUrls)
    this.index = inspected.index
    this.issues = [...inspected.issues]
    this.maxBytes = limits.maxBytes ?? DEFAULT_MAX_SITEMAP_BYTES
    this.maxUrls = limits.maxUrls ?? DEFAULT_MAX_SITEMAP_URLS
  }

  private classifyUrl(url: string): WatchSitemapUrlClassification {
    const cached = this.urlClassificationByUrl.get(url)
    if (cached) return cached
    const classification = classifyWatchSitemapUrl(url)
    this.urlClassificationByUrl.set(url, classification)
    return classification
  }

  addChild(document: WatchSitemapAuditDocument): void {
    const referenceUrl = document.referenceUrl ?? document.url
    if (!this.expectedChildren.has(referenceUrl)) {
      this.issues.push(
        documentIssue(
          "unreferenced_child",
          "Fetched child is not referenced by the sitemap index",
          referenceUrl,
        ),
      )
    }
    if (this.receivedChildren.has(referenceUrl)) {
      this.issues.push(
        documentIssue(
          "duplicate_child_document",
          "Sitemap child was supplied to the audit more than once",
          referenceUrl,
        ),
      )
      return
    }
    this.receivedChildren.add(referenceUrl)

    const childIssues: WatchSitemapAuditIssue[] = []
    const inspected = inspectDocument(document, childIssues)
    this.issues.push(...childIssues)
    const urlset = asRecord(inspected.parsed?.urlset)
    const urlNodes = asArray(urlset?.url)
    let hreflangCount = 0
    let locCount = 0

    if (!urlset) {
      this.issues.push(
        documentIssue(
          "invalid_xml",
          "Expected a urlset document for sitemap child",
          document.url,
        ),
      )
    } else {
      for (const node of urlNodes) {
        const entry = asRecord(node)
        const loc = asText(entry?.loc)
        if (!loc) {
          this.issues.push(
            documentIssue(
              "invalid_xml",
              "Sitemap url entry is missing loc text",
              document.url,
            ),
          )
          continue
        }
        locCount += 1
        const locClassification = this.classifyUrl(loc)
        if (locClassification.contextual) {
          this.issues.push(
            documentIssue(
              "contextual_route",
              "Sitemap canonical entry uses a contextual parent/child route",
              loc,
            ),
          )
        }
        if (locClassification.eligibleExplicitEnglishAlias) {
          this.issues.push(
            documentIssue(
              "explicit_english_alias",
              "Eligible English sitemap entry must use its language-less canonical URL",
              loc,
            ),
          )
        }

        const alternates = asArray(entry?.["xhtml:link"])
          .map((alternate) => asRecord(alternate))
          .filter((alternate): alternate is Record<string, unknown> =>
            Boolean(alternate),
          )
          .map((alternate) => ({
            href: asText(alternate.href),
            hreflang: asText(alternate.hreflang),
            rel: asText(alternate.rel),
          }))
          .filter(
            (
              alternate,
            ): alternate is {
              href: string
              hreflang: string
              rel: string | null
            } => Boolean(alternate.href && alternate.hreflang),
          )
          .filter((alternate) => alternate.rel === "alternate")

        hreflangCount += alternates.length
        const hrefs = alternates.map((alternate) => alternate.href)
        for (const href of hrefs) {
          const hrefClassification = this.classifyUrl(href)
          if (hrefClassification.contextual) {
            this.issues.push(
              documentIssue(
                "contextual_route",
                "Sitemap alternate target uses a contextual parent/child route",
                href,
              ),
            )
          }
          if (hrefClassification.eligibleExplicitEnglishAlias) {
            this.issues.push(
              documentIssue(
                "explicit_english_alias",
                "Eligible English sitemap alternate must use its language-less canonical URL",
                href,
              ),
            )
          }
        }
        const hreflangs = alternates.map((alternate) => alternate.hreflang)
        if (new Set(hreflangs).size !== hreflangs.length) {
          this.issues.push(
            documentIssue(
              "duplicate_hreflang",
              "Canonical entry repeats an hreflang value",
              loc,
            ),
          )
        }
        if (!hrefs.includes(loc)) {
          this.issues.push(
            documentIssue(
              "missing_self_alternate",
              "Canonical entry does not include itself in its alternate set",
              loc,
            ),
          )
        }

        const signature = alternateSignature(alternates)
        if (this.actualSignatureByLoc.has(loc)) {
          this.issues.push(
            documentIssue(
              "duplicate_loc",
              "Canonical URL appears more than once across sitemap children",
              loc,
            ),
          )
        } else {
          this.actualSignatureByLoc.set(loc, signature)
        }

        for (const href of hrefs) {
          const requiredSignature = this.requiredSignatureByLoc.get(href)
          if (requiredSignature && requiredSignature !== signature) {
            this.issues.push(
              documentIssue(
                "non_reciprocal_alternate_set",
                "Alternate sets disagree about the same canonical target",
                href,
              ),
            )
          } else {
            this.requiredSignatureByLoc.set(href, signature)
          }
        }
      }
    }

    if (document.body.byteLength > this.maxBytes) {
      this.issues.push(
        documentIssue(
          "child_too_large",
          `Child is ${document.body.byteLength} bytes; limit is ${this.maxBytes}`,
          document.url,
        ),
      )
    }
    if (locCount > this.maxUrls) {
      this.issues.push(
        documentIssue(
          "child_too_many_urls",
          `Child has ${locCount} loc entries; limit is ${this.maxUrls}`,
          document.url,
        ),
      )
    }

    this.children.push({
      bytes: document.body.byteLength,
      hreflangCount,
      id: childId(referenceUrl),
      locCount,
      referenceUrl,
      status: document.status,
      url: document.url,
      validUtf8: inspected.validUtf8,
      validXml: inspected.validXml,
    })
  }

  finish(): WatchSitemapAuditReport {
    for (const referenceUrl of this.expectedChildren) {
      if (!this.receivedChildren.has(referenceUrl)) {
        this.issues.push(
          documentIssue(
            "missing_child",
            "Sitemap index child was not supplied to the audit",
            referenceUrl,
          ),
        )
      }
    }

    for (const [loc, requiredSignature] of this.requiredSignatureByLoc) {
      const actualSignature = this.actualSignatureByLoc.get(loc)
      if (!actualSignature) {
        this.issues.push(
          documentIssue(
            "alternate_target_missing",
            "Alternate target does not appear as a canonical loc",
            loc,
          ),
        )
      } else if (actualSignature !== requiredSignature) {
        this.issues.push(
          documentIssue(
            "non_reciprocal_alternate_set",
            "Alternate target does not publish the same reciprocal set",
            loc,
          ),
        )
      }
    }

    const children = [...this.children].sort(
      (left, right) =>
        (left.id ?? Number.MAX_SAFE_INTEGER) -
          (right.id ?? Number.MAX_SAFE_INTEGER) ||
        left.referenceUrl.localeCompare(right.referenceUrl),
    )
    const issues = [
      ...new Map(
        this.issues.map((issue) => [
          `${issue.code}\0${issue.message}\0${issue.url ?? ""}`,
          issue,
        ]),
      ).values(),
    ]

    return {
      children,
      index: this.index,
      issues,
      ok: issues.length === 0,
      totals: {
        bytes: children.reduce((sum, child) => sum + child.bytes, 0),
        children: children.length,
        hreflang: children.reduce((sum, child) => sum + child.hreflangCount, 0),
        locs: children.reduce((sum, child) => sum + child.locCount, 0),
      },
    }
  }
}

export function auditWatchSitemapDocuments(
  indexDocument: WatchSitemapAuditDocument,
  childDocuments: readonly WatchSitemapAuditDocument[],
  limits: WatchSitemapAuditLimits = {},
): WatchSitemapAuditReport {
  const session = new WatchSitemapAuditSession(indexDocument, limits)
  for (const child of childDocuments) session.addChild(child)
  return session.finish()
}
