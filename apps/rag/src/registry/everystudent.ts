/**
 * EveryStudent — English (everystudent.com). Cru's seeker-facing Q&A site:
 * short apologetics/life-issue articles aimed at students who are not
 * believers. Slice #8; planned in #112.
 *
 * **The first WALLED source (ADR-0012).** everystudent.com serves a Cloudflare
 * JS managed challenge that our undici fetcher cannot pass (clearing it needs
 * JS execution to earn the `cf_clearance` cookie), so this entry declares
 * `fetchStrategy: "firecrawl"` — verified working against this domain
 * unmodified (#114). The wall has TIGHTENED since the 2026-05-25 probe: the
 * homepage and `/sitemap.xml` now 403 as well, and only `robots.txt` answers
 * plain HTTP. Every request this source makes is therefore billed per page
 * (measured 1 credit/page, not the 5 a walled page bills in general — Firecrawl's
 * `basic` proxy clears this host so `auto` never escalates; re-measure before
 * any large re-crawl).
 *
 * **Hand-listed seeds, not a discovery crawl** — deliberately, on cost grounds.
 * `/sitemap.xml` is unreachable to plain HTTP, and #114 already paid to
 * enumerate the site via Firecrawl's `/v2/map` (167 URLs, 1 credit flat, full
 * inventory preserved as a comment on that issue). Re-discovering would re-pay
 * for knowledge we already hold, so the mapped inventory is lifted here
 * directly. `sitemaps` is intentionally absent.
 *
 * **116 seeds from the 167 mapped.** Dropped as non-article chrome: the
 * homepage, `/contact.php`, `/donate`, `/quiz`, `/sitemap.html`, the bare
 * `/podcasts` index, 10 `/menus/*` section indexes, and the two `search.html`
 * pages. Dropped as DUPLICATES: all 32 `/podcasts/*` pages — each is an audio
 * read-aloud of an article that already exists under `/wires/` or `/features/`,
 * with the transcript inlined ("LISTEN TO ARTICLE: <title>" … "Transcript:").
 * Measured 2026-07-24: `/podcasts/loneliness.html` shares **93.8%** of its
 * 12-word shingles with `/wires/loneliness.html`; 18 of the 32 carry an exact
 * article slug twin and most of the rest are renames (`whowas` ↔
 * `who-was-jesus`, `isthere` ↔ `is-there-a-god`, `political-views` ↔
 * `the-politics-of-jesus`). Ingesting them would have paid 32 credits to add 32
 * near-duplicate documents the doc-level content hash cannot collapse.
 * `/videos/*` are KEPT: probed and found to be genuine unique testimony
 * transcripts, not media stubs (`/videos/lacey-sturm.html`, ~4.1k chars, has no
 * article twin) — though the handful with a `-video` suffix may echo their
 * article counterpart; check at Stage 4.
 *
 * **robots.txt honoured** — `/4laws.html`, `/jdquestions.html`, `/team/*`,
 * `/admin/*`, `/mobi/*`, `/sys/*`, `/mypage/*`, `/atools/*`, `/email/*` and the
 * contact pages are disallowed. None of them appear in the seed list (checked
 * against the live robots.txt 2026-07-24). No `block` array is declared because
 * it would be dead config: `block` filters DISCOVERED urls, and a seed-only
 * source never discovers any — the seed list itself is the filter. Anything
 * added here later must be re-checked against robots.txt by hand.
 *
 * **Extraction.** `.content4` / `.content4b` (plus `.articletitle`,
 * `.contentpadding`) — the same template as the 48 non-walled sibling domains
 * (#111). The strip list is tuned beyond the usual boilerplate: `sitelevel_noindex`
 * (the site's own "do not index" wrapper around share links and related-article
 * cards) and `.fccell` (the "FEATURE CLOSE" call-to-action table — "I just asked
 * Jesus into my life…", "I have a question or comment…" — appended verbatim to
 * every article). Both were measured stripping ~275–360 chars of pure chrome per
 * page and leaving articles ending cleanly on their own last line. This is the
 * slice-#2 accordion-TOC citation-quality problem handled at the source.
 *
 * **Language: `["en"]` — declared, not assumed.** All 167 mapped URLs are
 * English; the Arabic (everyarabstudent.com) and French (questions2vie.com)
 * banners are separate DOMAINS and therefore separate source keys and separate
 * slices (ADR-0006), and `/menus/intl.html` — the page linking out to them — is
 * dropped as an index page. The stored per-document label still comes from
 * content detection at ingest (invariant 6), never from this field.
 *
 * `requestDelayMs` is modest because Firecrawl fronts the requests: the politeness
 * that matters is Firecrawl's own egress, and each scrape already takes seconds.
 */
import type { SourceEntry } from "./types.js"

export const everystudent: SourceEntry = {
  key: "everystudent",
  name: "EveryStudent",
  domain: "www.everystudent.com",
  trust: "partner",
  ingestionMode: "html-scrape",
  languages: ["en"],
  defaultTags: ["everystudent", "cru", "topic:seeker", "lang:en"],
  defaultCategory: "article",
  rights:
    "© EveryStudent.com (Cru) — partner ministry content; used for retrieval/attribution.",
  crawl: {
    baseUrl: "https://www.everystudent.com",
    // ADR-0012: the wall is unpassable to plain HTTP, so EVERY request is billed.
    fetchStrategy: "firecrawl",
    seedPaths: [
      "/faq/LGBTQ.html",
      "/faq/astrology.html",
      "/faq/believe.html",
      "/faq/crisis.html",
      "/faq/exists.html",
      "/faq/intimacy.html",
      "/faq/kindness.html",
      "/faq/know.html",
      "/faq/loneliness.html",
      "/faq/peace.html",
      "/faq/philosophy-of-life.html",
      "/faq/religions.html",
      "/faq/self-esteem.html",
      "/features/acceptance.html",
      "/features/bible.html",
      "/features/blues.html",
      "/features/christmas.html",
      "/features/faith.html",
      "/features/is-there-a-god.html",
      "/features/kindness.html",
      "/features/know-God.html",
      "/features/marriage.html",
      "/features/martin-luther-king-jr.html",
      "/features/peace-of-mind.html",
      "/features/quench.html",
      "/features/real-life.html",
      "/features/religions-of-the-world.html",
      "/features/sawyer.html",
      "/features/source.html",
      "/features/truth.html",
      "/features/where-is-god.html",
      "/features/whypick.html",
      "/features/wolves.html",
      "/forum/adam2.html",
      "/forum/contradictions.html",
      "/forum/difference.html",
      "/forum/end-of-the-world.html",
      "/forum/historical-jesus.html",
      "/forum/holy-spirit.html",
      "/forum/miracles2.html",
      "/forum/nightclub.html",
      "/forum/reincarnation.html",
      "/forum/trinity.html",
      "/forum/what-is-heaven-like.html",
      "/forum/why-believe-in-jesus.html",
      "/forum/why-do-we-worship-god.html",
      "/forum/woman.html",
      "/journeys/nothing.html",
      "/journeys/now.html",
      "/journeys/then.html",
      "/journeys/why.html",
      "/knowingGod.html",
      "/reasons-to-believe.html",
      "/videos/collins.html",
      "/videos/does-god-exist.html",
      "/videos/existence.html",
      "/videos/gods-help.html",
      "/videos/is-god-good.html",
      "/videos/jobsearch.html",
      "/videos/joel.html",
      "/videos/kindness-of-god-video.html",
      "/videos/know-God-video.html",
      "/videos/lacey-sturm.html",
      "/videos/lisa.html",
      "/videos/lovehate.html",
      "/videos/mariam.html",
      "/videos/nick-vujicic.html",
      "/videos/plates.html",
      "/videos/universe2.html",
      "/videos/yoav.html",
      "/wires/a-guide-to-finding-faith.html",
      "/wires/addiction.html",
      "/wires/anxiety.html",
      "/wires/apostles.html",
      "/wires/are-you-hurting.html",
      "/wires/atheist.html",
      "/wires/bullying.html",
      "/wires/chakra-healing.html",
      "/wires/climate-change.html",
      "/wires/created.html",
      "/wires/devil.html",
      "/wires/disaster.html",
      "/wires/elephant.html",
      "/wires/gaming.html",
      "/wires/gay-lesbian.html",
      "/wires/god-created.html",
      "/wires/how-God-guides.html",
      "/wires/how-to-be-sure-of-heaven.html",
      "/wires/how-to-believe-in-god.html",
      "/wires/how-to-pray.html",
      "/wires/inevitable.html",
      "/wires/is-god-real.html",
      "/wires/jesus-and-women.html",
      "/wires/jesus-god.html",
      "/wires/jesus-in-islam.html",
      "/wires/judaism.html",
      "/wires/laws-of-nature.html",
      "/wires/loneliness.html",
      "/wires/marcia-montenegro.html",
      "/wires/miracles-of-jesus.html",
      "/wires/my-mormon-beliefs.html",
      "/wires/nineteen.html",
      "/wires/poor.html",
      "/wires/purpose-in-life.html",
      "/wires/rabi.html",
      "/wires/radical.html",
      "/wires/relationship-with-god.html",
      "/wires/religions.html",
      "/wires/self-esteem.html",
      "/wires/show-me-god.html",
      "/wires/the-politics-of-jesus.html",
      "/wires/universe.html",
      "/wires/value-of-philosophy.html",
      "/wires/who-is-god.html",
      // "/wires/who-was-jesus.html" — REMOVED 2026-08-06. 22,465 chars of
      // curated highlights from the Gospel of John, carrying this estate's own
      // formula: "excerpts straight from the Gospel of John … no commentary
      // added". Because it is predominantly Bible-translation text, it stays
      // quarantined until its translation, rights holder, reuse terms, and
      // required attribution are known and representable. The same temporary
      // rule covers the full Gospel-of-John pages and the Arabic sibling's
      // /bible/**.pdf files. All 13 copies across the estate went
      // together (campaign #111 §0.13). A `block` rule would be dead config
      // here — `block` filters DISCOVERED urls and this is a seed-only source,
      // so removing the seed is the only thing that works.
      "/wires/why-did-jesus-die.html",
      "/wires/will-God-forgive-me.html",
    ],
    // No `sitemaps`: discovery was already paid for (#114). See the header.
    contentSelectors: [
      ".content4",
      ".content4b",
      ".articletitle",
      ".contentpadding",
    ],
    stripSelectors: [
      "script",
      "style",
      "noscript",
      "svg",
      "nav",
      "header",
      "footer",
      "form",
      // Site-specific chrome, measured 2026-07-24 (see header):
      "sitelevel_noindex", // share links + "Other articles you might like" cards
      ".relatedbottom", // related-article thumbnails
      ".fccell", // the "FEATURE CLOSE" call-to-action table appended to every article
      ".hr2",
      ".articledivider",
    ],
    // Firecrawl fronts every request; a scrape already takes seconds.
    requestDelayMs: 1000,
    maxPages: 200, // 116 seeds + headroom
    minContentLength: 250,
  },
}
