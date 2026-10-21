# Watch cache-size serialization candidate

Recorded 2026-10-20 23:18:35 UTC. Tracking: feat-750, still in progress.

## Result

A local candidate skips Next 16.3.8's JSON size calculation only for custom
cache handlers, which are exempt from the built-in FETCH size limit. The
repository already uses pnpm's versioned
Next patch mechanism; this extends that patch. There is no application config
switch that avoids the unconditional calculation before the custom handler.

The patch preserves the existing preload-promise change and the applicable 2 MiB
serialized-length check. Its scope is the standalone CJS/ESM IncrementalCache and
all four compiled APP_PAGE production variants (standard/Turbo, regular/experimental),
including the runtime in the production profile. Default handlers retain their
original serialization, even for APP_PAGE and implicit build-time entries.
Compiled dev, APP_ROUTE and Pages bundles are not optimized by this candidate. No cache-handler format, lifetime,
invalidation, analytics, recommendation, player or replica configuration changes.

## Regression and local timing evidence

`node apps/web/scripts/check-next-cache-size.mjs` fails on the original framework
code for all five executable entry points: the framework expands a synthetic page
buffer once before invoking the storage handler. After the patch it expands it
zero times. The same script verifies that the cached value survives a get/set,
normal FETCH entries at exactly the threshold are stored, over-limit production
entries warn and are skipped, over-limit dev entries throw E1003, and custom-handler
and implicit-build FETCH exemptions remain effective. It is included in Web's
normal test command as `test:cache-size`.

`pnpm --filter @forge/web run probe:cache-size` uses a **synthetic 1,941,310-byte
binary page buffer**, actual bundled production IncrementalCache get/set, and an
in-memory handler with base64/JSON encoding and decoding. A pending HIT callback
competes with one page cache write on the same thread. There is no Redis or HTTP
server. This fixture isolates framework work; it does not model real Watch routes,
multilingual rendering, network/Redis latency, tag checks or production traffic.

Eight alternating process pairs, 12 iterations each (96 per side), with Node
v24.20.0 and Next 16.3.8:

| Pending fixture HIT |  Baseline | Candidate |
| ------------------- | --------: | --------: |
| Median              |  90.25 ms |  16.70 ms |
| p95                 | 167.46 ms |  46.75 ms |
| Maximum             | 179.76 ms |  59.88 ms |

Each baseline process expands the page buffer 13 times (one warm-up plus 12 writes);
each candidate process expands it zero times while retaining the fixture storage
codec. Raw timing rows and red/green output are in the adjacent evidence directory.
These are mechanism measurements, not promised production TTFB savings,
representative page-load p95 or sustained recovery.

## Compatibility boundary

The owner requires that this repair preserve the other apps. The first broader
candidate also skipped unused serialization with default handlers. A new check
failed on that behavior in all five executable entry points. The candidate was
narrowed to custom handlers, and that regression now passes: custom APP_PAGE
buffers expand zero times; default-handler buffers still expand once, as before.
Normal FETCH limits and their custom/build-time exemptions remain unchanged.

An inventory of eight locked Next consumers finds `cacheHandler` configured only
in Web's `next.config.mjs`. Admin, Auth, Chat, Manager, Mastra Gateway, Roadmap and
TV Feedback use the default path and retain its original behavior. This is a
source/configuration boundary and local runtime verification, not a claim that
all eight applications have passed full builds or integration tests.

Admin's existing seven `/api/health` readiness unit tests pass. They verify
pending/missing/failed preload handling, GraphQL initialization and Redis probe
behavior with mocks. The first focused run used Web's installed Vitest with a
temporary config preserving Admin's source alias, Node environment and setup
because Admin dependencies were not yet installed; that command remains in
`compatibility.json`. After installing both dependency closures, the normal Admin
runner also passes all seven tests, as recorded in `release-validation.json`. No
Admin source or test changes were made. The original CJS/ESM startup hook remains
byte-identical to the existing patch.

The shared dependency-version guard and its unit assertions also pass. Inventory,
commands and results are retained in the evidence directory. Other applications' full builds remain for normal CI; actual Watch mixed-route
production validation remains part of the documented rollout acceptance.

## Checks and remaining work

- Five actual runtime regressions pass after failing on the baseline.
- Scoped script lint and formatting pass; the final package test command runs
  the same regression. The entire dependency patch applies to pristine files,
  and the result matches the locally exercised runtime files byte for byte.
- The pnpm patch checksum and all 46 lockfile references match. Minified guard
  replacements keep byte width and line counts, preserving subsequent source-map
  positions; unchanged upstream maps do not newly describe the rewritten guard.
- A fresh frozen Web/Admin dependency install, full Web production build,
  typecheck, lint and test suite pass. The suite reports 318 passing files and
  5,502 passing tests, with 3 files/13 tests skipped and one todo. Admin's seven
  readiness tests also pass using its normally installed runner.
- Default/custom-handler production HTTP probes preserve controlled inventory
  content, warm route-cache reuse, metadata, locale isolation and RSC prefetch.
  These copy the actual route source with fixture data/views; they do not prove
  real Watch home/detail behavior under concurrent regeneration and live Redis.
- Local validation is ready for a focused PR. Any rollout follows normal
  PR-to-main flow. After rollout, compare matched real traffic and exercise the
  documented home/detail, recommendation and player checks before claiming
  sustained production recovery. Other apps' full builds remain for normal CI.
- Incident recovery remains subject to the documented sustained production gates.

## Reproduction

On a checkout with the candidate patch installed:

```sh
pnpm --filter @forge/web run test:cache-size
pnpm --filter @forge/web run probe:cache-size
```

For a control, use the same Node/dependency versions with the existing preload-only
Next patch and run the same fixture scripts. The check must go red; the benchmark
must still verify returned binary bytes. The recorded comparison swapped only the
six cache implementation files between their baseline/candidate contents while
retaining the identical existing startup hook on both sides, started
a fresh Node process for each measurement, alternated order and restored candidate
files in a finally block. Baseline copies and the throwaway driver are retained in
the worktree's ignored `node_modules/.cache/watch-cache-size/` for this local review.

## Existing production cache entry size — 2026-10-21 NZDT

At 13:09 NZDT, read the existing English home entry without requesting or
regenerating a page. The Redis read window was **2026-10-21
00:09:23.484–00:09:23.545 UTC**. The separate diagnostic process ran on deployment
`20f52ebd-0763-4146-9c80-00d6116cdaee`, replica
`2177c2e4-9b0f-4a37-8921-670be3b1dc2b`. This identifies the reader; Redis is shared,
so it does not identify which replica wrote the entry. Its last-modified timestamp
was `2026-10-21T00:08:09.989Z`. It is a new snapshot, not the historical slow trace's
exact entry version.

| Stored part                          | UTF-8 bytes in Redis JSON |  Share |
| ------------------------------------ | ------------------------: | -----: |
| HTML string                          |                   968,550 | 49.89% |
| Base64 RSC string                    |                   482,838 | 24.87% |
| Segment-data object (four segments)  |                   489,273 | 25.20% |
| Remaining metadata and JSON envelope |                       642 |  0.03% |
| Total                                |                 1,941,303 |   100% |

HTML/RSC/segment measurements include each field's JSON value encoding. The
remainder includes field names, punctuation, status, headers, tags and lifecycle
metadata. Categories sum exactly; percentages round. The JSON string has
1,941,232 JavaScript characters, distinct from UTF-8 bytes.

Before JSON escaping, the HTML is 906,511 bytes. Within it, nine script elements
containing `self.__next_f.push(` occupy 390,408 bytes, leaving 516,103 bytes of
other HTML. This is a subset of HTML, not an additive field. Standalone RSC decodes
to 362,126 bytes, and the four segments decode to 366,893 bytes. Base64 increases
those binary representations by about one third. These measurements establish
representation volume, not exact semantic duplication, avoidable bytes, field
serialization CPU cost or incident recovery. Next uses these forms for document
loads, hydration, navigation and prefetching; removing them requires a separate
behavior-preserving design and verification.

The measurement establishes that tag/lifecycle bookkeeping is tiny in this entry.
The next payload-reduction investigation should attribute rendered HTML and
component/segment data to content and props, rather than optimizing metadata.
The previously prepared redundant-size-pass repair remains independently useful.

### Read-only method and reproduction

Use the authenticated Railway CLI with explicit project/environment/service IDs
from the incident plan and a separate `railway ssh ... -- node --input-type=module
-e <diagnostic-source>` process. In memory, concatenate
`apps/web/scripts/measure-cache-entry.mjs` and
`apps/web/scripts/collect-existing-home-cache-entry.mjs`, removing the latter's
relative import of `measureCacheEntry`. No diagnostic file is written in the
production container. The collector checks the exact Web service/environment,
uses a 10-second process deadline, disables Redis reconnects, and reads only:

```text
GETRANGE <configured-prefix><Next-route-cache-key> 0 8388608
```

Derive the key using the deployed Next `getRouteCacheKey("/en/en", {kind:
"APP_PAGE", sourceRoute: "/[locale]/[htmlLang]/page"})`, with the existing
configured prefix. The cap is 8 MiB, plus one sentinel byte to detect overflow.
Do not scan keys or invoke the cache handler: handler calls can add tag checks,
cleanup or write side effects. Preliminary discovery used five STRLEN operations
on exact candidate keys: three legacy pathname candidates were absent, the
framework-derived `/en/en` key existed, and the `/watch/en/en` candidate was absent.
An earlier shell-quoting attempt executed no probe. No public HTTP requests were
made for this measurement.

Only aggregate numbers and known route/deployment identity left the diagnostic
process. No raw entry, HTML, props, tags, header values, key names or credentials
were printed or persisted. The analyzer's synthetic check verifies Unicode versus
character accounting, JSON escaping, base64 decoded sizes, segment counts, exact
byte reconciliation and content redaction:

```sh
pnpm --filter @forge/web exec vitest run scripts/measure-cache-entry.test.mjs
```

Scoped ESLint and Prettier checks apply to the three diagnostic scripts and this
documentation. No runtime instrumentation or application import was added.

## Release preparation — 2026-10-21 00:23 UTC

The owner requested shipping the redundant-serialization repair first, with
payload reduction kept separate. Fresh targeted checks pass: all five framework
entry points, seven Admin readiness tests, eight Redis cleanup cases, the byte
accounting/redaction case and 38 cache/scheduler/identity telemetry tests. Scoped
ESLint reports no warnings; the ESM framework source passes Node syntax checking.
The diagnostic byte-accounting case was converted to an actual Vitest test after
the app's test glob correctly rejected its initial standalone-assertion form.
This fixes test-runner integration without changing application behavior.

GitHub main is one unrelated TV-only commit ahead of this worktree's base at this
check. A PR description is prepared locally; no branch, commit, push or PR has yet
been created. The existing host-specific disk guard remains absent. The owner has
been asked whether normal disk-space checks and validation on this host can
replace that requirement; dependent heavy operations remain pending that answer.
Disk inspection showed 91 GiB free. No production mutation or new probes occurred.

## Portable host policy and completed local release checks — 2026-10-21

The owner requested making the inherited disk rule generic. The investigation
plan now checks checkout/temporary disk space and inodes natively, resolves the
optional guard from PATH, and proceeds with normal validation when it is absent.
That supersedes the host-policy blocker recorded above. Checkly skill discovery
also uses the current host's installed catalog rather than another user's home.
The native checks showed 90–91 GiB free in the checkout and 23 GiB in temporary
storage; no resource shortage was observed.

A fresh frozen install applied the checked-in patch into pnpm's package directory
with hash `d775pmxr7lcqy4djkbxhcf2kxi`. The full Web build, typecheck, lint and test
suite pass, as do Admin's seven existing readiness tests using its own installed
Vitest. The first build revealed missing Admin dependencies in the initially
Web-only install; installing Web/Admin dependency closures fixed that local setup
without source changes. Exact commands and counts are in `release-validation.json`.

The existing production inventory probe now accepts `--custom-cache-handler`.
Both handler modes pass real Next build/start HTTP checks for 1,000 rendered cards,
metadata/canonical URLs, a repeated cache hit, per-request rendering, locale
isolation, RSC prefetch and rejection before resolving a blocked route. The custom
HTTP fixture shares its store across handler instances because Next constructs
handlers per request. It is separate from the per-instance serialization fixture.
The original per-instance fixture correctly failed the warm-hit expectation in
HTTP mode; the shared-store fixture passes it. No Redis or real Watch content is
used by these probes, so their timings are compatibility observations only.

```sh
node apps/web/scripts/probe-inventory-request-memoization.mjs
node apps/web/scripts/probe-inventory-request-memoization.mjs --custom-cache-handler
```

Durable upgrade guidance is recorded in
`docs/solutions/performance-issues/next-custom-cache-unused-size-serialization.md`.
The dependency patch, cache semantics and payload contents are unchanged from the
narrow candidate. The investigation remains in progress for normal PR review,
rollout and the sustained production acceptance gates.

## Deployment preparation — 2026-10-21

The owner authorized deployment through the normal PR-to-main flow. Initial CI
passed application builds, including Web, but CodeQL flagged the diagnostic
HTML script regex for missing end tags with whitespace or attributes. The
measurement helper now accepts those end-tag forms; three additional cases
cover whitespace, attributes and mixed case. All four measurement tests and
scoped lint pass. This changes diagnostic byte accounting only; the framework
cache patch and runtime behavior are unchanged. The original measured Next
output used ordinary end tags, so its recorded field sizes remain applicable.
