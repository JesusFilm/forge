# RAG portal Sources — agreed scope

Tracks `docs/roadmap/rag/feat-568-rag-portal-sources.md`. The user confirmed the design after the grill-me interview on 2026-09-29.

## Product decisions

- Sources is a top-level portal section with the reference mockup's blue, white-panel list/detail layout, using existing portal typography and navigation.
- Only production content is visible. Existing portal admission remains unchanged; the page is read-only.
- One row per recognizable content brand. Explicit membership groups EveryStudent translations and thelife domains; Cru, FamilyLife, and other brands remain distinct regardless of ownership. Unmapped keys remain independent rather than being guessed by prefix or domain.
- Source list columns: Source, Total documents, Detected languages. Beneath the name, show a single domain or the number of production domains.
- Details have Overview and Languages. Overview lists production domains and totals. Languages has search, pagination, document counts, and contributing domains, supporting a many-to-many relationship without changing corpus identity.
- Show stored language counts. Mark values outside each constituent source's declared languages; retain an Unidentified language row. Do not correct labels. Unidentified documents count toward total documents but not distinct detected languages.
- Search the catalog by name/domain; a searchable language filter selects matching brands and opens that language in the detail panel. List counts remain brand totals.
- Summary shows grouped source count, distinct detected languages, document count, and the original production snapshot time.
- Reuse the committed status-dashboard snapshot and current post-ingestion PR workflow. Keep the public GitHub Pages dashboard unchanged.
- Omit lifecycle, evaluated badges, planned/retired sources, next steps, and review queues. Legacy jesusfilm-rag issues #140 (retrieval acceptance simplification) and #149 (content governance) remain separate work.

## Implementation

1. Add a serving-owned, pure catalog projection and explicit brand memberships. Read only the committed dashboard JSON; expose only required display fields behind existing session admission. Keep snapshot failure local to Sources.
2. Add a lazy browser module and stylesheet for source list/detail, safe DOM rendering, catalog search/language filtering, bounded tables, empty/error/retry states, accessible controls and responsive stacked layout.
3. Integrate top-level navigation without changing consumer configuration or initial data loading. Preserve existing source keys and public dashboard build outputs.
4. Add behavior tests for aggregation, language anomaly provenance, zero-document exclusion, unknown language, counts, duplicate membership rejection, authentication and failure containment. Exercise actual browser routes using synthetic admission plus the committed snapshot; use large synthetic catalog coverage only for pagination stress.
5. Verify package constraints, formatting, existing portal behavior, and measured initial-load plus Sources activation performance. Review and compound the facade/snapshot boundary in durable documentation.

## Acceptance boundaries

All work is local and goes through normal PR-to-main deployment. Production snapshot refresh and live acceptance are not implied by this implementation. No new production credentials, migrations, ingestion jobs, or retrieval changes are required.
