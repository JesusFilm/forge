# Watch Sitemap Shard Audit — 2026-07-23

## Purpose

This report records the FGE-17 production baseline, the exact serialized-content
repartition at the new 35,000,000-byte ceiling, and the release procedure for
verifying a deployed preview and canonical production.

Google limits a single sitemap to 50 MB uncompressed or 50,000 URLs. Forge uses
stricter safety ceilings of 35,000,000 uncompressed UTF-8 bytes and 49,999
canonical entries.

## Production Baseline

Audit time: 2026-07-23
Index: `https://www.jesusfilm.org/watch/sitemap.xml`

The index and every child returned direct HTTP 200 with
`application/xml; charset=utf-8`. All 22 children decoded as UTF-8 and parsed as
valid XML.

| Child |      Bytes | `<loc>` | `hreflang` |
| ----: | ---------: | ------: | ---------: |
|     0 | 44,998,894 |   5,259 |    360,385 |
|     1 | 44,986,989 |   4,816 |    369,950 |
|     2 | 44,996,378 |   2,975 |    348,531 |
|     3 | 44,994,886 |   5,060 |    354,042 |
|     4 | 44,995,066 |   4,480 |    347,504 |
|     5 | 44,998,351 |   3,727 |    347,909 |
|     6 | 44,992,658 |   4,316 |    356,094 |
|     7 | 44,990,730 |   3,326 |    306,134 |
|     8 | 44,988,621 |   4,625 |    325,857 |
|     9 | 44,984,208 |   2,745 |    333,309 |
|    10 | 44,997,962 |   4,346 |    337,798 |
|    11 | 44,983,296 |   2,512 |    339,120 |
|    12 | 44,994,540 |   2,400 |    324,000 |
|    13 | 44,989,011 |   2,500 |    337,500 |
|    14 | 44,994,144 |   4,487 |    316,137 |
|    15 | 44,994,559 |   5,346 |    302,458 |
|    16 | 44,999,426 |   3,744 |    318,156 |
|    17 | 44,995,858 |   3,815 |    312,573 |
|    18 | 44,993,442 |   4,148 |    302,901 |
|    19 | 44,983,220 |   4,048 |    318,211 |
|    20 | 44,987,605 |   3,543 |    306,095 |
|    21 |  6,332,549 |     645 |     47,581 |

Aggregate baseline:

- 22 index references and 22 unique children.
- 951,172,393 uncompressed child bytes.
- 82,863 unique canonical `<loc>` entries.
- 7,012,245 `hreflang` annotations.
- Zero duplicate canonical entries.
- Zero canonical entries missing their self alternate.
- Zero missing alternate targets.
- Zero reciprocal alternate-set mismatches.
- 21 children exceed the new 35,000,000-byte safety ceiling.
- The largest child is 44,999,426 bytes, leaving only 5,000,574 bytes beneath
  Google's hard byte limit.

## Exact 35 MB Repartition

The existing production `<url>` elements were replayed in their published order
through the 35,000,000-byte partition rule. Each element remained atomic,
including its complete serialized alternate set. This measures the output shape
of the code change against current production content without needing to alter
or deploy production.

| Child |      Bytes | `<loc>` |
| ----: | ---------: | ------: |
|     0 | 34,995,235 |   4,297 |
|     1 | 34,997,556 |   4,012 |
|     2 | 34,997,920 |   2,820 |
|     3 | 34,987,514 |   2,288 |
|     4 | 34,999,594 |   3,870 |
|     5 | 34,985,877 |   4,317 |
|     6 | 34,995,793 |   2,816 |
|     7 | 34,999,876 |   2,856 |
|     8 | 34,992,924 |   3,356 |
|     9 | 34,988,271 |   2,731 |
|    10 | 34,989,075 |   3,140 |
|    11 | 34,990,280 |   2,951 |
|    12 | 34,995,753 |   2,274 |
|    13 | 34,986,105 |   3,666 |
|    14 | 34,994,582 |   1,967 |
|    15 | 34,980,788 |   1,898 |
|    16 | 34,990,840 |   1,859 |
|    17 | 34,990,638 |   1,967 |
|    18 | 34,992,742 |   2,790 |
|    19 | 34,994,954 |   4,488 |
|    20 | 34,993,955 |   3,817 |
|    21 | 34,997,119 |   2,914 |
|    22 | 34,997,435 |   2,826 |
|    23 | 34,983,245 |   3,140 |
|    24 | 34,994,471 |   3,526 |
|    25 | 34,994,486 |   2,876 |
|    26 | 34,996,187 |   2,753 |
|    27 |  6,370,078 |     648 |

Modeled result:

- 28 children.
- 951,173,293 uncompressed child bytes. The 900-byte increase is six additional
  XML wrappers.
- 82,863 canonical entries, unchanged from the baseline.
- Maximum child size: 34,999,876 bytes.
- Maximum child URL count: 4,488.
- No canonical or reciprocal alternate coverage is removed.

## Repeatable Audit

Run against the canonical production host:

```bash
pnpm --filter @forge/web audit:watch-sitemap -- \
  --origin https://www.jesusfilm.org \
  --json /tmp/watch-sitemap-production.json
```

Run against a deployed preview:

```bash
pnpm --filter @forge/web audit:watch-sitemap -- \
  --origin https://<preview-host> \
  --json /tmp/watch-sitemap-preview.json
```

The preview index intentionally continues to publish canonical
`www.jesusfilm.org` child URLs. The auditor verifies those index references but
fetches the same child paths from the supplied preview origin, so it measures
the candidate deployment rather than production.

The command exits nonzero for redirects, non-200 responses, invalid content
type, invalid UTF-8 or XML, noncontiguous or duplicate child references,
children over either safety ceiling, duplicate canonicals, missing self-links,
missing alternate targets, or reciprocal-set drift.

## Post-Deploy Evidence

After this change reaches production:

1. Run the production audit and attach its JSON output to FGE-17.
2. Confirm the production index references 28 children for the current manifest
   snapshot; normal catalog growth may change this count.
3. Confirm every child remains below 35,000,000 bytes and below 50,000
   canonical entries.
4. Submit or refresh the stable Watch sitemap index in Google Search Console
   and Bing Webmaster Tools.
5. Record successful processing or any reported child error in FGE-17.

Search Console and Bing processing cannot be completed from a pre-deploy
worktree because both require the released production responses and operator
access.
