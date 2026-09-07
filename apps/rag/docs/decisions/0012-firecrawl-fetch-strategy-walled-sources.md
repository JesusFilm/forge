# ADR-0012 — Firecrawl as an optional per-source fetch strategy for walled sources

- Status: Accepted
- Date: 2026-07-22
- Issue/PR: #104 (implements the slot that FOLLOW-UP G / [#8](https://github.com/JesusFilm/jesusfilm-rag/issues/8) had closed as deferred — this ADR ships it)
- Related: ADR-0001 (ports boundary)

## Context

Some sources we want are **walled**: their content pages sit behind a bot wall —
EveryStudent's Cloudflare JS managed challenge — that the plain-HTTP fetcher
cannot pass, because passing requires executing JavaScript to earn the
`cf_clearance` cookie. EveryStudent has been stuck at `Blocked` since slice #2;
KnowGod and Victory Beyond the Cup are unreachable the same way. The forcing
question: how do we acquire walled sources without weeks of out-of-band
coordination while the project is in its prototype phase?

## Decision

Introduce **Firecrawl** — a paid managed scraping service that executes the JS
challenge and returns the rendered page — as an optional, per-source **fetch
strategy**: `fetchStrategy: "firecrawl"` in the source's registry crawl policy,
absent meaning plain HTTP. Firecrawl is strictly a transport behind the
`Fetcher` port (raw rendered HTML, Firecrawl-side cache disabled); discovery,
extraction, chunking, dedup, and the resumable acquire loop are unchanged for
every source. One source, one strategy, for **all** its requests — a static
slice-time choice, no runtime fallback, no per-request mixing. The field never
reaches the persisted source row (registry-only; no migration).

**Authorization posture.** Cru-family public content; read-only,
mission-aligned retrieval in a prototype; no site-owner contact is available and
obtaining one would delay the project; the wall is anti-abuse, not anti-us; and
Firecrawl is a swappable commodity behind the port, so this posture can be
revisited without rework.

## Alternatives rejected

- **Runtime fallback (plain 403 → retry via Firecrawl)** — non-deterministic
  acquisition that hides misclassified sources; walled-ness is a property of the
  source, decided once at slice time.
- **Playwright / local headless-browser adapter** — no per-page fee, but we own
  the challenge-passing arms race. Remains the designated replacement behind the
  same port if Firecrawl is ever blocked or too costly (composition-root swap).
- **Firecrawl SDK + crawl/map/batch endpoints** — we need exactly one scrape
  call; discovery and extraction stay in-repo, so the SDK is surface area
  without benefit. Bare REST instead.
- **Firecrawl's markdown / cleaned-HTML output** — would make Firecrawl a second
  content extractor; `contentSelectors`/`stripSelectors` stay the single owner
  of what counts as content.
- **Out-of-band coordination with site owners (allowlisting)** — right
  long-term, wrong for a prototype: weeks of delay. Revisit before production
  hardening.

## Consequences

- A walled source becomes acquirable by declaring one registry field; the
  everystudent slice resumes as its own piece of work.
- Per-page credit cost (~1 credit/scrape; free tier locally, hobby tier in
  prod). The existing resume-skip avoids re-paying for already-staged pages;
  conditional requests don't exist on this path (`notModified` honestly false).
- `/slice` stage-1 must classify a wall by the Cloudflare **block-page
  signature** (403/503 + interstitial markers), never by the
  `challenge-platform` script reference — served Cloudflare pages carry that
  too, so it false-positives on CF-fronted-but-served sources (thelife, cru).
- `FIRECRAWL_API_KEY` is a conditional secret: required only when a
  firecrawl-declared source is acquired, enforced loudly at wiring time;
  plain-HTTP dev/CI never needs it.
