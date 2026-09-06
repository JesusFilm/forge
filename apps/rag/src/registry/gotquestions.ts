/**
 * GotQuestions.org — English slice of a same-domain multilingual source.
 *
 * The site publishes a flat English sitemap: both answer articles and navigation
 * pages use `/<slug>.html`, so discovery needs an explicit negative policy for
 * known index/utility families. The dry-discovery checkpoint audits the complete
 * kept set before any crawl budget is approved.
 *
 * Translations also live on this domain (`/Arabic/`, `/Francais/`, etc.). They
 * deliberately remain outside this English policy for now, but will extend this
 * SAME source key through the later multilingual campaign. Language is always
 * detected from extracted document content at ingest.
 */
import type { SourceEntry } from "./types.js"

export const gotquestions: SourceEntry = {
  key: "gotquestions",
  name: "GotQuestions",
  domain: "www.gotquestions.org",
  trust: "trusted",
  ingestionMode: "html-scrape",
  languages: ["en"],
  defaultTags: ["gotquestions", "bible-questions", "theology", "seeker-qa"],
  defaultCategory: "theology",
  rights:
    "Got Questions Ministries — publicly accessible teaching; citations and canonical URLs preserved; not redistributed.",
  crawl: {
    baseUrl: "https://www.gotquestions.org",
    sitemaps: ["/sitemap.xml"],
    allow: ["^https://www\\.gotquestions\\.org/[^/?#]+\\.html$"],
    articleHints: ["^https://www\\.gotquestions\\.org/[^/?#]+\\.html$"],
    block: [
      // Topic/listing families. They share the articles' flat .html shape.
      "^https://www\\.gotquestions\\.org/content(?:_|\\.html$)",
      "^https://www\\.gotquestions\\.org/questions_",
      "^https://www\\.gotquestions\\.org/top20(?:-|\\.html$)",
      // Site operations, indexes, and media hubs rather than answer articles.
      "^https://www\\.gotquestions\\.org/(?:whats-new|questweek(?:-archive)?|archive|sitemap|faith|about|GotQuestions-expertise|privacy|copyright|citation|Bible-Questions|international|support|donate(?:-monthly)?|Got-Questions-Video|subscribe|search)\\.html$",
      // Live-sitemap utilities measured without an articleBody container. Most
      // clear the length floor via form/chrome text, so URL exclusion is required.
      "^https://www\\.gotquestions\\.org/(?:alexa|advertising|thankyou|apply-confirm|forums|Gospel-presentations|survey-confirm|contact|bookconfirm|apply|president|S-Michael-Houdmann|staff-survey-confirm|bookletconfirm|church-finder|survey|history|testimonials|testimony-featured|testimonials2|video-contest|apps|guidelines)\\.html$",
    ],
    // The measured answer container excludes the Question/Answer chrome,
    // related links, adverts, subscription prompts, and global navigation.
    contentSelectors: ['[itemprop="articleBody"]'],
    stripSelectors: ["script", "style", "noscript", "svg"],
    requestDelayMs: 1500,
    // 10,565 kept on 2026-08-21; ~4% headroom for the actively updated sitemap.
    // The operator still gates the full crawl and embedding spend.
    maxPages: 11000,
    minContentLength: 250,
  },
}
