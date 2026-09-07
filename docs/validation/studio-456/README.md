# Studio 456 operator checkpoint

Fixed implementation base: `65836fc0fb85dad733a3de84792e3d4731a968aa`.
Production Manager build: `manager-build-5.log` (12.3 s compilation, 18.5 s
TypeScript). Native preview build uses Remotion 4.0.475, React 19.2.4, Sucrase
3.35.1 and HLS.js 1.6.16. Codec proof uses `/tmp/studio-proof-ffmpeg`
7.0.2-static and the installed Remotion compositor's ffprobe n7.1.

## Operator evidence

Actual authenticated browser workflows passed:

- Standalone creation, multiple tracks/items, text inspection, source trim/crop,
  undo/redo, save/reopen, selection/playhead retention and decoded real HLS.
- Two independent clients: stale save rejected; replacing the reviewed revision
  rejected again after an unseen third revision; explicit latest review reconciled.
- Uploaded versioned TSX, declared controls updating rendered code, parent DOM
  denial, compile/throw diagnostics, runaway watchdog with responsive Manager,
  and Undo recovery. Deleting broken code recovers immediately; deleting,
  restaging and undoing a valid component restores its code.
- Real WAV/PNG upload and scoped decoding; audio gain 0.25 and 0.5 s in-point
  persist after reopening. Playback starts at 0.508 s with the saved gain.
- Immutable Content Pack selection, passage inspection, save/reopen.
- Twelve rapid source changes followed by a usable real-source preview.

`registered-codec-evidence.json` records digest-bound 480×270 preview and
1920×1080 export-source H264 manifests, each retaining two original five-second
segments covering the selected 28.6–30.6 s range. Canonical subtitle digest is
`dac326cbf9bc0d58d35344f4234aa26e7dab97d85ae33fab3035c1da86bd8dbd`.
No whole-film download or prepared MP4 is needed. This verifies selected source
bytes and codec, not a final exported composition; export execution remains 460.

Final screenshots are local, with checksums in `artifacts.json`:
`/tmp/forge-studio-456-prep/operator-nle-final.png`,
`operator-conflict-final.png`, `operator-custom.png`, `operator-assets.png`;
final load screenshots are under `/tmp/forge-studio-456-final/`.

## Performance

Same Chrome 152.0.7977.64, 1440×1000 viewport, three cold/warm pairs, warm local
servers, no CPU/network throttling. Cold means fresh context and cleared HTTP
cache; warm means second document navigation in that context. Working-controls
measurement includes automation dispatch/actionability overhead and requires an
actual menu interaction. Creation now fills the project title instead of legacy
source search. The observation window remains one second. Baseline harness bytes
are preserved exactly; final harnesses include failure diagnostics and explicit
navigation cleanup **after** measured windows, before context closure.

Medians (milliseconds; JavaScript transfer in bytes):

| Route/cache | Baseline load | Final load | Baseline controls | Final controls | Baseline JS | Final JS |
| ----------- | ------------: | ---------: | ----------------: | -------------: | ----------: | -------: |
| List cold   |         347.5 |      201.6 |             592.8 |          442.3 |      255902 |   243384 |
| List warm   |          70.1 |       59.4 |             292.4 |          273.0 |           0 |        0 |
| Create cold |         485.9 |      210.5 |             982.5 |          433.6 |      772091 |   243384 |
| Create warm |          88.2 |       60.5 |             332.2 |          268.8 |           0 |        0 |

The editor is measured separately with actual footage, image, audio, text, custom
code and a Content Pack. Median usable controls: **537.1 ms cold / 271.1 ms warm**;
decoded-video readiness: **2205.9 ms cold / 1814.6 ms warm**. Parent JS transfers
256283 bytes cold and zero warm; parent long tasks total 50–58 ms cold and zero
warm. Runtime long-task totals are 264–306 ms cold and 205–294 ms warm. Its gzip
bundle has 417668 encoded response bytes. Cross-origin Resource Timing zeros do
not establish runtime cache hits; encoded response size is not asserted to equal
network transfer for cached responses. CLS is recorded in the sample summaries.

Final decoded seeks at frames 15/30/42 took **60.4 / 72.2 / 79.5 ms**; decoded
media times were 4.069 / 4.5695 / 4.986589 s in the retained segment window.
There was no prepared legacy source, so legacy editor/seek comparison is
**unavailable**. List/create improvements are not used as an editor comparison.
Raw Navigation/Resource Timing and request waterfalls remain local and hashed.
These unthrottled measurements describe this fixture/host, not a production SLA.

## Session lifecycle

The original final-editor measurement hit a genuine 429 after many test browser
processes were closed abruptly. `quota-diagnostic.json` preserves that result;
it is not counted as a successful performance sample. Abrupt process termination
cannot guarantee unload delivery. Abandoned sessions can remain for up to fifteen
minutes; the eight-session cap is unchanged.

The successful final harness navigates out of the editor, observes authenticated
DELETE 204, then closes each context outside its measured windows. After all six
editor samples, `capacity-after-navigation.json` shows eight available slots,
then 429 at the limit, and eight successful releases. The real HTTP preview-host
regression advances only its isolated child process's clock: abandoned sessions
expire, renewed sessions remain, reclaimed capacity admits work, and the cap
still applies. No production TTL or clock substitution was added.

## Commands and results

Logs are under `/tmp/forge-studio-456-prep/` unless stated otherwise.

| Command / check                                                                                                                                                                                   | Result / log                                                                                                               |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `node runtime.mjs build` with isolated Manager configuration                                                                                                                                      | PASS, `manager-build-5.log`                                                                                                |
| `pnpm --filter @forge/manager test`                                                                                                                                                               | 152 files / 1178 tests PASS, `manager-full-tests-final.log`                                                                |
| `STUDIO_TEST_DATABASE_URL=postgresql://studio456@127.0.0.1:55456/forge_studio_456_test DATABASE_URL=postgresql://studio456@127.0.0.1:55456/forge_studio_456_test pnpm --filter @forge/admin test` | 6156 PASS, two environmental failures, 85 skipped / one todo; `admin-full-tests.log`                                       |
| Isolated `src/config/env.test.ts` with placeholder environment                                                                                                                                    | 64 PASS; full-run assertion expected `forge_admin` in the disposable DB name, `admin-isolated-regressions.log`             |
| `unshare -Urn env -u DATABASE_URL -u STUDIO_TEST_DATABASE_URL pnpm --filter @forge/admin exec vitest run src/auth/rate-limit.test.ts`                                                             | 8 PASS; host has live Redis where the existing test expects refusal, `admin-rate-limit-isolated-network.log`               |
| Focused real-PostgreSQL Studio suites                                                                                                                                                             | 33 PASS, including source expansion denial through apply/render and 132 retained-original roundtrips, `studio-suite-1.log` |
| Post-review authority/command regression                                                                                                                                                          | 20 PASS, `admin-review-fixes-tests.log`                                                                                    |
| Four package typechecks: Admin, Manager, contracts, preview                                                                                                                                       | PASS, `typechecks-review-final.log`; final Manager/preview and expiry-test checks also PASS                                |
| Manager/contracts/preview lint plus touched Admin lint                                                                                                                                            | PASS, `lint-last.log`, `admin-lint-final.log`; staged lint enforced again by commit hooks                                  |
| Contracts tests                                                                                                                                                                                   | 4 PASS, `contracts-preview-tests-final.log`                                                                                |
| Preview native HTTP lifecycle regression / preview build                                                                                                                                          | PASS, `preview-expiry-tests-final.log`                                                                                     |
| Editor state / delayed source identity / active component identity                                                                                                                                | 10 PASS, `editor-tests-last.log`; failure-first logs retained for save-flight and component-signature fixes                |
| Fresh local migrations                                                                                                                                                                            | All 88 PASS in both disposable databases, `browser-migrations.log`                                                         |
| Independent fixed-base Standards + Spec reviews                                                                                                                                                   | Both clear after fixes; see `review.md`                                                                                    |
| Commit hooks                                                                                                                                                                                      | `lint-staged` and repository `format:check`; final result accompanies the local commit handoff                             |

The full Admin suite's storage tests delete worktree-local media fixtures. Final
browser verification therefore uses a freshly migrated/separately seeded
`forge_studio_456_browser` on this task's own PostgreSQL port 55456. Studio DB
regressions remain on `forge_studio_456_test`. No production/provider writes,
paid calls, deployment, push or merge occurred.

## Reproduction and integration

Use a disposable checkout with package dependencies installed and no Admin or
Manager `.env` files: Next loads those files in addition to the launcher's
explicit environment. Do not copy production credentials into the fixture.
Copy `*.mjs.txt` to `.mjs` to execute. Exact historical/final measurement harnesses
retain their absolute executed paths. Adjust checkout/artifact paths for another
machine; preserve viewport/cache/run count and the control definition.

`fixture-runtime.mjs.txt` and `fixture-login.mjs.txt` are secret-free reproduction
variants. Create `/tmp/forge-studio-456-reproduction/` first. The runtime variant
generates mode-0600 disposable signing/service keys; it supports `build`,
`manager`, `admin`, `preview` and `seed` modes. Start an owned PostgreSQL instance
on 55456, create/migrate `forge_studio_456_browser`, copy `catalog-fixture.json`
there as `public-catalog.json`, and copy `studio456-seed.ts.txt` into Admin `.tmp`
as `studio456-seed.ts`. Run it through the launcher's `seed` mode. Start Admin
3459, Manager 3456, preview 3460 and fixture-login 3458. Create the project through
the browser; set the harness's project JSON path to that project. The pack fixture
requires a captured source first. Keys and fixture cookies are never committed.

Deployed configuration and the trusted interactive transport are documented in
`docs/solutions/security-issues/studio-standalone-editor-runtime.md` and Manager's
guide. Deploy preview on a genuinely different registrable HTTPS site; provision
the exact codec binaries and dedicated keys. Production execution-service
launcher/final composition export/publication stays 460. Agent/MCP transport 457
must retain delegated authority and cannot mint the interactive assertion.
