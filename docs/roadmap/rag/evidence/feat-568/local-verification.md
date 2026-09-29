# Portal Sources — local verification

Verified locally on 2026-09-29. No production read, ingestion, migration or
deployment was performed. The input is the committed production snapshot observed
on 2026-09-22 at 03:52:08.959 UTC.

## Behavior

The existing 57 production ingestion keys display as eight content brands, with
24,607 total embedded documents and 48 distinct detected language codes.
EveryStudent consolidates 48 production domains; thelife consolidates three.
Grouping does not rewrite keys or change consumer configuration, retrieval,
filtering, citations, lifecycle YAML, evaluation or public dashboard artifacts.

Facade and HTTP tests cover count conservation, many-to-many domain/language
coverage, unidentified documents, domain-specific unexpected-language labels,
missing declarations, explicit memberships, malformed snapshots, admission
revocation, read failure isolation, and the actual packaged snapshot path.

An isolated Playwright server uses the real portal routes and committed snapshot
with synthetic admission. Browser checks cover catalog/domain search, exact-code
and name language filters, source selection, pagination across 265 synthetic
languages and 25 brands, snapshot retry, expired sessions, late-response disposal,
and desktop/mobile rendering. Browser requests remain same-origin.

`output/sources/desktop.png` and `output/sources/mobile.png` are ignored local
visual evidence. No browser traces or credential-bearing artifacts were captured.
The existing database-backed consumer onboarding e2e suite was not run; existing
consumer HTTP tests remain in the passing package suite.

## Page-loading evidence

Chromium executable: existing local Playwright Chromium 1243. Compared the
pre-change portal assets retained in a running server against the candidate on
the same machine, viewport 1536×1024, one warm-up plus three measured navigations.
Both used the same synthetic admitted identity with consumer management disabled.
This measures the shared shell, not production GitHub admission latency.

| Metric                               |  Before |   After |
| ------------------------------------ | ------: | ------: |
| Initial requests, including document |       8 |       8 |
| Initial transferred bytes            | 133,217 | 134,236 |
| Median DOMContentLoaded              | 26.7 ms | 24.3 ms |
| Median load                          | 35.3 ms | 33.3 ms |

Initial transfer grew 1,019 bytes (0.76%). No Sources code, stylesheet or catalog
request occurs before selecting Sources. First activation took approximately
126 ms in the local sample, loading only its module, stylesheet and protected
catalog response (about 38 KB combined). Timings are local observations, not a
production latency guarantee. The browser regression check also enforces the
absence of these requests on initial load and no horizontal document overflow at
390×844. Original detailed timings remain in ignored
`output/sources/performance.json`.

## Checks

- Package suite: 903 tests passed; five database-gated tests skipped.
- Focused HTTP suite: 40 tests passed, including seven facade/route tests.
- Isolated Sources browser suite: five tests passed.
- Typecheck, lint, dependency import law, lifecycle validation, public dashboard
  verification, touched-file formatting and whitespace checks passed.
- Final package and browser verification uses repository-pinned Node 24.21.0.

Normal PR-to-main deployment and live portal acceptance remain external to this
local verification. A newer inventory requires the existing post-ingestion
status-dashboard refresh/PR workflow, not a portal refresh button.
