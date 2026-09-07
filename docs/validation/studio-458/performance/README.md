# Loading measurements

Files prefixed `preliminary-dev-admin-` are intermediate baseline measurements against a development Admin backend. They are not comparable to the final built-Admin measurements and must not be used as a matched before/after claim. Both final sides use the same built Admin, viewport, browser context and `serviceWorkers: allow`; those results are recorded below.

## Preserved Admin 4 matched comparison

`final-admin4-{baseline,final}.json` contains three cold/warm pairs per Manager
build, sequentially measured with the same built Admin 4 backend and verified
project assets, no concurrent build/test, Chrome settings and task-local codec.
Baseline is reviewed feat-457 (`2855e265`); final is the feat-458 working tree
Manager build 7. These replace neither the dev-Admin nor built-Admin-3 intermediate
records, which remain explicitly named as such.

| Median                   | Baseline cold | Final cold | Baseline warm | Final warm |
| ------------------------ | ------------: | ---------: | ------------: | ---------: |
| Controls ready, ms       |         492.8 |      442.7 |         215.9 |      223.8 |
| Preview ready, ms        |        1294.1 |     1249.4 |        1006.4 |     1020.9 |
| LCP, ms                  |           480 |        460 |           216 |        212 |
| Transferred script bytes |        257891 |     257289 |             0 |          0 |

All samples have zero CLS and page errors. Baseline has one 53 ms long task;
final has none. These small local samples show no material loading regression,
not a statistically established speedup. Warm control/preview readiness rose
about 8/14 ms; cold readiness and LCP improved. Raw CDP network waterfalls, paint,
navigation and long-task records are retained for inspection.

## Final Admin 5 / Manager 8 comparison

After the typed-feedback/default correction, both sides were rerun against the
same final Admin 5 build, with final Manager 8 and the unchanged reviewed baseline.
The same three cold/warm pairs, Chrome 1440×1000, serviceWorkers allow, task codec
and exact assets were used; no builds/tests/formatter ran during sampling. Build
identities are in `../tests/final-build-identities.json`. Earlier Admin 4 records
above remain unchanged.

| Median                   | Baseline cold | Final cold | Baseline warm | Final warm |
| ------------------------ | ------------: | ---------: | ------------: | ---------: |
| Controls ready, ms       |         523.5 |      518.4 |         216.9 |      232.6 |
| Preview ready, ms        |        1319.4 |     1316.1 |        1006.0 |     1021.7 |
| LCP, ms                  |           524 |        524 |           208 |        232 |
| Transferred script bytes |        257891 |     257285 |             0 |          0 |

All samples have zero page errors and CLS. Baseline long tasks were 54, 52 and
56 ms; final had one 51 ms task. Warm readiness increased approximately 16 ms,
while cold readiness was effectively unchanged. These small local samples show
no material loading regression, not a statistically established speedup. Exact
referenced assets and project documents were checked before/after; see
`final-admin5-assets-{before,after}.json`.
