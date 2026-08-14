## Residual Review Findings

Source review run: `20260813-221058-22afa0d2` on
`feat/multilingual-watch-suggestions` (`9481c793`). Mechanical findings 8 and 11
were applied in `8acbcd1c`; three remaining downstream-resolver findings were
filed in Forge's repository roadmap. The unsupported-locale rollout finding was
resolved while integrating Forge PR #1934.

- P1, `apps/admin/src/scripts/benchmark-watch-search-suggestions-candidate.ts:224` — Empty workload satisfies suggestion benchmark gate — [feat-365](../docs/roadmap/content-discovery/feat-365-watch-suggestion-qualification-minimum-work.md)
- P1, `apps/admin/src/services/typesense-watch-search-candidate-generation.ts:1218` — Publication gate lacks executable suggestion qualification — [feat-366](../docs/roadmap/content-discovery/feat-366-watch-suggestion-publication-qualification.md)
- Resolved P1, `apps/admin/src/services/typesense-watch-search-lexical.ts:84` — Mixed rollout blanks unsupported two-letter locales — [feat-367](../docs/roadmap/content-discovery/feat-367-watch-suggestion-mixed-rollout-locales.md)
- P1, `apps/admin/src/scripts/index-typesense-watch-search-candidate.ts:446` — Grouped count approximation rejects valid candidates — [feat-368](../docs/roadmap/content-discovery/feat-368-watch-candidate-exact-group-counts.md)
