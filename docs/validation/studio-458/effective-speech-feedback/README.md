> Historical validation summary. Raw artifact paths and original checksum inventories below refer to the [preserved archive](../../STUDIO-ARCHIVE.md); they are not a current checkout file inventory. Test fixtures remain in Git.

# Canonical effective-speech feedback

Fixed reviewed base: `5a17a9da11f1c19ef369e6b629bae10aa87b2b6f`. Approved proposal SHA256 `90a2b497ac53b9a15b65454eb55b2ddda48c68b953ccdc622f3054ee44d7194e` is retained in `approved-proposal.body`. Root corrected the description to “after all operations have executed”: this is the final projection, not intermediate snapshots. Feature 458 remains in progress.

Scope: canonical effective-speech feedback, fixed base 5a17a9da11f1c19ef369e6b629bae10aa87b2b6f. Roadmap 458 remains in progress.

The projection contains all speech-bearing items in canonical timeline order, including suppressed and empty items. Text whitespace is unchanged. scriptDigest is existing scriptHash, shared through @forge/studio-server studioHash without a new identity algorithm. operationsDigest binds original parsed operations before projection. Native verifies project/revision/operations before exposing feedback as untrusted editorial data. Inline is complete within 30720 UTF-8 JSON bytes or explicitly unavailable; native result is measured within 32768 bytes. Valid oversized compositions are not invalidated.

Validation clones operations because existing applyOperations assigns speech object references then set-text mutates their text. Core applyOperations is unchanged. Original retained SSE arguments are original intent. Existing generation.read also exposes this alias in preview.proposal.command; this was reported separately and is not silently changed here. Retained canonical document remains final-result evidence. No closed bytes changed.

Tool descriptions clarify final projection after all operations have executed, later set-text synchronization with existing speech, and set-speech independence from display. No prompts changed. New schema identity requires fresh future paid admission.

Checks: Admin focused 23; native focused 22; contracts 14; server 2. Native full 3029 passed/27 skipped, before one subsequently added envelope test (focused 4 passed). Admin full 6203 passed/4 failed/85 skipped/1 todo: environment Redis fallback plus timeout/cascade in context and SEO tests during concurrent heavy work. Isolated network Redis rerun 8 passed; single-worker context/SEO rerun 47 passed. No timeout increases/shared Redis changes. Admin/Mastra/Manager builds and five affected typechecks passed. Original 597 manifest entries and all 132 originals verified.

All paid batches remain closed. No provider requests, media, registration, approval, apply or publication performed for this correction. Creative quality and real ElevenLabs narration/music/voice acceptance remain incomplete.

## Evidence and provenance

`fixture-provenance.json` binds the original paid SSE to the extracted `slot0-original-proposal.json`. Its set-speech text lengths are 582/317/43; subsequent set-text produces the retained final 219/140/43 character texts. Original whitespace and operation order remain intact. Closed preview `proposal.command` contains aliased final speech, not original intent; the retained canonical document is authoritative for final-result comparison. This correction isolates validation inputs; it does not change the separate historical read alias.

`schema-identity.json` and `shipped-tool-schema.json` record the changed tool description bytes captured through the installed SDK with local fake transport, zero external requests and zero tools. New digest: `c5475cff0878ca128819659600ccfbea6096c3ab115103248647b20885142967`. Closed digest `689c1b90f7876a4471803ecf026b3a60a69c7118618a9fbe2495f3fde0ecf70c` is unchanged. No old admission can authorize these new tool bytes.

Red/green logs retain failed assertions and corrected fixtures, including original-versus-final speech newline expectations and the SDK tool-message input versus returned-output distinction. The final envelope regression measures the maximum inline payload inside the actual returned native result. Independent fixed-base Standards and Spec reviews are retained separately.

## Loading comparison

All original sequential baseline/final and confirmatory-final samples remain in `loading-*.json`; these showed mixed results and did not establish a no-regression gate. The one subsequent interleaved comparison is `loading-interleaved.json`, with `interleaved-plan.json`, `interleaved-summary.json`, `interleaved-derived.json` and `interleaved-chunks.json`. Every sample is retained; no best-repeat selection or outlier removal.

The randomized order was baseline/final/baseline/final/baseline/final, three cold/warm pairs per build. Each pair restarted Manager on the same origin/port 3588, used a fresh Chromium context for cold navigation and the same context/cache for warm navigation, 1440×1000 viewport, serviceWorkers=allow, the same built Admin on 3587 and exact project/asset fixture. The opaque preview sandbox stayed unchanged. CPU metrics are CDP cumulative deltas from before navigation to controls; waterfall/nav/paint/CLS and host load/CPU snapshots are preserved. No task-owned builds/tests ran during sampling. Shared-host work was uncontrolled.

| Metric (ms, median [min–max]) | Baseline               | Final                  |
| ----------------------------- | ---------------------- | ---------------------- |
| Cold controls                 | 674.32 [661.12–698.04] | 671.59 [657.83–714.59] |
| Warm controls                 | 230.49 [223.31–357.92] | 254.50 [220.99–275.74] |
| Cold preview median           | 1466.25                | 1463.78                |
| Warm preview median           | 1021.59                | 1063.40                |
| Cold script CPU median        | 118.57                 | 117.10                 |
| Warm script CPU median        | 57.26                  | 60.73                  |

Cold transferred JavaScript was 257294/257568 bytes; warm was zero for both. All samples had zero page errors and CLS. One final cold sample recorded a 60 ms long task. Host load1 ranged 1.61–2.36 on eight CPUs. Cold task CPU medians were 354.71/343.28 ms; warm 168.72/180.21. Cold DOMContentLoaded medians were 224.0/227.6 ms; warm 83.9/88.3. No per-function CPU profile was collected, so aggregate script CPU does not isolate hydration or a particular changed function.

Changed main chunk network durations overlap (baseline 73.67–88.51 ms, final 63.33–78.15); unchanged 64428-byte chunk also varies (74.88–89.36 / 64.51–80.22). These observations do not attribute the earlier cold difference to changed chunks. The cold slowdown did not reproduce under alternation; warm median remains higher with overlapping distributions and modest aggregate CPU differences. Attribution remains inconclusive. This is not a passing no-regression certificate or proof of shared-host causation. No further benchmark repeats or speculative product changes were made.

The first interleaved harness failed before producing any sample because a relocated `.next` symlink changed external module resolution. `setup-failure-*` retains that failure. A same-filesystem rename restored the normal `.next` runtime path, using the original randomized plan. Baseline sources were temporarily overlaid from the fixed base and restored byte-for-byte (`baseline-overlay-before/after.json`); final build was preserved, not rebuilt between samples. Build IDs are in `interleaved-summary.json`; Admin ID is `v5kjg3BH4qqhvI9lvbRK6`. Initial sequential baseline ID differs from the newly rebuilt baseline and is recorded in `loading-summary.json`.

## Services and limits

Only own Manager 3588 was restarted to alternate builds; built Admin 3587, task-local PG 55458, Redis 56458, fixture login 3589, deterministic native 4188 and opaque preview 3586 were retained. Final Manager build and deterministic route were restored after the bounded run. No old preview sessions were purged. Read-only asset pre/post checks match registered bytes and leave project revision unchanged. Existing `/tmp/forge-studio-458-baseline` and its running dependencies remain untouched; all new build scratch used the workspace filesystem because `/tmp` inodes were scarce. Credentials are omitted from evidence.

The 936 previously unavailable disposable objects remain an explicit historical limitation; database rows are not retention proof. All 132 original baseline files and 597 prior evidence entries were verified unchanged. Real creative quality and ElevenLabs narration/music/voice acceptance remain open; this implementation and local loading evidence cannot complete those gates.
