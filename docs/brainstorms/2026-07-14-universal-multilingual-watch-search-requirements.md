---
date: 2026-07-14
topic: universal-multilingual-watch-search
---

# Universal Multilingual Watch Search

## Problem Frame

Watch search needs to replace the current Algolia-shaped experience with a
Forge-native universal search engine before Watch, mobile, and TV become hard
production contracts. Viewers arrive with different intents: some know the
exact film or series they want, some want a specific film in a target language,
and others search from felt needs, Bible topics, questions, or scene-like
descriptions.

The catalog is multilingual but uneven. Forge has thousands of audio languages,
metadata in a limited set of languages, transcript embeddings for many
`(video edition, language)` transcript sources, and video-level metadata that
is not necessarily tied to a dub. The existing `query + locale` search model
compresses too many concepts into one field and prevents the product from using
the multilingual corpus well.

This work should be treated as a search v2 opportunity. The existing public
search contract, ranking layer, and Algolia parity assumptions are not sacred.
The already-produced transcript embeddings and database storage should remain a
core asset.

Search v2 must meet or beat the current Algolia-shaped experience for known
title lookup and title-plus-language lookup before it replaces the existing
viewer search path. The larger goal is universal multilingual discovery, but
the replacement must not regress the two jobs users already expect search to
handle well.

## Viewer Jobs

- **I know what I want:** The viewer searches for an exact film, series,
  collection, source, or known title variant.
- **I need it in this language:** The viewer searches for a known title plus a
  target watch language, or uses a language filter to find watchable content.
- **I need something for this felt need:** The viewer searches by topic,
  question, Bible reference, scene description, or felt need, such as grief,
  forgiveness, fear, parenting, prayer, healing, or non-English equivalents.

## Language Glossary

- **Query language:** The detected language of the typed query text.
- **Named language:** A language explicitly mentioned in the query, such as
  `Russian` in `JESUS film Russian`.
- **Target watch language:** The resolved language the viewer wants to watch or
  listen in. This is the primary availability target.
- **Display language:** The language used for UI labels and result card copy.
- **Evidence language:** The language of the match evidence, such as a
  transcript chunk, metadata field, or title variant.
- **Availability language:** A media availability language, split by capability
  such as audio, subtitles, transcript, or localized metadata.
- **Fallback language:** A watchable language offered when no strong result
  exists in the target watch language.

## Product Decisions

- **P0 shape:** Approved. P0 is Watch web first with exact/title/entity,
  language availability, and existing transcript semantic evidence. Mobile/TV,
  curated metadata/topic lanes, richer typo fallback, and deeper analytics are
  later phases.
- **Watchability:** Target-language audio is the primary definition of
  available/watchable. Target-language subtitles are a valid fallback, but must
  be labeled differently from audio availability. Other-language fallback is
  allowed when useful, but must be clearly separated from target-language
  availability.
- **Language conflicts:** A language conflict means different signals point to
  different target watch languages. Example: the dropdown says Spanish, but the
  query says `JESUS film Russian`. The product rule is that an explicit
  dropdown/filter remains the target watch language; the query-named language
  becomes a secondary interpretation the UI can expose or offer as a refinement.
- **Analytics privacy posture:** Use privacy-minimized analytics by default:
  per-search request IDs, no stable user stitching, minimized ranked-result
  context, and raw query text only in restricted/retained sinks if needed for
  relevance review.

## Requirements

**Universal Query Intent**

- R1. Search must support exact catalog lookup, language availability lookup,
  and felt-need/topic discovery from the same user-facing search entry point.
- R2. Exact title, known film, series, collection, brand, and source queries
  must preserve exactness; semantic similarity must not outrank a strong
  canonical catalog match.
- R3. Queries that combine content identity and target language, such as
  `JESUS film Russian`, must prioritize the matching title/entity plus
  availability in the requested language.
- R4. Felt-need, Bible/topic, question, and scene-like queries must use semantic
  evidence and, when available, curated metadata so they can succeed even when
  the exact words are absent from titles. P0 only promises baseline discovery
  from existing transcript semantic evidence; curated metadata/topic ranking is
  P1.
- R5. Mixed-language queries must be valid inputs. Search should handle an
  English title with a native language name, a native-language topical query,
  and an English topical query with a target language request.

**Language And Context Signals**

- R6. Search must distinguish query language, target watch language, display
  language, evidence language, and availability language instead of treating one
  `locale` as the whole search context.
- R7. Search must accept multiple language signals with preserved source:
  explicit dropdown/filter language, language named in the query, current video
  or audio language, detected query language, route/site language, and
  `Accept-Language` headers.
- R8. Language signals must be classified as hard constraints, preferences, or
  defaults. A submitted language filter is a hard target-watch-language
  constraint. A language named in the query is a strong preference unless the
  user has also submitted a conflicting explicit filter. Current watch language,
  route locale, and `Accept-Language` are defaults.
- R9. Current video/audio language is a strong contextual signal when search is
  launched from a watch context, but it must not override an explicit dropdown
  or language named in the query.
- R10. `Accept-Language` is a weak defaulting signal, useful when no stronger
  language signal exists.
- R11. Route/site locale is primarily a UI/display signal; it must not be
  assumed to be the viewer's target watch language when stronger search signals
  disagree.
- R11a. When the filter and query disagree, search must preserve the submitted
  filter as the target watch language and also return an explicit
  query-named-language interpretation so the client can explain or offer the
  alternative, for example `Searching Spanish; Russian was mentioned in your
query`.
- R11b. If no filter is selected and the query names a language, search should
  treat the named language as the target watch language and return it as an
  inferred, removable filter state.

**Retrieval And Ranking**

- R12. Search may replace the Admin-backed public GraphQL viewer search
  contract consumed by web, mobile, and TV if doing so better serves universal
  search. Existing APIs should not constrain the target product behavior, but
  the implementation may replace the existing viewer search contract directly.
  The plan must still regenerate Admin GraphQL outputs and
  `packages/admin-graphql`, then update the active Watch web search path in the
  same rollout.
- R13. Existing transcript embeddings and their database storage remain in
  scope as a core semantic evidence source.
- R14. Retrieval should combine evidence lanes rather than one monolithic
  embedding blob. P0 lanes are exact/title/entity, language availability, and
  existing transcript semantic evidence. Curated metadata/topic evidence and
  richer keyword or typo fallback are P1 unless existing infrastructure makes
  them cheap and bounded.
- R15. Metadata should be curated and source-labeled before it influences
  ranking. Search should not blindly embed every metadata field into one
  undifferentiated vector.
- R16. Results must carry match evidence sufficient to explain and debug why
  the result ranked: for example title match, availability match, transcript
  chunk, metadata/topic match, Bible reference, collection/source match, or
  fallback keyword match.
- R17. When semantic evidence comes from a language different from the target
  watch language, search must preserve that distinction internally and avoid
  presenting misleading localized snippets.
- R18. Ranking must consider watchability in the target or inferred language,
  including audio availability, subtitle-only availability, and fallback
  language availability.
- R18a. Planning must define watchability at the edition/dub/subtitle level,
  including publication state, edition matching, audio priority, subtitle-only
  treatment, and what the result card should say when metadata, evidence, and
  media availability languages disagree.
- R18b. Universal retrieval must be bounded by explicit lane budgets: maximum
  evidence languages searched per request, candidate windows per lane,
  per-lane timeout, embedding timeout/cache behavior, and whether fallback lanes
  run eagerly or only after weak primary results. P0 should start with a small
  evidence-language set such as target language, query language, and at most
  one fallback language, then validate query plans against production-scale
  data.
- R18c. Public viewer search must filter result candidates, evidence,
  availability, and actions through viewer-safe publication and entitlement
  rules before returning ranked output or debug output. Unpublished editions,
  unavailable dubs, internal collections, admin-only metadata, and non-public
  transcript sources must not be revealed through results, fallback messages,
  analytics, or debug payloads.

**Result Experience**

- R19. Search results must return enough structured language and availability
  information for Watch web to build coherent P0 result cards, while keeping
  the contract future-compatible with mobile and TV.
- R20. Result cards should be able to show lightweight trust signals such as
  `Available in Russian audio`, `Spanish subtitles`, `Matched title`, or
  `Matched transcript`.
- R21. Search should support videos, series, collections, and experiences
  without requiring each client to infer those shapes from sparse result data.
  P0 must support videos, series, and collections; experiences are included in
  P0 only if they fit the same result contract without a materially different
  shape.
- R22. If no strong result exists in the requested language, search should offer
  useful fallback behavior rather than a silent empty state. The fallback must
  make clear whether content is available in another language or only via
  subtitles.
- R22a. The result contract must define minimum card fields by result type:
  primary title, fallback title, result type, thumbnail/media identity,
  watchability status, availability languages, evidence summary, and primary
  action. Clients may choose different density, but must not invent language or
  availability logic locally.
- R22b. Result explanations must distinguish availability signals from match
  signals. Availability badges such as audio and subtitles outrank evidence
  badges such as transcript or topic match in consumer UI.
- R22c. Fallback states must be explicit: no results at all, exact title exists
  but not in target audio, result exists only with subtitles, strong semantic
  match exists in another evidence language, and fallback language is available.
- R22d. The shared contract should be client-neutral enough for later TV and
  mobile adoption, but P0 acceptance is based on Watch web. TV focus behavior,
  mobile truncation rules, and client-specific card density are P1 design
  requirements unless they affect schema correctness.

**Learning Loop**

- R23. Search must record privacy-minimized request, click, no-result, and
  latency behavior in P0. Over time, it should add impression, load-more, and
  refinement behavior with enough ranked-result context to evaluate and improve
  relevance.
- R24. For each submitted search, analytics should identify the search request,
  inferred intent, language signals, query length/classification, ranker
  version, retrieval lanes used, result count, no-result state, and latency.
  Exact query text is conditional, not a baseline analytics field.
- R25. For result impressions, analytics should record a minimized ordered
  result set: positions, stable result identities, result types, coarse
  availability language, coarse evidence lane, and ranker version. It must not
  store snippets, transcript chunks, embeddings, vector distances, or hydrated
  result payloads.
- R26. For result clicks, analytics should record the clicked result, clicked
  position, search request identity, time since impression when available, and
  enough preceding-result context to evaluate ranking without storing full
  payloads.
- R27. The initial learning loop should collect clean data for offline analysis
  and ranking evaluation. Automatic personalization or auto-reranking from
  click data is deferred until the event data is trustworthy.
- R28. Search analytics must exclude direct user identity, auth tokens, bearer
  keys, cookies, IP addresses, stable device identifiers, bearer-derived
  identifiers, and other sensitive account data. Use non-linkable per-search
  request IDs by default; do not stitch searches across sessions unless a
  privacy-reviewed product decision explicitly approves it.
- R28a. Exact query text may be collected only in approved sinks with retention
  limits, access logging, least-privilege access, and redaction for obvious
  email addresses, phone numbers, URLs with tokens, bearer/API keys, and other
  high-risk secrets. Routine dashboards should prefer normalized query features
  over raw query text.
- R28b. User-facing evidence, developer debug evidence, and analytics evidence
  must be separate. Public clients receive only safe product evidence;
  analytics receives evidence lane labels and IDs; debug payloads are gated,
  redacted, and disabled for public clients by default.
- R28c. Rare language/context combinations are privacy-relevant even when no
  account identifier is stored. The final analytics schema, retention policy,
  dashboard access, and debug tooling require pre-launch privacy review.
- R28d. Public request inputs must be bounded and validated: query length,
  language list size, result type enum values, `limit`, `rankerVersion`, and
  debug behavior. Rate limits, bot mitigation, cache behavior, and degraded
  responses for repeated expensive queries are P0 edge controls.

**Performance And Production Measurement**

- R29. Search must have explicit production latency targets before launch, with
  separate expectations for initial search, load-more, and degraded/fallback
  paths.
- R30. Search must emit production timing data by retrieval lane, fusion/ranking
  stage, hydration stage, and total response time so slow paths can be found
  without guessing.
- R31. Search should prefer bounded, predictable response behavior over
  unbounded recall. Expensive lanes must have budgets, timeouts, and fallback
  behavior.
- R31a. Timeout behavior is a P0 implementation requirement, not only a launch
  metric. The service must define embedding timeout, per-retriever timeout,
  hydration timeout, and partial response semantics before replacing the
  current search path.
- R32. Launch readiness must include production-like measurement against real
  corpus size, not only unit tests or local fixtures.
- R33. The product should define a realistic viewer-facing response expectation
  and measure it in production. The provisional launch target is p50 under
  800ms, p95 under 2000ms, and hard timeout or degraded response by 2500ms.
  Performance evidence is required before replacing the current search path.

## Success Criteria

- Known-title queries meet or beat the current search baseline and return the
  canonical film, series, collection, or in-scope experience in the top result
  set.
- Title plus language queries meet or beat the current search baseline and
  return watchable content in the requested language when it exists.
- Felt-need and topic queries return useful baseline results using existing
  transcript semantic evidence in P0, even when the words are absent from
  titles. Curated topic quality is a P1 success criterion.
- Non-English and mixed-language queries do not require the user to preselect
  the exact right locale before searching.
- Result cards can accurately distinguish matched evidence language from target
  availability language.
- Search owners can review aggregate and privacy-approved query, impression,
  click, no-result, refinement, and latency data by ranker version and
  retrieval lane.
- Production measurements show search meets the agreed latency target at real
  corpus scale or degrades gracefully when a lane is slow or unavailable.

## Search V2 Contract Sketch

Field names can change in planning, but the v2 contract must be able to express
these concepts without collapsing them into `query + locale`.

**Request**

- `query`
- `explicitTargetLanguage`
- `queryNamedLanguage`
- `detectedQueryLanguage`
- `currentWatchLanguage`
- `displayLanguage`
- `acceptLanguages`
- `resultTypes`
- `limit`
- `rankerVersion`
- `debug`, server-authorized only

**Result**

- `id`, `type`, `canonicalId`, and result-specific identity
- `primaryTitle`, `fallbackTitle`, and `titleLanguage`
- `watchability`: audio, subtitle, fallback, or unavailable
- `availabilityLanguages`: audio, subtitle, transcript, localized metadata
- `evidence[]`: kind, language, source id, score/confidence, and whether a
  displayable snippet is allowed
- `rank`: position and ranker version in public responses; lane contribution
  breakdown and debug metadata only in server-authorized debug responses
- `actions`: primary watch/open action and any language-specific alternatives

## Phasing

**P0**

- Watch web search path using the new request/response shape.
- Replacement viewer GraphQL search shape, with the active Watch web search
  path updated in the same rollout.
- Exact/title/entity results cannot be outranked by semantic matches.
- Title plus language queries return watchable matching content when available.
- Query language, named language, target watch language, display language,
  evidence language, and availability language are represented distinctly.
- Existing transcript embeddings power baseline semantic discovery.
- Basic fallback when target-language content is unavailable.
- Minimal privacy-reviewed analytics for request, ranker version, lanes, result
  count, no-result state, click when available, and latency.
- Production latency target or explicit launch assumption before implementation.
- Initial result responses target p50 under 800ms and p95 under 2000ms, with
  hard timeout or degraded response by 2500ms.
- Server-side timeouts and partial responses for embedding, retrieval, and
  hydration.

**P1**

- Mobile and TV adoption of the shared contract.
- Client-specific TV focus behavior, mobile truncation, and card density.
- Curated metadata/topic lane after source selection and indexing decisions.
- Richer keyword/typo fallback if it improves exact lookup without hurting
  language availability.
- Full ordered impression/refinement analytics after the P0 schema is trusted.
- More polished result-card variants across all clients.

**Later**

- Automatic personalization or auto-reranking from click data.
- Scene-level discovery and richer Bible-reference enrichment beyond existing
  transcript chunk evidence.
- Experiences, if their shape requires a materially different result contract.

## Scope Boundaries

- Do not preserve the current `query + locale` Admin search contract merely for
  compatibility if it blocks the target search behavior.
- Do not treat Algolia parity as the architecture. Algolia is a replacement
  baseline for exact/title behavior, not a constraint on Forge search design.
- Do not discard existing transcript embeddings or require a full re-embed as
  the starting point.
- Do not assume all dubs have matching transcripts or localized metadata.
- Do not collapse all language signals into one persisted search language.
- Do not implement automatic personalized ranking from click data in the first
  version.
- Do not expose raw vectors, secrets, account identity, or private user data in
  analytics or debug payloads.
- Do not require mobile and TV to ship in the same phase as the Watch web P0
  unless a product launch explicitly depends on them.

## Key Decisions

- **Build search v2, not a locale-filter patch:** Watch and mobile are still
  early enough that the team can reshape the search contract around the desired
  product.
- **Preserve the embedding corpus:** The already-generated transcript
  embeddings are valuable semantic evidence and should be reused.
- **Model language as multiple signals:** Query, target, evidence, display, and
  availability languages answer different product questions.
- **Use evidence lanes:** Universal search needs exactness, availability,
  semantic discovery, metadata, and fallback lanes with different ranking
  authority.
- **Measure production performance explicitly:** Relevance work is incomplete
  unless the system can meet a realistic response expectation at production
  scale.
- **Collect learning data before learning from it:** Impressions and clicks
  should feed offline evaluation first; automated ranking changes should wait
  until the event stream is trusted.

## Dependencies / Assumptions

- Production currently has a large multilingual transcript embedding corpus,
  including transcript chunks across many language tags.
- Existing Watch Search Analytics can serve as a starting point for query and
  click observability, but impression-level ranked-result feedback may require
  additional event shape or storage.
- Some target languages will have audio availability without matching
  transcript or localized metadata coverage.
- Web, mobile, and TV should consume one shared search result contract rather
  than each client rebuilding language and availability logic independently.
  Watch web is the P0 integration surface; the contract should be designed for
  mobile and TV adoption without requiring simultaneous launch.

## Outstanding Questions

### Deferred to Planning

- [Affects R12-R18][Technical] What exact GraphQL schema should implement the
  replacement search v2 contract sketch, and which generated-client outputs
  must be regenerated in the same change?
- [Affects R14-R18][Technical] Which retrieval lanes can be built from current
  tables and embeddings without a new backfill, and which lanes require new
  curated metadata or indexes?
- [Affects R18-R22][Technical] What precise watchability model should search
  use for edition, dub, subtitle, transcript, and localized metadata
  availability?
- [Affects R23-R28][Technical] Should minimized ranked-result impressions live
  in Datadog, a durable product analytics table, or both, and what retention
  should apply to raw, row-level, and aggregate data?
- [Affects R29-R33][Needs research] What are current production latency
  baselines for existing search and for candidate cross-language retrieval
  queries?
- [Affects R15][Needs research] Which metadata fields are high-signal enough to
  embed or rank separately, and which should remain filtering/display-only
  fields?

## Next Steps

-> Move to `/ce:plan` for structured implementation planning, starting with the
replacement search v2 contract, watchability hydration, bounded multilingual
retrieval, P0 analytics, and production latency measurement.
