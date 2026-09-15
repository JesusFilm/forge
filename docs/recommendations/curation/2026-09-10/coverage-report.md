# Measured fallback coverage — September 10, 2026

**The Core-only curation pass is finished; production readiness is not established.** There are 208 reviewed editorial choices and 203 starter choices, with alternate editions and repeated presentations grouped. Current Admin-validated choices: **0**. `feat-487` remains in progress.

The public snapshot contains 1,129 visible Core videos, 2,318 language identities, and 211,904 variant records. Of those variants, 207,144 belong to visible videos and 4,760 reference videos outside the visible catalog snapshot; those outside records do not become candidates. Languages were fetched September 9, 22:19:38–22:19:42 UTC, and variants 22:19:42–22:30:42 UTC. The public video snapshot was fetched at 22:14:43 UTC. The language/variant queries reached terminal pages in 3/43 bounded requests. Source hashes and exact queries are in `provenance.json` and `fetch_core.py`.

## Coverage result

The denominator below is the **2,313 Core language identities** with at least one published nonempty-HLS variant of a visible leaf-label video. It is not a list of currently supported Admin languages. Five other Core identities have no such source observation.

| Starter depth after editorial grouping and verifiable identity checks | Language identities |
| --------------------------------------------------------------------- | ------------------: |
| At least 30                                                           |               2,276 |
| 6–29                                                                  |                   6 |
| 1–5                                                                   |                  27 |
| 0                                                                     |                   4 |

Every language in this snapshot with at least thirty observed source leaf IDs and an unambiguous audio slug now has at least thirty starter candidates. This required adding explicit StoryClubs/Magdalena alternate scene cuts, LUMO chapter sections, and language-specific teaching and short-film reserves. Source IDs themselves do not prove distinct Admin identity or eligibility.

Twenty-nine active language identities have fewer than six public source videos with published HLS **even when counting every Core label**, including containers. Two further identities have usable-looking inventory but the same `lala` slug, so the materializer refuses to merge or guess. These account for all thirty-one active language identities below six starter choices.

The raw catalog is not a certified eligible inventory ceiling: it omits Admin-only content and private eligibility information. It does, however, demonstrate that creating additional pool labels cannot by itself establish six eligible choices in those gaps. Current Admin access or a product/data decision is needed before promising six cards for every selected language.

## Examples

Counts below are candidate choices after the recorded alias/Core-prefix/primary-title checks. The short-duration column uses the median of observed published-HLS dub durations, capped at fifteen minutes; it does not assert the final Admin dub duration.

| Exact Core audio slug | Starter | All-pool union | Work families | At most 15 minutes | Feature films |
| --------------------- | ------: | -------------: | ------------: | -----------------: | ------------: |
| english               |     202 |            207 |            79 |                192 |             6 |
| burmese               |      37 |             37 |             9 |                 37 |             0 |
| norwegian-bokmal      |      47 |             47 |             7 |                 45 |             2 |
| chinese-simplified    |      51 |             52 |            31 |                 51 |             0 |
| chinese-traditional   |      31 |             32 |            19 |                 31 |             0 |
| french-african        |      30 |             30 |            11 |                 25 |             1 |
| kachhi-gujerati       |      30 |             31 |             1 |                 29 |             1 |
| mazanderani           |      30 |             31 |             1 |                 29 |             1 |
| sinhala               |      73 |             75 |            17 |                 70 |             3 |
| tamil                 |     127 |            129 |            28 |                122 |             5 |

English's 203 authored starter choices materialize as 202: the runtime's literal prefix rule treats `2_0-Happiness` and `2_0-HappinessPuzzle` as a collision. The English order begins Chosen Witness, Brothers, What Makes You Happy?, NUA 1.3 What Does This Life Mean?, Delight, JESUS. Five shorts/discussion episodes and one full-film option provide the editorial opening; current eligibility and viewing history can change the actual result.

Work diversity is limited: **2,115** active language identities have fewer than six selected-source work families. Kachhi-Gujerati and Mazanderani reach thirty through the Magdalena family. Many other languages rely heavily on JESUS scenes. A film family is a diversity preference, not the runtime's hard video identity. Embedding dedup may still reduce these counts.

## Theme pools and overlap

| Theme key                      | Global editorial choices | Active languages with at least 6 | With at least 30 |
| ------------------------------ | -----------------------: | -------------------------------: | ---------------: |
| meaning-and-purpose            |                       82 |                             2275 |               54 |
| hope-and-perseverance          |                       74 |                             2278 |               96 |
| love-and-belonging             |                       77 |                             2279 |               84 |
| forgiveness-and-new-beginnings |                       50 |                             2277 |               27 |
| exploring-jesus                |                       99 |                             2280 |              255 |

A theme pool is a first fallback nomination preference, followed by the starter reserve. It is not independently deep enough to withstand twenty-four exclusions in every language. The global manifest has only five choices outside the starter pool, so most thematic overlap creates no new inventory. `pool-overlap.csv` records each language's exact intersection and union; `coverage-summary.json` also records theme-to-theme overlap. The runtime must deduplicate the profile/theme/start union before final selection.

Thirty eligible choices would cover six slots after at most twenty-four distinct exclusions from that same pool. This scenario does not adopt a history limit, account for an unlimited completion history, or replace current eligibility checks. If the product requires permanent suppression of every completed title, a finite catalog cannot prove an unlimited six-card guarantee.

## Remaining gaps

These six active language identities have six or more starter choices but less than thirty. Each has fewer than thirty observed public source leaf IDs:

| Exact Core audio slug  | Core language ID | Public source leaf IDs | Starter |
| ---------------------- | ---------------- | ---------------------: | ------: |
| arabic-najdi           | 184591           |                      9 |       6 |
| english-african        | 185221           |                     14 |      13 |
| english-british        | 185021           |                     14 |      13 |
| kwasio                 | 144002           |                     10 |       9 |
| lebanese-syrian-arabic | 156811           |                     11 |      10 |
| portuguese-mozambique  | 139136           |                     28 |      17 |

All active identities below six are listed here. Counts are source observations, not Admin eligibility:

| Exact Core audio slug       | Core language ID | Source videos with published HLS, all labels | Starter | Gap                                                                                                                 |
| --------------------------- | ---------------- | -------------------------------------------: | ------: | ------------------------------------------------------------------------------------------------------------------- |
| american-sign-language      | 19171            |                                            2 |       2 | Fewer than six public source videos                                                                                 |
| antesaka                    | 139153           |                                            2 |       0 | Fewer than six public source videos; available film/trailer concern a graphic crucifixion, not selected for starter |
| arabic-north-african        | 20538            |                                            1 |       1 | Fewer than six public source videos                                                                                 |
| ayizo-tori                  | 145621           |                                            1 |       1 | Fewer than six public source videos                                                                                 |
| bahasa-melayu-2             | 170534           |                                            2 |       1 | Fewer than six public source videos                                                                                 |
| brazilian-sign-language     | 1872             |                                            1 |       1 | Fewer than six public source videos                                                                                 |
| colombian-sign-language     | 4247             |                                            1 |       1 | Fewer than six public source videos                                                                                 |
| costa-rican-sign-language   | 4394             |                                            1 |       1 | Fewer than six public source videos                                                                                 |
| japanese-sign-language      | 7090             |                                            1 |       1 | Fewer than six public source videos                                                                                 |
| jordanian-sign-language     | 7138             |                                            1 |       1 | Fewer than six public source videos                                                                                 |
| korean-sign-language        | 7355             |                                            1 |       1 | Fewer than six public source videos                                                                                 |
| kusaal                      | 141653           |                                            5 |       4 | Fewer than six public source videos                                                                                 |
| lala                        | 106963           |                                           61 |       0 | Ambiguous slug shared by two IDs                                                                                    |
| lala                        | 15622            |                                           64 |       0 | Ambiguous slug shared by two IDs                                                                                    |
| lebanese-sign-language      | 139080           |                                            2 |       1 | Fewer than six public source videos                                                                                 |
| letuama-tanimuca            | 41117            |                                            1 |       1 | Fewer than six public source videos                                                                                 |
| mexican-sign-language       | 8230             |                                            1 |       1 | Fewer than six public source videos                                                                                 |
| new-zealand-sign-language   | 9194             |                                            1 |       1 | Fewer than six public source videos                                                                                 |
| romanian-sign-language      | 12961            |                                            1 |       1 | Fewer than six public source videos                                                                                 |
| russian-sign-language       | 1944             |                                            1 |       1 | Fewer than six public source videos                                                                                 |
| salar                       | 3924             |                                            1 |       0 | Fewer than six public source videos; only Legion, not selected for starter                                          |
| sidamo                      | 4644             |                                            1 |       1 | Fewer than six public source videos                                                                                 |
| tarifit-arabic-based-script | 184497           |                                            1 |       1 | Fewer than six public source videos                                                                                 |
| tarifit-latin-based-script  | 184498           |                                            1 |       1 | Fewer than six public source videos                                                                                 |
| tonga-zambezi               | 20984            |                                            2 |       1 | Fewer than six public source videos                                                                                 |
| ukrainian-sign-language     | 14783            |                                            1 |       1 | Fewer than six public source videos                                                                                 |
| urdu-indian                 | 22563            |                                            1 |       1 | Fewer than six public source videos                                                                                 |
| uyghur-central-asia         | 185211           |                                            1 |       1 | Fewer than six public source videos                                                                                 |
| visualvernacular            | 185345           |                                            5 |       3 | Fewer than six public source videos                                                                                 |
| wayampi-oiapoque            | 1796             |                                            1 |       1 | Fewer than six public source videos                                                                                 |
| yiddish                     | 5130             |                                            1 |       1 | Fewer than six public source videos                                                                                 |

The five identities without any observed published-HLS video are `dagaari-northern` (22197), `limba-west-central` (13110), `ralte` (101511), `yakpa` (109459), and `zhuang-minz` (99581). No audio language is silently replaced by English, another dialect, a BCP-47 neighbor, or a subtitle language.

The duplicated `lala` identity is a concrete resolution blocker: Core IDs 106963 and 15622 have 61 and 64 observed source leaf IDs respectively. Admin's Core language sync detects slug ownership conflicts and may preserve one slug while dropping the other. An authenticated Admin lookup is required to determine the actual selectable identity. The draft export rejects `lala`.

## Required Admin validation

Admin GraphQL returned HTTP 403. The public Core restriction field returned `Not authorized`; there was no available authenticated Admin catalog/database connection. These checks could not be completed:

- Resolve every selected Core ID and alternate to current Admin IDs, canonical identities, and exact language slugs.
- Prove current requested-locale publication, Watch restrictions, and selected Dub eligibility.
- Verify nonempty playback IDs, real playability, artwork, and card metadata in the same locale/audio context.
- Apply localized-title and embedding dedup, then profile overlap and the agreed viewing-history rules.
- Re-measure six/thirty candidate depth, especially the languages at exactly thirty and the sparse/ambiguous identities above.
- Review flagged sensitive material and metadata-inferred standalone intelligibility before promotion.

`editorial-manifest.json` and every export remain `draft-core-only`; all Admin IDs are null and the production gate is false. The script validates source joins and identity invariants, not these unavailable Admin facts. No production import or runtime recommendation implementation was performed.

## Validation performed

Reconciled all 211,904 original variant records against the 1,129 retained source rows, including both published-language and published-HLS-language sets. Checked all 13,908 language/pool combinations for exact-language availability, explicit membership, unique IDs, prefix collisions, and exact primary-title collisions. Blank, unknown, and ambiguous language exports were rejected. Evidence hashes match; Python syntax checks and Prettier checks passed for the owned artifacts. Current Admin eligibility and playback checks remain pending as listed above.
