> Historical validation summary. Raw artifact paths and original checksum inventories below refer to the [preserved archive](../../STUDIO-ARCHIVE.md); they are not a current checkout file inventory. Test fixtures remain in Git.

# Matched local Manager and Core Watch loading

Baseline commit `4109b02c31242f1b0ca8c4975b6fada0eb2f3d87` was built in its own worktree with frozen dependencies; no WIP package links were used. Current Manager and Watch were production builds. Six rounds alternated baseline/current order, each with a fresh Chromium context, 1440×1000 viewport and loopback-only network. Measurements capture readiness, navigation, paint, long tasks and encoded script bytes. The first round includes colder server caches; these samples are not a general production speed benchmark.

Manager used the same owned canonical project and authenticated operator. Baseline median editor readiness: 532.759 ms; current: 501.799 ms. Encoded script bytes: 252351 → 253224 (+873). Core Watch used identical canonical owned Core content: baseline median Watch-now readiness 582.939 ms; current 523.929 ms. Script bytes: 959798 → 960308 (+510). Timing ranges overlap; no measured loading regression or claim of a significant speedup. Browser page errors were empty.

The Core fixture was created only in the owned database, then admitted by the real Core route-manifest refresh service. It was not a manually seeded Studio publication. The first refresh exposed Prisma's inability to decode a void advisory-lock result; `$executeRaw` fixed it and the actual service refreshed successfully. This is now covered by the database regression. The Core fixture uses no external media/provider request and does not establish Core video decoding or Mux acceptance; actual Studio playback/revocation is recorded separately.

Retained harness qualifications: baseline initially used the changed server's origin and correctly rejected same-origin authority; its own origin was configured before measurement. The first Watch selector matched both the h1 and h2 title and was replaced with the existing Watch-now button. Neither failed qualification is included in the six matched samples. Existing preview extraction/seek/gain and loading evidence remains in ../preview.

## Final-build qualification and single idle follow-up

After rebuilding the narrow typed-error changes, another six-pair sample measured Manager 497 → 538 ms (+41ms) and Watch 669 → 615 ms. Final script bytes were252,351 → 253,227 (+876) and959,798 → 960,309 (+511). These final-build samples overlapped the full Admin suite; they are not idle-host measurements. The first final-build Chrome launch failed before navigation due to /tmp inode ENOSPC; the successful run used the owned disk TMPDIR.

Exactly one agreed Manager follow-up ran after all own builds/tests/typechecks finished, with the same backend/data/browser conditions and alternating six pairs. Median readiness633→566ms did not reproduce the earlier increase. DCL 176.65 → 177.0 ms and FCP 204 → 206 ms were effectively unchanged; CDP task time 0.497 → 0.463 seconds, script 0.163 → 0.160 seconds, long tasks 93 → 25.5 ms. Aggregate Studio API resource duration 313 → 302 ms. The eight-CPU host remained busy: load approximately 6.9 and measured aggregate CPU 57–62%, with other host activity captured separately.

Timing direction changed across samples; end-to-end latency remains inconclusive. Neither speedup nor a no-regression guarantee is claimed. The consistent measurable payload change is 876 encoded script bytes in Manager and 511 in Watch. All samples and qualifications are retained; no further performance retry or speculative code weakening followed.
