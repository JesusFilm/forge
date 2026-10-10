# Complete local recommendation-pool coverage audit

Read the subsequent [fresh `videoVariants` cross-check](video-variants-cross-check.md)
before interpreting a low eligibility count as missing audio content. All 200
display-blocked languages have substantial published playback inventory. The
Persian Sign Language difference comes from HLS-only chapter metadata whose
links failed live checks, not absent variant ingestion. Counts below remain
the unchanged local validator's results.

Checked every local audio language through the website's current homepage locale resolver: **2,081 of 2,317 language homepages have at least six eligible, distinct curated starters**. **2,073 have at least 30**, enough to retain six after excluding up to 24 distinct videos. All 2,317 audio slugs are recognized public homepage languages; none were silently excluded from these totals.

The remaining **236 homepage language contexts need attention**:

- **200 resolve to a UI locale without matching published video display metadata.** Their audio inventory may be substantial; localized card titles are the blocker.
- **35 have fewer than six eligible Admin video IDs in the entire catalog**, even before canonical deduplication and including uncurated content.
- **Arabic Najdi has five approved starters and nine eligible, distinct catalog videos.** Additional editorial choices could supply six, but its entire inventory cannot meet the 30-video reserve.

This is a read-only audit of the restored local database `forge_feat477_20260910`, using a repeatable-read extraction taken **2026-09-10 02:40:01 UTC**. It is not current production catalog validation. No pools were imported, promoted, or published by this audit. The previously active local generation still covers only en/English, fr/French, and hi/Hindi.

## Homepage results

| Approved starter inventory                     | Homepage audio-language contexts |
| ---------------------------------------------- | -------------------------------: |
| At least 6                                     |                            2,081 |
| At least 30: Web six plus 24 exclusions        |                            2,073 |
| At least 44: API maximum 20 plus 24 exclusions |                              185 |
| 1–5                                            |                               29 |
| 0                                              |                              207 |

The at-least thresholds overlap. Of the 207 zero-card contexts, 200 are blocked by display-locale publication and seven by missing eligible curated audio inventory. The full per-language list, including exact resolved locale, HTML language, all five interest-pool counts, and rejection reasons, is [all-context-web-default-coverage.csv](all-context-web-default-coverage.csv). Its summary is [all-context-web-default-summary.json](all-context-web-default-summary.json).

Web uses `resolveWatchLocaleIdentity(audioLanguageSlug)` for language homepages. For example, Tamil resolves to `ta`, Mandarin China to `zh`, Mandarin Taiwan to `zh-Hant`, and audio languages without a matching UI catalog resolve to `en`. That existing UI resolution is distinct from recommendation-card fallback: the recommendation request preserves its resolved locale and requires a published card in that exact locale.

## All API locale/audio combinations

The audit also checked the complete **225 generated Web UI locales × 2,317 nondeleted Admin audio languages = 521,325 contexts**. This deliberately exceeds the default homepage pairings so another client can independently choose UI locale and playback language.

| Approved starter inventory | API contexts |
| -------------------------- | -----------: |
| At least 6                 |       47,901 |
| At least 30                |       47,732 |
| At least 44                |        5,723 |
| 1–5                        |          608 |
| 0                          |      472,816 |

Only **21 exact website locale keys** have published, nonempty card titles in this snapshot: `ar`, `bn`, `de`, `en`, `es`, `fa`, `fil`, `fr`, `he`, `hi`, `id`, `ja`, `kk`, `ko`, `mn`, `pt`, `ru`, `th`, `tr`, `ur`, and `vi`. Each of these supports six curated starters in 2,281 audio languages. Spanish has one fewer context meeting the 30-video reserve than the other 20 locales.

The database has published rows under 23 locale keys in total. Two are `zh-hans` and `zh-hant`, while Web advertises `zh-Hans` and `zh-Hant`; exact recommendation matching does not normalize this casing. Web's `zh` locale also has no published rows. Consequently, of the 204 website locale keys without exact published display coverage, 202 are absent keys and two have a case mismatch. The current request path preserves case from the Web widget through GraphQL and pool hydration. Resolving these locale identities and publishing the missing translations must respect the strict display-language policy tracked by feat-475; this audit adds no English card fallback.

All **233 Core references** resolve. The audit preserves exact language identity, published display titles, Watch visibility, playable dub/Mux/edition metadata, selected HTTPS artwork, editorial holds, and actual Core-prefix/title/embedding deduplication. Eleven flagged editorial choices remain excluded. Counts use the unchanged `2026-09-10.astra-admin-preview.v2` source; its SHA-256 is recorded in the summary.

## Interest pools and inventory limits

All five interest pools were checked in every context. Under the actual homepage locale pairings:

| Pool                           | At least 6 | 1–5 |   0 |
| ------------------------------ | ---------: | --: | --: |
| Meaning and purpose            |      2,075 |   7 | 235 |
| Hope and perseverance          |      2,078 |   6 | 233 |
| Love and belonging             |      2,079 |   9 | 229 |
| Forgiveness and new beginnings |      2,075 |  11 | 231 |
| Exploring Jesus                |      2,081 |  27 | 209 |

Interest pools overlap the starter pool: **none adds distinct eligible videos beyond the starter union in any audited context**. They change fallback ordering according to interests. They cannot create additional inventory when the starter union is exhausted. The API still uses profile results first and fills only missing slots from these pools.

The all-catalog comparison is an optimistic ceiling before canonical deduplication. [Arabic Najdi's separate identity check](all-context-arabic-najdi-inventory.json) confirmed all nine candidates survive runtime deduplication: five approved starters, one editorial hold, and three outside the source. The audit did not select additional videos. Thirty-video reserves cover at most 24 distinct exclusions, not unlimited history or future catalog removals. No individual viewer history was read.

## Evidence and validation

- [Complete summary](all-context-coverage-summary.json) and [per-locale/pool summaries](all-context-locale-summary.json).
- [Lossless grouped matrix](all-context-grouped-coverage.csv), about 2.3 MB, and [locale-to-group mapping](all-context-locale-groups.json). Twelve groups represent all 225 locales because many locales have identical coverage. Select a locale's group, then its audio-language row, to retrieve the exact context counts and reasons.
- Full 521,325-row CSV: `/home/nisal/.cache/forge-477-preview/all-context-audit/all-context-coverage.csv`, SHA-256 `8d7e8aa5108f3be7878bb4bab1337966b31f101e08f80237feb5f7e043a628a7`. The detailed catalog extraction remains alongside it in cache; embeddings are not copied into repository reports.
- [18 official-service equivalence checks](all-context-equivalence-checks.json) compare the batched calculation with `CuratedPoolsService.audit`, including zero, 2-, 5-, 12-, 28-, 30-, and deep-inventory contexts, mixed UI/audio languages, and Chinese locale keys.
- [Independent evidence validation](all-context-evidence-validation.json) passed all 521,325 full-versus-grouped comparisons, all 2,317 comparisons with the prior English-locale audit, every Web default-locale projection, summary totals, and the full CSV checksum.

This audit checks declared media eligibility, not stream/image network health or a human viewing of every video. The separate [media validation](media-validation.md) probes one English playback manifest and the selected image for each of the 233 editorial Core references; it does not probe every language dub or play complete films.

## Reproduce

From `apps/admin` in this worktree, using its isolated local `.env`:

```bash
pnpm exec tsx --env-file=.env ../../docs/recommendations/curation/2026-09-10/audit_all_contexts.ts --raw-dir=/home/nisal/.cache/forge-477-preview/all-context-audit
```

The script refuses databases other than `forge_feat477_20260910`. It extracts a read-only snapshot, batches audio availability, hydrates populated locales, and applies the actual service materializer to cached eligibility/title patterns.

From the worktree root:

```bash
pnpm exec tsx docs/recommendations/curation/2026-09-10/audit_web_contexts.ts --raw-dir=/home/nisal/.cache/forge-477-preview/all-context-audit
python3 docs/recommendations/curation/2026-09-10/validate_all_contexts.py --raw-dir=/home/nisal/.cache/forge-477-preview/all-context-audit
```

To rerun only the service equivalence checks and sparse Arabic Najdi inventory read, from `apps/admin`:

```bash
pnpm exec tsx --env-file=.env ../../docs/recommendations/curation/2026-09-10/audit_all_contexts.ts --raw-dir=/home/nisal/.cache/forge-477-preview/all-context-audit --verify-only
```

`--verify-only` compares the preserved extraction against fresh local service reads; it fails if the compared eligibility has changed. A production audit needs a separately authorized, current catalog source and must preserve the same exact eligibility and locale rules.
