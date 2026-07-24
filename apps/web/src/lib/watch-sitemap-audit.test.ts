import { describe, expect, it } from "vitest"

import {
  auditWatchSitemapDocuments,
  type WatchSitemapAuditDocument,
} from "./watch-sitemap-audit"

const XML_HEADER = '<?xml version="1.0" encoding="UTF-8"?>'
const INDEX_URL = "https://www.jesusfilm.org/watch/sitemap.xml"
const CHILD_0 = "https://www.jesusfilm.org/watch/sitemap/0.xml"
const CHILD_1 = "https://www.jesusfilm.org/watch/sitemap/1.xml"
const JESUS_EN = "https://www.jesusfilm.org/watch/jesus.html/english.html"
const JESUS_ES =
  "https://www.jesusfilm.org/watch/jesus.html/spanish-castilian.html"
const CONTEXTUAL_EN =
  "https://www.jesusfilm.org/watch/lumo-the-gospel-of-john.html/wedding-in-cana/english.html"

function document(
  url: string,
  xml: string,
  overrides: Partial<WatchSitemapAuditDocument> = {},
): WatchSitemapAuditDocument {
  return {
    body: new TextEncoder().encode(xml),
    contentType: "application/xml; charset=utf-8",
    redirected: false,
    status: 200,
    url,
    ...overrides,
  }
}

function indexXml(childUrls: string[] = [CHILD_0, CHILD_1]): string {
  return `${XML_HEADER}<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${childUrls.map((url) => `<sitemap><loc>${url}</loc></sitemap>`).join("")}</sitemapindex>`
}

function childXml(
  entries: Array<{
    alternates: Array<{ href: string; hreflang: string }>
    loc: string
  }>,
): string {
  return `${XML_HEADER}<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">${entries.map(({ alternates, loc }) => `<url><loc>${loc}</loc>${alternates.map(({ href, hreflang }) => `<xhtml:link rel="alternate" hreflang="${hreflang}" href="${href}" />`).join("")}</url>`).join("")}</urlset>`
}

const reciprocalAlternates = [
  { href: JESUS_EN, hreflang: "en" },
  { href: JESUS_ES, hreflang: "es" },
]

describe("watch sitemap deployed audit", () => {
  it("reports a valid index, child set, and reciprocal alternate graph", () => {
    const report = auditWatchSitemapDocuments(document(INDEX_URL, indexXml()), [
      document(
        CHILD_0,
        childXml([{ loc: JESUS_EN, alternates: reciprocalAlternates }]),
      ),
      document(
        CHILD_1,
        childXml([{ loc: JESUS_ES, alternates: reciprocalAlternates }]),
      ),
    ])

    expect(report).toMatchObject({
      ok: true,
      totals: {
        children: 2,
        hreflang: 4,
        locs: 2,
      },
    })
    expect(report.index).toMatchObject({
      childCount: 2,
      status: 200,
      validUtf8: true,
      validXml: true,
    })
    expect(
      report.children.map(({ id, locCount }) => ({ id, locCount })),
    ).toEqual([
      { id: 0, locCount: 1 },
      { id: 1, locCount: 1 },
    ])
    expect(report.issues).toEqual([])
  })

  it("audits preview responses against canonical index references", () => {
    const report = auditWatchSitemapDocuments(
      document("https://preview.test/watch/sitemap.xml", indexXml()),
      [
        document(
          "https://preview.test/watch/sitemap/0.xml",
          childXml([{ loc: JESUS_EN, alternates: reciprocalAlternates }]),
          { referenceUrl: CHILD_0 },
        ),
        document(
          "https://preview.test/watch/sitemap/1.xml",
          childXml([{ loc: JESUS_ES, alternates: reciprocalAlternates }]),
          { referenceUrl: CHILD_1 },
        ),
      ],
    )

    expect(report.ok).toBe(true)
    expect(report.children[0]).toMatchObject({
      referenceUrl: CHILD_0,
      url: "https://preview.test/watch/sitemap/0.xml",
    })
  })

  it("fails direct HTTP, content, byte, and URL-count gates", () => {
    const oversized = childXml([
      { loc: JESUS_EN, alternates: reciprocalAlternates },
      { loc: JESUS_ES, alternates: reciprocalAlternates },
    ])
    const report = auditWatchSitemapDocuments(
      document(INDEX_URL, indexXml([CHILD_0]), {
        contentType: "text/html",
        redirected: true,
        status: 302,
      }),
      [
        document(CHILD_0, oversized, {
          contentType: null,
          redirected: true,
          status: 301,
        }),
      ],
      {
        maxBytes: 100,
        maxUrls: 1,
      },
    )

    expect(report.ok).toBe(false)
    expect(report.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining([
        "child_too_large",
        "child_too_many_urls",
        "http_redirect",
        "http_status",
        "invalid_content_type",
      ]),
    )
  })

  it("fails malformed XML and invalid UTF-8", () => {
    const report = auditWatchSitemapDocuments(document(INDEX_URL, indexXml()), [
      document(CHILD_0, `${XML_HEADER}<urlset><url></urlset>`),
      document(CHILD_1, "", {
        body: Uint8Array.from([0xc3, 0x28]),
      }),
    ])

    expect(report.ok).toBe(false)
    expect(report.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining(["invalid_utf8", "invalid_xml"]),
    )
  })

  it("fails duplicate index references and noncontiguous child ids", () => {
    const child2 = "https://www.jesusfilm.org/watch/sitemap/2.xml"
    const report = auditWatchSitemapDocuments(
      document(INDEX_URL, indexXml([CHILD_0, CHILD_0, child2])),
      [],
    )

    expect(report.ok).toBe(false)
    expect(report.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining([
        "duplicate_child_reference",
        "invalid_child_sequence",
        "missing_child",
      ]),
    )
  })

  it("fails an empty sitemap index", () => {
    const report = auditWatchSitemapDocuments(
      document(INDEX_URL, indexXml([])),
      [],
    )

    expect(report.ok).toBe(false)
    expect(report.issues).toContainEqual(
      expect.objectContaining({ code: "invalid_index" }),
    )
  })

  it("fails duplicate canonicals, missing self-links, and reciprocity drift", () => {
    const report = auditWatchSitemapDocuments(document(INDEX_URL, indexXml()), [
      document(
        CHILD_0,
        childXml([
          {
            loc: JESUS_EN,
            alternates: [{ href: JESUS_ES, hreflang: "es" }],
          },
        ]),
      ),
      document(
        CHILD_1,
        childXml([
          {
            loc: JESUS_EN,
            alternates: [
              { href: JESUS_EN, hreflang: "en" },
              { href: JESUS_ES, hreflang: "es" },
            ],
          },
          {
            loc: JESUS_ES,
            alternates: [
              { href: JESUS_ES, hreflang: "es" },
              { href: JESUS_EN, hreflang: "es" },
            ],
          },
        ]),
      ),
    ])

    expect(report.ok).toBe(false)
    expect(report.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining([
        "duplicate_hreflang",
        "duplicate_loc",
        "missing_self_alternate",
        "non_reciprocal_alternate_set",
      ]),
    )
  })

  it("fails contextual routes in locs and alternate targets across children", () => {
    const report = auditWatchSitemapDocuments(document(INDEX_URL, indexXml()), [
      document(
        CHILD_0,
        childXml([
          {
            loc: JESUS_EN,
            alternates: [
              { href: JESUS_EN, hreflang: "en" },
              { href: CONTEXTUAL_EN, hreflang: "es" },
            ],
          },
        ]),
      ),
      document(
        CHILD_1,
        childXml([
          {
            loc: CONTEXTUAL_EN,
            alternates: [{ href: CONTEXTUAL_EN, hreflang: "en" }],
          },
        ]),
      ),
    ])

    expect(report.ok).toBe(false)
    expect(
      report.issues.filter((issue) => issue.code === "contextual_route"),
    ).toHaveLength(2)
  })

  it("fails missing, unreferenced, and duplicate child documents", () => {
    const unreferenced = "https://www.jesusfilm.org/watch/sitemap/2.xml"
    const report = auditWatchSitemapDocuments(document(INDEX_URL, indexXml()), [
      document(
        CHILD_0,
        childXml([{ loc: JESUS_EN, alternates: reciprocalAlternates }]),
      ),
      document(
        CHILD_0,
        childXml([{ loc: JESUS_EN, alternates: reciprocalAlternates }]),
      ),
      document(unreferenced, childXml([])),
    ])

    expect(report.ok).toBe(false)
    expect(report.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining([
        "duplicate_child_document",
        "missing_child",
        "unreferenced_child",
      ]),
    )
  })
})
