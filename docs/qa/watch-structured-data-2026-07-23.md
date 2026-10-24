# Watch structured-data QA — 2026-07-23

## Purpose

This is the durable evidence record for FGE-8. It separates deterministic
merge gates from preview and post-release evidence. Structured data can improve
machine understanding but does not guarantee indexing, a rich result, or a
ranking change.

## Production baseline

Captured 2026-07-23 from the canonical `www` host with unauthenticated HTTP
requests:

| Route class        | Representative URL                                                                                          | Initial HTML bytes | Actual JSON-LD scripts | Baseline                                                        |
| ------------------ | ----------------------------------------------------------------------------------------------------------- | -----------------: | ---------------------: | --------------------------------------------------------------- |
| Root home          | `https://www.jesusfilm.org/watch`                                                                           |          1,009,697 |                      0 | No page-owned JSON-LD                                           |
| Localized home     | `https://www.jesusfilm.org/watch/spanish-latin-american.html`                                               |            704,048 |                      0 | No page-owned JSON-LD                                           |
| Feature            | `https://www.jesusfilm.org/watch/jesus.html/english.html`                                                   |            523,456 |                      3 | `VideoObject`, schema-only `BreadcrumbList`, related `ItemList` |
| Segment            | `https://www.jesusfilm.org/watch/invitation.html/english.html`                                              |            216,508 |                      3 | Same playable-page pattern                                      |
| Contextual episode | `https://www.jesusfilm.org/watch/creation-to-christ.html/1-the-most-high-god-and-his-creation/english.html` |            209,203 |                      3 | Same playable-page pattern                                      |

Counts parse literal `<script type="application/ld+json">` elements in the
HTTP response. They intentionally ignore JSON-LD strings duplicated inside the
React Server Components payload.

The existing feature entity uses a landing-page `embedUrl`, rounds its runtime
to `PT7674S`, and exposes a `contentUrl` with trailing whitespace. The segment
uses the same false embed contract. These are the primary negative controls.

## Source contracts

- `Video.publishedAt` is synced from Core `publishedAt` in
  `apps/admin/src/services/core-sync/phases/sync-videos.ts`. It is the only
  accepted structured-data publication field. `updatedAt`, locale, Dub, and
  sync timestamps are not fallbacks.
- Playable variants require `published === true` and a nonblank HLS URL in the
  Watch resolver. Structured data additionally trims and validates the URL.
- The representative JESUS Mux master playlist returned `200`,
  `content-type: application/x-mpegURL`, CORS `*`, no authentication or WAF
  challenge, and a stable top-level URL without an expiry query. The playlist's
  signed rendition URLs are an internal delivery detail, not the emitted
  `contentUrl`.
- Caption metadata is eligible only when its exact VTT URL is HTTPS, public,
  non-expiring, and paired with a valid BCP-47 language. It is serialized as
  descriptive Schema.org `caption: MediaObject` data and is not treated as a
  Google Video rich-result eligibility property.

## Production-shaped eligibility inventory

| Route class             | Expected page entity          | Eligible inputs                                                                                                                 | Intentional suppression                                   |
| ----------------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| Root/localized home     | `CollectionPage` + `ItemList` | Initial routable Watch hero plus rendered authored media-card links, first 12 unique canonical destinations                     | Empty/error home; invalid/titleless/non-Watch link        |
| Series                  | `CollectionPage` + `ItemList` | Indexable parent plus visible, routable child records, first 12 unique standalone canonical destinations                        | `noIndex`; zero eligible children                         |
| Feature/segment/episode | Exactly one `VideoObject`     | Nonblank page-specific name/description, video thumbnail, Core publication date, public HLS, BCP-47 language, positive duration | `noIndex` or any required field invalid/missing           |
| Related list            | Plain `ItemList`              | Visible canonical-parent children with valid standalone Watch URLs                                                              | No visible sibling carousel or zero eligible children     |
| Captions                | `caption: MediaObject`        | Public HTTPS VTT plus BCP-47 language                                                                                           | Invalid/private/expiring URL or language                  |
| Key moments             | `SeekToAction`                | Eligible video, runtime at least 30 seconds, proven `?t=` behavior                                                              | Ineligible video, short/missing runtime, or unproven seek |

An unexplained reduction from these expected counts is a release blocker.

## Merge-gating evidence

Completed against the final working tree before commit:

- [x] Builder contract tests
- [x] Root and catch-all route tests
- [x] Initial-response JSON-LD parsing
- [x] Timestamp edge-case tests
- [x] Typecheck, lint, and production build
- [x] Raw HTML size and request-count comparison
- [x] Browser smoke and timestamp deep-link proof

### Automated validation

- Focused Vitest coverage: **275 passed**, **2 pre-existing todos** across
  structured-data builders, metadata, URL probe, both route owners, series UI,
  and `HeroPlayer`.
- `pnpm --filter @forge/web typecheck`: passed.
- `pnpm --filter @forge/web lint`: passed.
- `pnpm --filter @forge/web build`: passed against the isolated Admin service.
  The build retained the existing static/dynamic route classification. The
  sitemap worker logged its known dynamic-server fallback while attempting a
  `revalidate: 0` Admin fetch; the build completed successfully.
- `git diff --check`: passed.

### Production-mode initial-response matrix

The built Web server ran at `http://127.0.0.1:3010` against an isolated Admin
database containing 1,101 videos, 22,872 locales, 210,578 dubs, and a seeded
10-block Watch-home Experience.

| Route class        | Local route                                                                        | Status | HTML bytes | Literal scripts                   | Bounded items |
| ------------------ | ---------------------------------------------------------------------------------- | -----: | ---------: | --------------------------------- | ------------: |
| Root home          | `/watch`                                                                           |    200 |    826,253 | `CollectionPage`                  |            12 |
| Localized home     | `/watch/english.html`                                                              |    200 |    832,133 | `CollectionPage`                  |            12 |
| Series             | `/watch/storyclubs.html/english.html`                                              |    200 |    394,160 | `CollectionPage`                  |            12 |
| Feature            | `/watch/jesus.html/english.html`                                                   |    200 |    682,067 | `VideoObject`, related `ItemList` |            10 |
| Segment            | `/watch/invitation.html/english.html`                                              |    200 |    203,528 | `VideoObject`, related `ItemList` |             9 |
| Contextual episode | `/watch/creation-to-christ.html/1-the-most-high-god-and-his-creation/english.html` |    200 |    204,221 | `VideoObject`, related `ItemList` |             8 |

Every response contained zero `BreadcrumbList`, `FAQPage`, or `Clip` scripts.
Playable entities omitted `embedUrl`. The contextual episode's entity URL and
seek target used its standalone canonical URL while its rendered UI retained
the collection-context link shape.

### Browser proof

- Root home rendered one stable H1, the authored hero, and media rails. Its
  12 schema destinations matched links present in the rendered main content.
- Explicit localized home rendered `inLanguage: "en"`, the localized
  canonical URL, and 12 items.
- StoryClubs rendered 13 contextual episode links while schema used the first
  12 verified standalone canonical child URLs.
- JESUS rendered one `VideoObject` and one plain related `ItemList`, with no
  forbidden entity types.
- The first browser pass exposed a real deferred-player bug: `?t=12` was reset
  to zero when **Watch now** committed playback. After the fix and reload, the
  media element was ready and playing at **13.266 seconds** roughly 1.3 seconds
  after activation, proving the exact `?t=12` contract.
- Browser console: zero errors. Three existing Next Image warnings reported a
  `fill` image under a sticky parent; they are unrelated to JSON-LD and were
  present outside this change.

### Payload and request observations

Using the same live Admin catalog for both responses:

| Route                  | Production HTML | Branch HTML |                  Delta | Production JSON-LD | Branch JSON-LD |
| ---------------------- | --------------: | ----------: | ---------------------: | -----------------: | -------------: |
| `/watch`               |       1,012,881 |   1,014,934 |                 +0.20% |                  0 |          2,364 |
| Spanish localized home |         622,804 |     624,585 |                 +0.29% |                  0 |          2,367 |
| JESUS playable page    |         526,651 |     754,017 | catalog/cache variance |              5,318 |          3,992 |

The home-page deltas are consistent with the new inline scripts. On the video
sample the branch's literal JSON-LD payload is **1,326 bytes smaller** than
production; the larger total response therefore is not caused by the schema
payload and reflects independently changing live content/cache state.

A cache-disabled browser reload observed 114 production requests and 83 local
requests. These counts are supporting evidence only because the origins and
runtime environments differ. The merge-gating architectural fact is stronger:
all schema is inline in the initial response and introduces no client bundle,
JSON-LD fetch, or route dynamism.

### Full URL-probe limitations

The repository's 115-route cutover probe was also run twice and retained at
`/tmp/fge8-watch-url-probe*.json` during verification.

- Against the isolated snapshot it reported older language-root availability
  and no Spanish homepage schema because video snapshots intentionally omit
  authored Experience locales; the English seed proved the same route owner.
- Against live Admin GraphQL, root, Spanish home, and playable schema samples
  passed. The locally fetched route-manifest bearer returned 401 from the live
  Admin REST endpoint, so series schema correctly failed closed in that
  harness. The authenticated isolated Admin proved StoryClubs and LUMO series
  collection output with 12 admitted standalone children.
- Remaining route-status and locale-redirect differences belong to the broader
  Watch cutover fixture set and were present independently of structured-data
  generation. They are not masked or counted as a green FGE-8 gate.

## Validator evidence

Use Schema.org Validator for `CollectionPage` and generic `ItemList`. Use both
Schema.org Validator and Google Rich Results Test for `VideoObject` and
`SeekToAction`. For each representative route record URL, route class, commit,
timestamp, environment, parsed JSON-LD, result, and any tool limitation.

Private or `noindex` previews cannot prove Google acceptance. Deterministic
contract tests and raw-response parsing remain merge gates when an external
validator cannot fetch a preview.

The final environment was localhost-only, so Schema.org Validator and Google
Rich Results Test could not fetch it. Follow up on the first public preview or
deployed URL using the exact representative matrix above; owner: Watch team.
This does not block the deterministic merge gates.

## Post-release Search Console comparison

Before release, export the representative URL inspection state plus Video
indexing, enhancement errors, impressions, clicks, selected canonical, and
locale samples. Annotate the deployment. Compare equivalent 14-day and 28-day
windows only after sampled pages report a crawl later than the deployment.
Treat changes as observational rather than attributing them solely to JSON-LD.
