/**
 * Guards the Watch surface against re-introducing full-document navigation.
 *
 * A raw `<a href>` pointing at an in-app path makes the browser tear the
 * document down and re-execute the whole client bundle before anything
 * paints. Measured on production before this guard existed: 2,284 ms to first
 * paint for a card click, against 56 ms once the same destination went through
 * `next/link` with its destination prefetched. Only 15 KB crossed the wire in
 * the slow case — the cost was re-parsing ~3 MB of already-cached JavaScript.
 *
 * A raw anchor with a correct href type-checks, renders the right URL, passes
 * an href assertion, and works when clicked. It is only slow.
 *
 * There IS a lint rule for this — `@next/next/no-html-link-for-pages`, live at
 * `error` through `eslint-config-next/core-web-vitals` in this app's config.
 * It does not fire, because it returns early on any href that is not a string
 * literal (`no-html-link-for-pages.js:220`: `if (!href || href.value &&
 * href.value.type !== 'Literal')`). Every Watch card href is computed, so the
 * rule skips exactly the shape real code uses.
 *
 * That is the reason this file inverts the default: an href it cannot prove
 * safe is a finding, not a skip. A rule enabled at `error` and a rule that
 * does not exist look identical from outside.
 *
 * WHAT THIS ALLOWS, and why each is not in-app navigation:
 *   - `target="_blank"`      leaves the app by definition
 *   - `download`             a file transfer, not a route change
 *   - an absolute URL literal (`https:`, `mailto:`, `tel:`) — another origin
 *   - a fragment literal (`#top`) — same document, no navigation
 *   - the reviewed Partner and Grow hosted-auth expressions below — cookie-changing
 *     Route Handlers with redirects, not App Router pages
 *
 * Everything else must be `next/link`, or carry an entry in
 * `KNOWN_RAW_NAVIGATION_ANCHORS` naming why it has not converted yet.
 *
 * If this test fails on a file you just touched, the fix is almost always to
 * use `next/link` — not to add an allowlist entry. Note that `next/link`
 * prepends the `/watch` basePath itself, so the href you pass it must be
 * base-path-RELATIVE; hand-prefixing renders `/watch/watch/...`.
 */
import { readdirSync, readFileSync } from "node:fs"
import { join, relative as relativePath } from "node:path"

import { describe, expect, it } from "vitest"

const APP_ROOT = join(__dirname, "..")

/**
 * Files that still navigate through a raw anchor. Each entry is a debt
 * record, not a blessing: the count pins how many exist so a NEW one in an
 * already-listed file still fails.
 */
const KNOWN_RAW_NAVIGATION_ANCHORS: Record<
  string,
  { count: number; reason: string }
> = {
  "components/home/WatchHomeFooter.tsx": {
    count: 2,
    reason:
      "Not in-app navigation. Both hrefs are computed but every value is an absolute https://www.jesusfilm.org/... URL (see FOOTER_LINKS and giveNowHref), so they leave the Watch app the same way the literal footer links do. Listed only because the guard cannot prove a computed href is absolute.",
  },
  "components/sections/MediaCollection.tsx": {
    count: 1,
    reason:
      "Rail CTA. Its destination is admin-authored, so converting it needs the destination classifier applied and an external-vs-internal split, the way WatchHomeCategoryRail does it.",
  },
  "components/sections/CTASection.tsx": {
    count: 1,
    reason: "Authored buttonLink; same conversion as the MediaCollection CTA.",
  },
  "components/sections/PromoBanner.tsx": {
    count: 1,
    reason: "Authored ctaLink; same conversion as the MediaCollection CTA.",
  },
  "components/sections/VideoHero.tsx": {
    count: 1,
    reason: "Authored ctaLink; same conversion as the MediaCollection CTA.",
  },
  "components/sections/Text.tsx": {
    count: 1,
    reason:
      "Authored rich-text link. Can be internal or external, so it needs the classifier before it can become a Link.",
  },
}

/** Opening `<a ...>` tags, including ones whose attributes span lines. */
const ANCHOR_TAG = /<a\s([^>]*?)\/?>/gs

/** A quoted string attribute value: href="..." or href={"..."} */
function literalHref(attrs: string): string | null {
  const doubleQuoted = attrs.match(/\bhref="([^"]*)"/)
  if (doubleQuoted) return doubleQuoted[1]
  const braced = attrs.match(/\bhref=\{\s*["'`]([^"'`]*)["'`]\s*\}/)
  if (braced) return braced[1]
  return null
}

function isNonNavigating(attrs: string): boolean {
  // Leaves the app.
  if (/\btarget=/.test(attrs)) return true
  // Transfers a file rather than changing route.
  if (/\bdownload\b/.test(attrs)) return true

  const href = literalHref(attrs)
  if (href == null) return false // computed — cannot prove it is safe
  // Another origin, or a scheme that is not a page load.
  if (/^(https?:|mailto:|tel:)/i.test(href)) return true
  // Same document.
  if (href.startsWith("#")) return true
  return false
}

type Finding = { file: string; line: number; snippet: string }

/** Every non-test `.tsx` under the app, as paths relative to `APP_ROOT`. */
function collectComponentFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === "__tests__" || entry.name === "node_modules") continue
      collectComponentFiles(full, out)
      continue
    }
    if (!entry.name.endsWith(".tsx")) continue
    if (entry.name.includes(".test.") || entry.name.includes(".stories."))
      continue
    out.push(relativePath(APP_ROOT, full))
  }
  return out
}

function findRawNavigationAnchorsInSource(
  file: string,
  source: string,
): Finding[] {
  const findings: Finding[] = []
  for (const match of source.matchAll(ANCHOR_TAG)) {
    const attrs = match[1]
    if (!/\bhref\b/.test(attrs)) continue
    if (isNonNavigating(attrs)) continue
    // Like AccountControl's location.assign, hosted Auth needs a document
    // navigation: login writes PKCE/state cookies before its external redirect;
    // logout clears session cookies and reloads the return page's account state.
    // Match both the owning file and exact reviewed expressions, never the file
    // alone or an arbitrary /api/auth path. Grow carries only lesson/card return
    // intent through that same login handler. The tests below pin their counts.
    const expression = attrs.match(/\bhref=\{([^}]+)\}/)?.[1]
    if (
      (file === PARTNER_ACCOUNT_FILE &&
        PARTNER_AUTH_HREFS.some(
          (href) =>
            expression?.replace(/\s+/g, "") === href.replace(/\s+/g, ""),
        )) ||
      (file === GROW_COURSE_FILE &&
        expression?.replace(/\s+/g, "") === GROW_AUTH_HREF.replace(/\s+/g, ""))
    )
      continue
    findings.push({
      file,
      line: source.slice(0, match.index).split("\n").length,
      snippet: attrs.replace(/\s+/g, " ").trim().slice(0, 100),
    })
  }
  return findings
}

function findRawNavigationAnchors(): Finding[] {
  return collectComponentFiles(APP_ROOT).flatMap((file) =>
    findRawNavigationAnchorsInSource(
      file,
      readFileSync(join(APP_ROOT, file), "utf8"),
    ),
  )
}

const PARTNER_ACCOUNT_FILE = "components/watch/WatchPartnerAccount.tsx"
const PARTNER_AUTH_HREFS = [
  'watchAccountAuthUrl("login", session.loginUrl)',
  'watchAccountAuthUrl("logout")',
]

describe("hosted Partner auth document navigation", () => {
  it.each(PARTNER_AUTH_HREFS)(
    "permits only the reviewed auth boundary %s",
    (href) => {
      expect(
        findRawNavigationAnchorsInSource(
          PARTNER_ACCOUNT_FILE,
          `<a href={${href}}>Account</a>`,
        ),
      ).toEqual([])
    },
  )

  it.each([
    '<a href="/watch/history">History</a>',
    "<a href={historyHref}>History</a>",
    '<a href={watchAccountAuthUrl("session")}>Session</a>',
    '<a href={watchAccountAuthUrl("login", arbitraryUrl)}>Login</a>',
  ])(
    "still rejects ordinary or unreviewed links in the auth component: %s",
    (source) => {
      expect(
        findRawNavigationAnchorsInSource(PARTNER_ACCOUNT_FILE, source),
      ).toHaveLength(1)
    },
  )

  it("does not exempt the same helper expression in another component", () => {
    for (const href of PARTNER_AUTH_HREFS) {
      expect(
        findRawNavigationAnchorsInSource(
          "components/Other.tsx",
          `<a href={${href}}>Account</a>`,
        ),
      ).toHaveLength(1)
    }
  })

  it("pins exactly one of each reviewed auth link and still catches a third ordinary link", () => {
    const source = readFileSync(join(APP_ROOT, PARTNER_ACCOUNT_FILE), "utf8")
    const expressions = [...source.matchAll(ANCHOR_TAG)].map((match) =>
      match[1].match(/\bhref=\{([^}]+)\}/)?.[1].replace(/\s+/g, ""),
    )
    expect(expressions).toEqual(
      PARTNER_AUTH_HREFS.map((href) => href.replace(/\s+/g, "")),
    )
    expect(
      findRawNavigationAnchorsInSource(
        PARTNER_ACCOUNT_FILE,
        source + '<a href="/watch/history">History</a>',
      ),
    ).toHaveLength(1)
  })
})

const GROW_COURSE_FILE = "components/watch/WatchGrowProgressCourse.tsx"
const GROW_AUTH_HREF = `watchGrowLoginUrl(
  lessonId,
  currentCard,
  session.status === "signed-out" ? session.loginUrl : undefined,
)`

describe("hosted Grow auth document navigation", () => {
  it("permits the reviewed login boundary with lesson and card return intent", () => {
    expect(
      findRawNavigationAnchorsInSource(
        GROW_COURSE_FILE,
        `<a href={${GROW_AUTH_HREF}}>Sign in</a>`,
      ),
    ).toEqual([])
  })

  it.each([
    '<a href="/watch/history">History</a>',
    "<a href={historyHref}>History</a>",
    "<a href={watchGrowLoginUrl(lessonId, currentCard, arbitraryUrl)}>Login</a>",
    '<a href="/watch/api/auth/login">Login</a>',
    "<a href={session.loginUrl}>Login</a>",
  ])("still rejects ordinary or unreviewed Grow links: %s", (source) => {
    expect(
      findRawNavigationAnchorsInSource(GROW_COURSE_FILE, source),
    ).toHaveLength(1)
  })

  it("does not exempt the Grow expression in another component", () => {
    expect(
      findRawNavigationAnchorsInSource(
        "components/Other.tsx",
        `<a href={${GROW_AUTH_HREF}}>Sign in</a>`,
      ),
    ).toHaveLength(1)
  })

  it("pins exactly one reviewed login link and still catches an added ordinary link", () => {
    const source = readFileSync(join(APP_ROOT, GROW_COURSE_FILE), "utf8")
    const expressions = [...source.matchAll(ANCHOR_TAG)].map((match) =>
      match[1].match(/\bhref=\{([^}]+)\}/)?.[1].replace(/\s+/g, ""),
    )
    expect(expressions).toEqual([GROW_AUTH_HREF.replace(/\s+/g, "")])
    expect(
      findRawNavigationAnchorsInSource(
        GROW_COURSE_FILE,
        source + '<a href="/watch/history">History</a>',
      ),
    ).toHaveLength(1)
  })
})

describe("in-app navigation goes through next/link", () => {
  it("has no unaccounted raw anchor navigating to an in-app path", () => {
    const findings = findRawNavigationAnchors()

    const byFile = new Map<string, Finding[]>()
    for (const finding of findings) {
      const list = byFile.get(finding.file) ?? []
      list.push(finding)
      byFile.set(finding.file, list)
    }

    const unexpected: string[] = []
    for (const [file, list] of byFile) {
      const allowed = KNOWN_RAW_NAVIGATION_ANCHORS[file]
      if (allowed == null) {
        unexpected.push(
          `${file} — ${list.length} raw navigation anchor(s), none expected:\n` +
            list
              .map((f) => `      line ${f.line}: <a ${f.snippet}>`)
              .join("\n"),
        )
        continue
      }
      if (list.length > allowed.count) {
        unexpected.push(
          `${file} — ${list.length} raw navigation anchors, only ${allowed.count} accounted for.\n` +
            `      Known debt: ${allowed.reason}\n` +
            list
              .map((f) => `      line ${f.line}: <a ${f.snippet}>`)
              .join("\n"),
        )
      }
    }

    expect(
      unexpected,
      unexpected.length === 0
        ? ""
        : `\nRaw <a href> to an in-app path re-executes the whole JS bundle on click.\n` +
            `Use next/link instead (pass a base-path-RELATIVE href — Link adds /watch itself).\n\n` +
            unexpected.join("\n\n") +
            `\n`,
    ).toEqual([])
  })

  /**
   * Keeps the allowlist from outliving its debt. If a listed file converts to
   * `next/link` and nobody removes its entry, the allowlist silently starts
   * permitting a future regression in that file.
   */
  it("has no stale allowlist entry", () => {
    const findings = findRawNavigationAnchors()
    const counts = new Map<string, number>()
    for (const finding of findings) {
      counts.set(finding.file, (counts.get(finding.file) ?? 0) + 1)
    }

    const stale = Object.entries(KNOWN_RAW_NAVIGATION_ANCHORS)
      .filter(([file, { count }]) => (counts.get(file) ?? 0) < count)
      .map(
        ([file, { count }]) =>
          `${file} — allowlisted ${count}, found ${counts.get(file) ?? 0}. Lower the count or delete the entry.`,
      )

    expect(stale).toEqual([])
  })
})
