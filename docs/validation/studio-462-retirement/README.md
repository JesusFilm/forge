> Historical validation summary. Raw artifact paths and original checksum inventories below refer to the [preserved archive](../STUDIO-ARCHIVE.md); they are not a current checkout file inventory. Test fixtures remain in Git.

# feat-462 local legacy retirement

Fixed base: `aa4fc3d8a7989f2e809decfe63c2ace2f22aa51f`. Root released only this
independent retirement slice. Feature 462 remains **in progress**. This is not
full Studio, provider, image or deployed acceptance.

## Changes and preserved consumers

Removed legacy Manager screens, `/api/shorts`, workflows/client and exclusive
caption/draft/clone helpers; worker no longer admits prepare/render requests.
Extracted the unchanged lazy Remotion adapter for devotional rendering. Startup
and image provisioning no longer require the legacy Shorts bundle/Whisper model.
The retained devotional prebundle and transitive studio-contracts packaging remain.

Studio dashboard routes, navigation, editor and new dispatch/publication/runtime
code are unchanged. No calendar WIP, Prisma or Admin build-verifier changes.
Historical Shorts options/step literals remain for existing generic read/filter
and artifact identity consumers. CLI Whisper remains for the active devotional
snippet helper. Shared worker auth/queue/storage/transfer, compositions and fonts
remain. No original assets, stored data or archive were modified or deleted.

## Local verification

All temporary files use `/home/tataihono/.local/share/forge/studio-462-retirement/`.
Dependencies were installed offline/frozen from the existing store with normal
lifecycle/Husky hooks. Full suites ran sequentially with one worker inside an
isolated network namespace, so shared default Redis/Postgres and provider endpoints
were unavailable. Manager build used inert build-only values and two CPU affinity.

| Check                                      | Result                                                                                                |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| Failure-first worker HTTP/startup boundary | 3 expected failures: legacy prepare/render returned 202 and production required retired configuration |
| Focused retirement/engine/devotional tests | 48 passed; the later structured-failure case is included in the final full suite                      |
| Full worker suite                          | 148 passed, 17 files                                                                                  |
| Full Manager suite                         | 947 passed, 2 skipped, 154 passing files                                                              |
| Full shared compositions suite             | 69 passed, 9 files                                                                                    |
| Worker, Manager, compositions typechecks   | All passed                                                                                            |
| Worker TypeScript build                    | Passed; legacy prepare/render/whisper compiled modules absent                                         |
| Actual devotional prebundle                | Passed, retained devotional entry compiled in isolated network                                        |
| Host compiled production HTTP smoke        | 8 probes passed: health/auth, retired admission, unknown status/cancel; no provider job submitted     |
| Manager production build                   | Passed; three Studio dashboard routes present, legacy API routes absent                               |
| Manager and worker lint                    | Both passed                                                                                           |
| Independent Standards / Spec               | Both clear; see reviews.md                                                                            |

`checks.json`, `suite-summaries.json`, build logs and `built-boundaries.json` contain
exact results/identities. The final Next build, route and app-path manifests are
retained verbatim as `*-manifest.json.txt`. Full-suite logs remain at recorded task-owned paths with
SHA256; committed excerpts and focused red/green logs retain the behavior evidence.
Committed logs normalize trailing whitespace; original logs remain in owned scratch.
Text launchers reproduce the host checks after adjusting checkout/output paths.
They require the isolation wrapper used for these runs: from the repository root,
run each copied Python launcher inside `unshare --user --map-root-user --net`,
bring up only that namespace's loopback with `ip link set lo up`, then execute
Python. For example (replace the owned launcher path):

```sh
unshare --user --map-root-user --net sh -c 'ip link set lo up && exec python3 /owned/path/checks.py'
```

Use the same wrapper for `build-manager.py` and `worker-http.py`; running a
launcher directly does not establish isolation. They use inert fixture settings, not service credentials. No production or
shared services were started, stopped, or mutated.

The host has no Docker executable. Host compilation, prebundle, package-context
source checks and production HTTP startup do **not** establish the OCI image build,
Chromium/codec/fonts inside that image, registry publication or Railway execution.
That acceptance remains open; no unbuilt image is reported as passing.

## Loading impact

Only unreachable UI modules and selectors were removed. All 2,219 surviving CSS
rules preserve selector order, enclosing at-rules and declaration values. The two
canonical rule digests in `loading-impact.json` match. Studio routes, editor,
shell, layout and initialization source match the fixed base. CSS source shrank
327,084 → 314,152 bytes; gzip 47,467 → 45,336 bytes. `loading-proof.cjs.txt` retains
the exact comparison method. This is scoped static loading-impact evidence, not
new browser latency or network measurements. The Manager build verifies remaining
route compilation. Earlier inconclusive end-to-end release performance remains
inconclusive; no broad performance retries or new SLA claims were made.

## Remaining release gates

Reviewed final 461 integration and actual due dispatch, creative quality, real
ElevenLabs/Mux, actual OCI/deployed runtime containment, provider/token/cache
revocation, Claude Code app login, Lyuba/operator acceptance and normal reviewed
PR-to-main Railway release remain open. Published projects stay permanently
immutable after unpublish; no correction clone/replacement/republish is introduced.
All paid batches remain closed. This slice performs no provider/infra operation,
asset upload, push, PR, merge or deployment. Historical unperformed feat-178
acceptance is explicitly superseded, not passed.
