# Studio feedback verification — September 23, 2026

Candidate: `codex/shorts-designer-feedback`, based on `4ec1f9820`.
The PR covers the user-authorized designer-feedback batch (feat-534–540).
The reproducible fixture and commands are in [README.md](README.md).

## Playback

- The supplied recording has black video intervals of 0.467s and 0.358s; text stays visible. Read-only production playback of Pharisee cold open r6 corroborated incoming video with readyState 0/1 after a cut.
- Before the fix, the synthetic HLS browser fixture recorded missing decoded video at frames 90, 95, 99, 104, 182, 189, 196, 270, 274, and 279. It uses the actual editor preview and composition, four clips, and 180ms media-request latency.
- After the fix, cold playback and replay visited cuts 90/180/270 and reached frame 389 with no sampled missing decoded video and no runtime errors. First decoded frame: 804ms on the cold fixture run; 914ms on a later reload. Peak mounted video elements: two. Cold run made 51 media requests; a reload followed by two full plays made 95 cumulatively. These are local fixture observations, not production latency estimates or an HLS bandwidth benchmark.
- One additional uninterrupted run stopped with the last observed frame at 387; the conservative harness reported incomplete rather than PASS. No missing decoded samples or errors occurred. Do not use manual seeking during a measured playback pass.
- A unit regression failed on the old player/session feedback path. Observed frames now update display state without issuing seek commands; actual seeks remain explicit and clamped. Production React #185 was observed once. Its exact native trigger/frequency was not deterministically reproduced, so the regression establishes removal of the feedback mechanism rather than proving every possible #185 cause.
- A separate 390-frame export completed. FFmpeg blackdetect (`d=0.03:pix_th=0.05:pic_th=0.92`) reported no full-frame black interval in the hard-cut/crossfade fixture. Authored fade-through-black intentionally reaches black.

## Editing and rendering

- Compared the grouped timeline with the designer's sketch: Video, Audio, Text in that order, overlap rows, draggable vertical playhead. Production editor transport contains only play/pause below preview; fixture diagnostic buttons are not product UI.
- Real pointer dragging moved continuously at zoom 1 and 4, including after horizontal scrolling and dragging backward. Home/End reached frame 0/389; keyboard seeking and pointer seeking preserved the saved revision. Window-level gesture listeners fixed a capture-only drag that stopped after two frames.
- Overlapping text is separately selectable. The fixture deliberately uses a legacy mixed visual track; the inspector retains that item's current track and offers compatible destinations. Layout tests preserve stored track/item ordering and independent lanes.
- Browser save/reopen retained Inter, shadow, scrim opacity 0.6, and Slide entrance at revision 2; a Crossfade edit survived a further save/reopen at revision 3. Undo/redo were exercised before saving. Session tests cover revision conflicts and styled/animated document restoration.
- The export case uses multiline cards in Inter, Montserrat, and Apercu, weight 500, shadow, stroke, local scrim, Slide entrance, Fade exit, and a 12-frame crossfade. Browser preview was visually compared with exported frames 15, 84, 105, and 195: font, wrapping, text-local background, and crossfade midpoint agreed. This is visual comparison, not a pixel-diff assertion.
- Pure-frame tests cover short-card duration bounds, reverse evaluation, legacy defaults, transition start/mid/end, source handles, ambiguous cuts, and source-range retention. Shared schema tests reject invalid effects and durations; Admin command validation accepts the new built-in fields.

## Build and performance

- Full Manager suite: 1,244 passed, two skipped. A subsequent focused run including the added persistence case: 25 passed. Studio contracts: 43 passed. Shorts compositions: 72 passed. Admin property-feedback: three passed.
- Manager and shorts-compositions typechecks passed. Touched TypeScript lint passed. Manager production build passed with the documented mock data/backend configuration and a local-only mock session secret.
- A production-mode esbuild comparison of Preview + Timeline + Inspector against the baseline measured initial gzip bytes 371,114 → 374,641 (+3,527 bytes, 0.95%). Font modules add 318,151 gzip bytes only when dynamically loaded. This component-entry measurement isolates the changed surface; it is not an end-to-end production page-load benchmark.
- Nearby video preloading is bounded by sequence premounting rather than mounting the entire project. Selected bundled fonts wait for load in preview and render. Inter/Montserrat use existing Latin subsets; other glyphs use fallback. Error propagation is implemented, but a forced browser font-network failure was not manually exercised.

## Standards

Parallel standards review found no hard violations. One nonblocking repeated-kind-mapping observation was resolved by sharing `groupTrackKind` between timeline, library, and inspector.

## Spec

Parallel spec review found no blocking missing behavior. Final review identified a legacy text-track dropdown inconsistency, now fixed. The fixture's readiness assertion and its limits are explicitly documented.

Findings after fixes: Standards — zero unresolved; Spec — zero unresolved blocking findings.

## Release limits

The candidate has not been deployed, and the designer's saved projects were not edited. Production project inspection supplied diagnosis evidence; the new behavior was verified using local synthetic media, not by rewriting Pharisee cold open or Peace in the Storm. Run a read-only smoke of those projects after the normal PR-to-main deployment. Opera extension access remains an external, unreproduced report; Chrome worked for the designer. No Opera-support claim is made.
