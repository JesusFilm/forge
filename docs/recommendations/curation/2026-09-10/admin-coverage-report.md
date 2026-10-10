# Admin validation and local preview

This records the initial English-locale audit and three-context preview. The
later [exhaustive coverage report](all-context-coverage-report.md) checks all
521,325 supported website-locale/audio combinations. [Media link checks](media-validation.md)
and [all eleven flagged editorial reviews](editorial-review.md) are also complete
within their stated scopes. Neither broadens the three active preview contexts.

**The local Admin audit passes a thirty-candidate starter reserve for 2,273 of
2,317 audio languages in UI locale `en`. It does not establish all-language or
production readiness.** Only `en`/`english`, `fr`/`french`, and `hi`/`hindi` are
active in the isolated preview database.

The database is `forge_feat477_20260910`, cloned from local `forge_feat453` at
`127.0.0.1:55453`. The source database was not changed. This is a restored local
Admin catalog, not a current production query. No production import, deployment,
model API call, scheduler, or recurring review was performed.

## Measured coverage

| Exact scope or threshold                                                  | Result |
| ------------------------------------------------------------------------- | -----: |
| Nondeleted Admin audio slugs audited with UI locale `en`                  |  2,317 |
| At least 30 unique curated starters                                       |  2,273 |
| 6–29 curated starters                                                     |      8 |
| 1–5 curated starters                                                      |     29 |
| No curated starters                                                       |      7 |
| At least 44 unique curated starters                                       |    268 |
| Entire catalog has fewer than 6 eligible Admin IDs before canonical dedup |     35 |
| Entire catalog has no eligible Admin IDs                                  |      5 |

The original 233 Core references all resolve in Admin. Eleven editorial choices
flagged for sensitivity/context review are excluded. Two choices fail Watch
availability. Each context also removes missing exact-audio dubs and canonical
duplicates. The five theme pools overlap the starter pool: none adds unique
inventory beyond the starter union in this audit.

The entire-catalog figure is an **optimistic ceiling**, including uncurated
content and counting distinct Admin IDs before Core-prefix, title, or embedding
dedup. A ceiling below six proves a supply gap. A larger ceiling does not prove
enough appropriate recommendations. `admin-inventory.sql` preserves this query.

The default scenario needs `6 + 24 = 30` eligible candidates to withstand at most
24 distinct exclusions. A count of twenty under the same exclusion bound needs
44; 2,049 languages fail that stronger scenario. A bounded reserve cannot support
unlimited lifetime completion suppression. Production scope and history policy
must be reconciled with these counts before activation.

## Preview contexts

| UI locale | Audio language | Core language ID | Unique starters | Status                                      |
| --------- | -------------- | ---------------- | --------------: | ------------------------------------------- |
| `en`      | `english`      | `529`            |             191 | Active preview                              |
| `fr`      | `french`       | `496`            |             164 | Active preview                              |
| `hi`      | `hindi`        | `6464`           |             141 | Active preview                              |
| `ta`      | `tamil`        | `5871`           |               0 | Rejected: no published `ta` display locales |

Tamil audio availability does not repair missing Tamil UI publication. Its audit
has 197 locale-publication rejections among unflagged editorial choices, as well
as 76 choices without the exact audio dub. UI locales and audio languages remain
independent dimensions.

Active generation: `2026-09-10.astra-admin-preview.v2`. The publication report
requires six results plus a reserve of twenty-four. Actual depths in all three
active contexts also exceed 44. This does not activate the other passing languages.

## Eligibility and identity contract

Import resolves Core video IDs to Admin IDs. It requires the selected language's
exact slug **and** canonical Core language ID, published/nondeleted dub and
edition, nondeleted Mux data with a nonempty playback ID, a published nondeleted
display locale with a usable title, Watch visibility, a public slug, and authored
HTTPS artwork. It verifies declared Admin metadata; it does not fetch every
stream or image over the network.

Each editorial duplicate group contributes at most one available alternate.
The validator then uses the existing runtime identity rule: Core ID prefix,
exact localized title, and cosine similarity above 0.95 where both current
contract-compatible transcript embeddings exist. Embeddings are optional; their
absence does not disqualify an otherwise eligible editorial choice. Film family
is a diversity preference, not a hard identity rule. Metadata-based editorial
review is not a claim to have watched every candidate.

The importer rejects malformed/duplicate IDs, unknown Core references, unknown
themes, invalid bounds, ambiguous context declarations, and insufficient unique
starter depth. It validates and writes an immutable generation in one database
transaction. Sealed source, provenance, report, pool order and theme membership
cannot be updated. Activation and rollback compare the expected active version,
recheck mutable eligibility and the stored starter reserve, and atomically move
one dedicated pointer. A rejected import or activation leaves it unchanged.

Runtime `CuratedPoolsService.getCandidates({ locale, audioLanguageSlug,
interestVideoIds?, limit, deadlineAt? })` returns `{ version, poolKeys, items }`.
Interest inputs are known **Admin video IDs**. Explicit private theme memberships
select relevant pools without renaming vector profile clusters or diagnosing a
viewer. Reads fetch at most nine pool rows and hydrate at most 256 stored video
IDs in the exact requested context, rechecking current eligibility and identity.
The consumer appends only the missing profile positions and applies history.

Each returned candidate carries `generator: "curated"`, `poolVersion`, `poolKey`,
editorial rank and full-video playback metadata. `sceneIndex` and `similarity`
are null; there is no invented semantic score or scene match. Editorial rationale
and membership stay outside the public response.

## Evidence and reproduction

- `admin-language-coverage.csv`: every audited locale/audio identity, unique
  starter/union depth, six/thirty/forty-four thresholds, each theme count,
  rejection counts, and the optimistic entire-catalog ceiling.
- `admin-coverage-summary.json`: scope, completion time and source/audit hashes.
- `admin-preview-source.json`: the exact versioned source used for preview.
- `admin-preview-contexts.json`: the three explicitly activated contexts.
- `admin-preview-validation.json`: full import validation and rejection reasons
  for those contexts.
- `admin-preview-pools.json`: ordered resolved Admin IDs plus Core-ID and private
  theme membership mapping; these IDs belong to the local snapshot.
- `summarize_admin.py`: deterministic projection of a full audit and inventory
  query JSON into the compact CSV and summary. The full broad audit is temporary
  local evidence; hashes are retained rather than another large catalog dump.

Run from `apps/admin` with an explicitly selected database environment:

```bash
pnpm exec tsx --env-file=.env scripts/import-recommendation-pools.ts audit \
  --source=../../docs/recommendations/curation/2026-09-10/admin-preview-source.json \
  --contexts=../../docs/recommendations/curation/2026-09-10/admin-preview-contexts.json \
  --report=/tmp/curated-validation.json
```

`audit` is read-only. `import --execute` uses the same arguments and seals the
generation only after a passing report. Versions are immutable: repeat imports
require an intentional new version. `promote --execute --version=<new-version>
--expected-active=<current-version>` revalidates and switches the pointer; use
`--expected-active=none` only for the first activation. `rollback --execute
--expected-active=<current-version>` revalidates and restores the prior generation.
Neither command deploys application code. No production action is authorized by
this report.

Source digests in newly imported generations use recursively key-sorted JSON
with array order preserved, so PostgreSQL JSONB normalization cannot change the
content hash. The broad audit's `auditInputDigest` records its original input
serialization; the retained full-audit and inventory hashes identify those exact
temporary evidence files. A rerun against mutable data establishes a new audit,
not byte-for-byte reproduction of the old snapshot.

## Verification and remaining work

Unit and real-Postgres tests cover reserve/overlap arithmetic, alias resolution,
Core-prefix/title/embedding dedup, unknown references, immutable generations,
failed imports, compare-and-swap promotion, exact audio and locale drift, missing
artwork/playback, and rollback restoring order and provenance. Preview lookup of
64 English candidates measured 264 ms cold and 184/157/156 ms on subsequent runs
during the broad audit; this is local evidence, not a production latency SLO.

The later exhaustive audit completes the local locale cross-product. All 233
selected English manifests and image links respond; all eleven flagged choices
have individual metadata reviews and remain excluded. Current production
publication/restrictions, broader actual playback verification, and resolution
of measured translation and inventory gaps remain outstanding. The curation
ticket stays in progress. More lists alone cannot close the proven inventory
gaps.
