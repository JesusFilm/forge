# One-time fallback curation

**PostgreSQL catalog rebuilt:** read [the reconstruction report](pg-catalog-report.md),
[the video map](pg-catalog-videos.csv) and
[language map](pg-catalog-languages.csv) for inventory, and the earlier audits
for recommendation eligibility. The delegated rebuild reads 15 catalog tables
without early delivery filters: 1,175 videos, 212,171 dubs and 2,321 language rows
(2,317 nondeleted named audio slugs). All 208 editorial choices and 233 referenced
cuts resolve. [The summary](pg-catalog-summary.json) records source sync dates;
this is a restored local snapshot, not today's production state.

**Follow-up clarification:** the [fresh `videoVariants` cross-check](video-variants-cross-check.md)
confirms that all 200 display-blocked languages have 48–568 videos with playback
data. Their issue is card-text eligibility. Raw variants also include collections;
Persian Sign Language has 61 extra HLS chapter links that fail with redirect
errors. Use this comparison when interpreting the local eligibility shortfalls.

**Status: all supported locale/audio combinations audited in the local Admin snapshot; production coverage remains unresolved.** The delegated Codex Astra agent made these choices in this session. The subsequent exhaustive audit covers all 225 website locales × 2,317 audio languages (521,325 combinations), including every starter and interest pool. Read [the full coverage report](all-context-coverage-report.md) for exact gaps. Versioned persistence and the three-context local preview are implemented. No paid model API, recurring curation worker, production import, or deployment ran.

For the homepage's actual default language mapping, 2,081 of 2,317 audio routes
have at least six curated candidates and 2,073 have the thirty-candidate reserve.
The remaining 236 routes cannot fill six from these pools. Two hundred routes
map to display locales without matching published video text. These are measured
candidate counts; only the three preview contexts are activated locally.

The manifest contains 208 editorial choices, including 203 starter choices. Five content themes provide smaller directed pools: meaning and purpose; hope and perseverance; love and belonging; forgiveness and new beginnings; exploring Jesus. These describe the videos, not a viewer's personal circumstances or a diagnosis. The existing vector interest profile remains authoritative. Read `coverage-report.md` for the measured result and remaining gaps.

## What is curated

`editorial-manifest.json` owns the ordered choices, stable Core video IDs, alternate-cut groups, per-video theme membership, rationale, and review status. The opening order favors accessible independent shorts and introductory discussion episodes, with some full films. Self-contained scenes provide a deeper language reserve. A film's chapters are separate candidate videos; `workFamily` and `storyGroup` record softer diversity preferences.

The review basis is the public Core primary title, description, snippet, label, and relations. The curator did not watch every film or review transcripts. Sensitive or particularly contextual selections carry review flags. A Core `shortFilm` or `episode` label alone does not establish a short runtime: coverage separately reports candidates whose median observed published-HLS dub duration is at most fifteen minutes. That duration is an inventory description, not the final selected Admin dub's duration.

The source text for some videos makes historical audience or award claims. Those claims were not used as popularity scores. The September 1–8 analytics assessment has only 89 active-proxy qualified watches and is exposure-biased; it cannot provide a robust all-catalog popularity ranking. Future scripts may incorporate measured popularity through an explicitly versioned update. There is no scheduled AI review in this design.

## Evidence and files

- `pg-catalog-videos.csv`, `pg-catalog-languages.csv`, `pg-catalog-editorial-map.csv`, and `pg-catalog-uncurated-candidates.csv`: raw catalog identities and separate derived inventory, overlaid with all existing editorial references. The 834 uncurated leaf records with published source metadata somewhere in the catalog are review opportunities, not approved recommendations in every language.
- `pg-catalog-relations.csv`, `pg-catalog-edition-links.csv`, and `pg-catalog-keyword-links.csv`: inspectable catalog relationships. `pg-catalog-raw-manifest.json` locates and hashes the complete raw exports and the 212,171-row normalized dub map stored outside Git.
- `pg_catalog_map.ts` and `pg_catalog_map.py`: read-only PostgreSQL extraction and reproducible map projection. `catalog-map-independent-validation.json` records the primary agent's independent export, identity, count, editorial, eligibility-join and historical-health checks.
- `catalog-delivery-boundaries.md`: verified schema and consumer rules explaining why HLS metadata, Mux eligibility, localized text and actual stream health are separate facts.
- `catalog-identity-exceptions-summary.json` and `catalog-source-label-cross-check.json`: unmapped language references and six label differences between the restored database and the saved fresh Core responses. These observations do not rewrite catalog identities or source labels.
- `provenance.json`: source queries, fetch interval, raw-source hashes, retained-evidence hashes, record counts, and the Admin access blocker.
- `core-video-availability.csv`: every visible Core video, primary title and label, exact Core language memberships for published variants and for published variants with nonempty HLS, and aggregate dub durations. Space-separated language IDs are sets, not rankings.
- `core-languages.csv`: Core language IDs, exact audio slugs, and informational BCP-47 tags. UI locales are a separate dimension.
- `language-coverage.csv`: counts for every Core language, including zero-candidate gaps, six/thirty thresholds, work/story diversity, each thematic pool, and the zero currently Admin-validated count.
- `pool-overlap.csv`: each language's theme/start intersection and the actual additional candidates beyond start. Adding overlapping pool sizes is not a union count.
- `coverage-summary.json`: aggregate thresholds and global thematic overlap.
- `english-pools.example.json`: a draft export showing the consumer shape.
- `fetch_core.py` and `materialize.py`: bounded read-only source acquisition, deterministic evidence projection, coverage reproduction, and single-language draft export. These are one-time artifact tools, not application code or runtime workers.
- `admin-coverage-report.md`, `admin-language-coverage.csv`, and `admin-coverage-summary.json`: the subsequent local Admin audit across 2,317 audio languages with UI locale `en`, plus representative locale checks.
- `admin-preview-source.json`, `admin-preview-contexts.json`, `admin-preview-validation.json`, and `admin-preview-pools.json`: the explicitly activated local preview generation and resolved Admin IDs for three passing contexts.
- `all-context-coverage-report.md`, `all-context-coverage-summary.json`, `all-context-locale-summary.json`, `all-context-grouped-coverage.csv`, and `all-context-locale-groups.json`: exhaustive local eligibility and inventory evidence, losslessly grouped by identical locale results.
- `all-context-web-default-coverage.csv` and `all-context-web-default-summary.json`: the same matrix projected through Web's actual audio-to-UI-locale resolver, covering every public homepage audio route.
- `audit_all_contexts.ts` and `all-context-equivalence-checks.json`: batched read-only audit using the actual curation materializer, checked against the normal Admin audit service.
- `media-validation.md`, `media-validation.json`, and `media-probe.cjs`: live HLS manifest and image-header checks for all 233 referenced cuts, using one English dub each. All 466 links passed; this is not an all-dub playback or production-publication claim.
- `editorial-review.md` and `editorial-review.json`: completed individual metadata reviews of all eleven flagged choices. Existing exclusions remain and add no active inventory.

The public source is [Core GraphQL](https://api-gateway.central.jesusfilm.org/), requested as the public `watch` client. The full video catalog source is an earlier read-only snapshot acquired in the same session. Its original query is preserved in `fetch_core.py`; variants and languages were fetched subsequently. Offset pagination detects repeated IDs and reaches a terminal short page, but is not a transactionally consistent catalog snapshot.

## Coverage interpretation

The reports distinguish three facts: public source video-language observations, editorial candidates that can be materialized from those observations, and Admin recommendation eligibility. The original Core report measures the first two; the subsequent Admin report measures eligibility in an isolated local snapshot. `published=true` plus a nonempty Core HLS URL is evidence of a declared Core stream, not a playback test. Admin can contain other records, have different publication/restriction state, and select a Mux dub absent from this stricter public-HLS subset.

Core starter coverage is measured after collapsing the two selected Magdalena cuts, reviewed alternate scene cuts, and regional presentations of the same hope message, then applying the runtime's literal Core ID prefix and exact-title checks using primary Core titles. This catches the `2_0-Happiness` / `2_0-HappinessPuzzle` prefix collision. `MAG1` is retained only as an unresolved related record because its description presents it as a collection; it is not a selectable alias. Work-family counts use the actual chosen source cut. The separate Admin audit adds localized titles and available current-contract embedding similarity above 0.95. Actual profile/history collisions remain request-specific.

A pool of thirty distinct **eligible** candidates would leave six after at most twenty-four distinct exclusions from that same pool. This is a coverage scenario, not an adopted completion policy. It does not establish an unlimited guarantee under lifetime completion suppression. Interest pools mostly overlap the starter pool; selecting another label usually does not create new reserve inventory. Scenes from one film can help candidate count while leaving little work diversity.

## Proposed consumer contract

The Core materializer exports `version`, `status`, `adminValidated`, `audioLanguageSlug`, `coreLanguageId`, and `pools: [{ poolKey, orderedCoreVideoIds }]`. `poolKey` is `start` or one of the five stable theme keys. The shared API can consume this language-scoped shape on Web, mobile, or TV; the planned UI rollout is Web only. Titles, rationales, themes, aliases, and review flags stay in the editorial manifest outside the hot payload. The original editorial manifest retains null `adminVideoId` values; the separate preview export records resolved Admin IDs and exact locale scopes.

Resolve known profile medoid/support video Admin IDs to Core IDs, then use the manifest's explicit theme membership to nominate an interest pool. Include alternate Core IDs when matching a reviewed choice. Do not infer a named personal condition from a vector or require a source video. Unmapped or absent useful profile signal uses `start`.

At request time, hydrate current Admin candidates in the requested UI locale and exact audio language, apply eligibility, canonical deduplication, and viewing-history rules, and keep useful profile results first. Six accepted profile results need no curated additions; four need two. Fill remaining positions from a relevant theme pool and the starter reserve, deduplicating their union and the already-kept profile results. Editorial order is the default nomination order. Prefer distinct work/story families when alternatives exist, but a film family is not a hard identity group. Do not silently relax a completion or visibility rule to manufacture six cards.

**A consumer must refuse unvalidated `draft-core-only` data for production.** The implemented import step resolves Admin IDs and canonical identities and checks exact locale/audio publication, Watch restrictions, playback IDs, artwork and reserve depth before sealing a generation. Public Admin GraphQL originally returned HTTP 403, and the Core restriction field returned `Not authorized`; the later local database audits used an explicitly authorized isolated clone. All supported locale/audio pairs are now measured locally. Current production eligibility and resolution of the measured translation/inventory gaps remain separate release requirements; the completed media-link checks do not substitute for either.

## Reproduce

Run from the repository root. The checked-in compact source evidence is sufficient to regenerate the CSV counts and export candidates without network access:

```bash
python3 docs/recommendations/curation/2026-09-10/materialize.py summarize
python3 docs/recommendations/curation/2026-09-10/materialize.py export english
```

For a new explicitly requested source snapshot, select a new empty temporary directory, then review changes as a new version:

```bash
python3 docs/recommendations/curation/2026-09-10/fetch_core.py /tmp/forge-curation-new-snapshot
```

`materialize.py project /path/to/snapshot` projects the three local JSON source files into the artifact directory; it replaces evidence files and therefore belongs only in an intentional version update. These Python commands do not publish or import the result. The original full source JSON is temporary local evidence; its hashes and projection are retained here. A later network fetch can reproduce the query and method but cannot recreate an old mutable catalog byte-for-byte.

## Durable findings

Use Core ID plus exact language identity for joins; never infer audio availability from a UI locale or BCP-47 prefix. Count canonical choices rather than dubs, alternate cuts, or memberships. Preserve hard identity checks separately from film-family diversity. Treat metadata-based editorial judgment, declared Core availability, and current Admin eligibility as separate review stages. These distinctions prevent both inflated coverage claims and accidental production import of a plausible-looking draft.
