# Studio generation and narration validation

Work remains in progress. These records distinguish local product orchestration,
real fixed-input LLM results, and outstanding provider/creative acceptance. They
are not a render or publication release (feat-460).

## Evidence boundaries

The four authorized saved-case requests completed once through OpenRouter/OpenAI:
returned cost USD 0.018684, total elapsed 21,977 ms. The USD 2 authorization ceiling
and USD 0.139728 conservative standard-usage estimate are separate from that
returned cost. Exact request/response files and original/corrected preflights are
preserved. Raw request/response files use `.body` rather than their original
`.json` extension to prevent formatter changes; all 16 original provider evidence
files still match their previously recorded hashes. `llm-operator-comparison.md` records failed creative outputs; regression
tests use those failures. This batch did not exercise the hosted native workflow.
A separately authorized native-hosted follow-up is now closed: two runs/eight
requests, USD 0.0972243 provider-reported cost, no retries. See
`native-hosted-live/summary.json` and `comparison.md`. One case yielded an accepted
proposal and preview; the other retained prose after correct role rejection.
Creative quality remains partial/failing. No further paid LLM requests or
ElevenLabs requests are authorized at this point.

Music, voice design/registration, narration and audition browser evidence uses
explicit local provider interception returning synthetic audio. It proves request
ordering, byte identity, storage, playback, approval and selection behavior; it
does not prove ElevenLabs entitlement, invoice amounts, natural voice quality or
musical quality. Unknown actual charges remain unknown. The completed native-hosted comparison remains candid about quality failures;
account-specific ElevenLabs facts and authorized actual media verification remain
required.

The 132 recovered Lyuba originals remain untouched, including 87 narration files
with incomplete historic provenance. None becomes an equivalent narration cache
entry. An old storage unit test deleted the entire disposable local asset root.
Its cleanup now targets only a UUID-owned test asset folder. 153 files could be
restored from already-preserved bytes matching registered sizes and digests;
**936 older disposable fixture objects remain unavailable**. Database rows do not
prove those bytes were retained. Final runs check only their exact referenced
assets, with pre/post byte hashes; missing unrelated objects are not reconstructed
or represented as retained media.

## Local workflow and tests

`browser/final-orchestration/` records explicit single and two-project generation,
proposal preview/apply, complete speech approval, three initial narration calls,
zero calls after a font change and one call after changing bridge speech. Exact
approved strings match adapter-observed strings. Page errors are empty. This
intermediate built run remains valid for those behaviors, without being relabeled
as the final layout or paid-provider result.

`browser/source-final/` records hosted native readProject/readPack/readSource,
canonical source-containing proposal preview/apply and zero page errors. The
source is a synthetic three-second colour-and-tone clip, with an exact retained
English VTT, Video/Dub/Edition/range/digest identity and complete single-page
coverage. It is not recovered historical footage or creative-quality evidence.
Intermediate failures remain under `browser/source-intermediate/`: forbidden
source host, local codec crash and absent task Redis were diagnosed separately;
production allowlists and iframe isolation were not weakened.

`tests/admin-studio-final-4.log`: 61 scoped tests pass, including real PostgreSQL
claims/concurrency, atomic attachment/ripple, opposite insertion/timeline ordering,
source continuation/eligibility and storage cleanup. Equal-timestamp history
paging has a preserved 20/22 failure and 22/22 pass. Both production panels expose
older runs. Twenty-two cancelled narration rows used for browser history are
explicit display fixtures, not generated outputs or approvals.

The complete Admin suite recorded 6,143 passing tests and one known environmental
Redis fallback failure. The same rate-limit file passed all eight tests in a
network namespace (`unshare -Urn`), without changing shared Redis. The complete
Manager suite passed 1,201 tests; Mastra passed 3,011 tests with 29 skipped.
Final affected builds are Admin 5, Manager 8 and Mastra 2; all passed.
Neutral contracts, Manager and Mastra typechecks passed; Admin build includes its
TypeScript check. Scoped ESLint passed. Full logs retain skips and warnings. Targeted tests after subsequent fixes are
recorded separately. Independent Standards and Spec follow-ups cleared the final
production-history, typed role-feedback, editable rubric calibration and test changes; see `reviews/`.

The unpaid follow-up preserves the actual rejected ch31 proposal as a regression.
Canonical validation returns bounded role/coverage facts and codes; the native
tool returns those facts to the next model turn without applying operations or
weakening source authority. Semantic scripture/self-echo findings remain separate
from explicit speech roles. Editable defaults now define the recovered echo checks
and cite ch19’s unsupported depth pass; `native-hosted-live/editorial-evaluation.json`
retains the actual words and judgments. Existing frozen native versions are not
overwritten or activated by this code change. Future use requires the existing
explicit native version/activation workflow. No new paid evaluation has run.

## Reproduction isolation and media toolchain

All mutations use the task-owned PostgreSQL database on loopback port 55458, with
canonical and native migrations applied. The authoritative native store remains
`mastra_studio_authoring`; the generic Editor cannot access it. Built Admin runs
on 3587, final Manager on 3588, baseline Manager on 3598, with separate preview
hosts and task-only session/provider fixtures. Built source materialization also
requires the task-local Redis on 127.0.0.1:56458 (persistence disabled). Do not point
these harnesses at production or shared services. No credentials are retained in
this evidence.

Both final and baseline browser contexts use Chrome at 1440×1000 and
`serviceWorkers: "allow"`, with unfiltered page-error observation. Playwright's
`block` injection itself accessed a forbidden getter in the opaque iframe;
`preview-diagnosis/` contains an independent minimal red/green reproduction.
The application sandbox remains `allow-scripts`, without `allow-same-origin`.

The old FFmpeg 7.0.2 static proof binary segfaulted on MPEG-TS/HLS in an independent
same-byte invocation outside Forge. It still decoded the MP4 fixture. The task
uses BtbN **n9.0.1-27-g9b0578816c-20260907**, obtained through the official
[FFmpeg download page](https://ffmpeg.org/download.html). Exact artifact:
[ffmpeg-n9.0-latest-linux64-gpl-9.0.tar.xz](https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-n9.0-latest-linux64-gpl-9.0.tar.xz),
SHA-256 `da49baa2fd544ac090fa8adac19d2d6d1f781e75556c4f95dcc0a4f2dd22b1a6`.
The mutable `latest` URL alone is insufficient to reproduce it: verify this hash
and the asset metadata in `codec/btbn-artifact.json`. The archive is retained in
the task's external runtime directory, not committed. `codec/same-bytes-reproduction.json`
records old/new binary hashes, identical input hashes, exact commands and exits:
old MP4 succeeds, TS/HLS signal 11; new all succeed. Probe is Remotion 4.0.475's
bundled n7.1 binary. This is a tested downstream provisioning requirement for
feat-460, not a silent revision of feat-456's earlier codec evidence.

## Loading and release gaps

`performance/` preserves the original dev-Admin baseline as non-comparable and an
intermediate built-Admin-3 baseline. The preserved comparison used the same rebuilt Admin 4 for both baseline and final
Manager 7, the same browser settings and verified assets, with builds/tests idle.
Raw network, paint, layout shift, long-task and preview/control readiness samples
show no material local regression; see the exact small-sample comparison there.

A final matched rerun after the typed-feedback correction used Admin 5 on both
sides and Manager 8, again three cold/warm pairs. Warm controls/preview rose about
16 ms; cold readiness was effectively unchanged, with zero page errors/CLS.
Final build identities and raw measurements remain inspectable.

Final rebuilt expanded audition/history and retained source checks passed, with
zero page errors or new provider calls. All 16 referenced assets and three project
documents matched before/after hashes. See `browser/final-retained/`.

Implementation commit `341d57f05f381eab2d8f0bb828c9788c6035ed7d` passed the
normal ESLint, staged-format and full-repository format hooks. `SHA256SUMS`
addresses all retained evidence files; exact provider bytes remain unchanged.
The subsequent documentation handoff commit contains this record.

Outstanding acceptance: creative-quality acceptance after the preserved failed comparison, and
authorized actual narration/music/voice audition with verified billing facts. The
ticket stays in progress. Typed role-feedback regression and editable rubric
calibration are unpaid corrections; they do not relabel the failed paid outputs.
