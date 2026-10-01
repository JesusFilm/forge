# Authoring contract and examples

Use live tool schemas as the authority for shape. This reference records the shipped contract; if a tool differs, discover its schema and explain any missing capability. Examples are small, complete command inputs, not IDs to reuse. All `example-*` identities and repeated-letter digests are placeholders that must be replaced by server results. Choose unique project/item/track IDs and retain command idempotency keys in conversation state.

## Start and source selection

[create.json](../examples/create.json) is a 15-second, 1080×1920, 30 fps empty project input to `shorts.create`. It uses the current supported runtime. Runtime changes should come from the connected contract or an existing current project, not an invented value. The example language is the canonical slug `english`; reuse the source/project's exact language slug rather than assuming an ISO code. `expectedRevision` is 0 only for creation; subsequent commands use the returned positive revision.

Discover `shorts.packs`/`shorts.pack` when relevant, keeping immutable evidence separate from editorial guidance. `shorts.search` takes `{ "search": "your topic", "language": "english" }` and returns eligible video/dub/edition identities, canonical subtitle tracks, download IDs, and duration. Prefer the requested language and primary human subtitle track when available; report AI-generated or missing evidence accurately. Search is bounded, so vary a focused search if needed rather than claiming exhaustive coverage.

Use [capture.json](../examples/capture.json) with identities from that result, then use `shorts.sourcePreview` with `{ "sourceSnapshotId": "RETURNED-ID", "language": "english", "startMs": 0, "endMs": 15000, "offset": 0, "limit": 20 }`. Follow `nextOffset` until null for the selected range. Read `shorts.source` by snapshot ID if reconnecting. Copy the returned snapshot's **entire `source` object** into a video item, including subtitle, preview and export immutable references. Never replace canonical subtitles with a generated transcript or use caller-provided media URLs as source references. Trusted rendering handles source materialization.

For a broad brief, choose a clear hook and two or three purposeful beats before adding decoration. Match duration and pacing to the available source, not a fixed template. Select a short source range containing the complete intended meaning. Source seconds become frames using project fps; keep item duration and source range coherent.

## Tracks, text, and framing

[compose.json](../examples/compose.json) shows an atomic `shorts.apply` with a captured video, styled overlay, and existing music. It is illustrative: replace every source/asset identity with a verified immutable reference. Track IDs must exist; tracks can be added with `{ "kind": "add-track", "track": { "id": "caption-2", "kind": "caption" } }`. Kinds are `visual`, `caption`, or `audio`.

Bundled fonts are `sans-serif`, `Inter`, `Montserrat`, and `Apercu`. Apercu has 400/500/700 weights. Choose these rather than inventing an unbundled font. Text controls include `fontFamily`, `fontSize`, `fontWeight`, `color`, `align`, `shadow`, `shadowBlur`, `shadowOffset`, `strokeWidth`, `strokeColor`, `scrimOpacity`, and `scrimPadding`. Color values are six-digit hex. Keep lines short and contrast strong; size for the portrait output and inspect actual rendered samples. A font-size heuristic alone does not prove readability.

Entrance/exit values are `none`, `fade`, or `slide`, with separate `entranceFrames` and `exitFrames`. At 30 fps, six frames is 0.2 seconds. Avoid competing motion or overlong transitions. `set-properties` accepts a properties object for the item; merge with its current properties when preserving controls not requested for change.

A transform uses all required fields: `x`, `y`, `scaleX`, `scaleY`, `rotation`, and `opacity`; optional `crop` has top/right/bottom/left fractions. Preserve current transform fields when adjusting one dimension. Do not assume portrait crop keeps a subject in frame: verify sampled pixels when available.

## Cuts and transitions

Video items accept `transition: { "type": "crossfade", "durationInFrames": 9 }` or `fade-black`. This describes the **incoming** clip at an exactly adjacent, unambiguous cut on the same track. It does not move clips. Crossfade requires incoming source preroll before its source-in; starting at source time zero can suppress the effect. Duration is capped by both neighboring clips and available preroll. Ambiguous stacked cuts have no transition. Prefer a clean hard cut when there is no appropriate handle.

Choose transitions while inserting clips. There is no `set-transition` operation. To change an existing transition, read the latest item, copy every field, and atomically `remove-item` then `insert-item` with that same ID and modified transition. Preserve speech, source, transform, timing, and linkage fields; check array/layer ordering because insertion places the item later. If that changes intended layering, keep the existing transition and describe the limitation instead of reconstructing unrelated human work.

## Music and narration

Discover `shorts.assets` with a focused search, then `shorts.asset` using its exact `{assetId, versionId, digest}`. Inspect `role`, provenance and usable duration. Music is an existing `audio` item using an immutable asset, `sourceStartMs`, and linear `volume` (0–2). Keep it beneath speech; the example volume 0.12 is a starting choice, not verified loudness normalization. Do not assign `narrationFor` to music. If no suitable music exists, keep the draft unscored and say so; buying/generating music is not the default.

Voice assets must be approved existing/registered presets for the language, with provider, model, settings, and pronunciation reference. Preserve the full preset; do not fabricate approval metadata or create a voice identity by uploading an asset. [speech.json](../examples/speech.json) illustrates `set-speech`; replace voice and provider fields from the selected approved preset. `suppressed: true` means no effective narration. Use `shorts.narrationQuote` after authoring to see the actual effective text and cache plan, and `shorts.narrationStatus` for durable allowance and accepted runs.

`set-text` also updates that item's existing speech text. When overlay and narration intentionally differ, apply `set-text` first, then `set-speech` with the intended spoken text. [feedback.json](../examples/feedback.json) demonstrates this order. Otherwise preserve text, role, language, provider, model, voice identity, settings, and pronunciation: all contribute to reusable narration identity. Do not hand-attach an approximate old recording for changed speech. Ask `shorts.narrate` to attach/reuse canonical audio and re-read the revision it creates.

Narration admission is one multi-item pass, not one pass per segment. Do not issue independent per-item requests. An all-reusable request consumes no pass; one initial pass and one correction persist across revisions and clients. Quote currency values are micros (one million per currency unit); only call a price verified when the returned quote says so. `null`/unavailable pricing and a bookkeeping reservation of zero do not mean free audio. Unknown completion requires same-key reconciliation, not a new paid request.

## Editing and handoff

Supported domain operations include `set-metadata`, `set-text`, `set-properties`, `set-transform`, `set-speech`, `move-item`, `set-timing`, `trim-source`, `insert-item`, `remove-item`, `add-track`, `remove-track`, and `assign-content-packs`. Inspect the actual schema for each. `move-item` sets `trackId` and `startFrame`; `set-timing` requires `durationInFrames` and `timingLocked`. `trim-source` takes source `startMs`/`endMs`. Keep stable item IDs for attribution and targeted feedback. Never send JSON Patch such as `{ "op": "replace", "path": "/title" }`; use `{ "kind": "set-metadata", "title": "Revised title" }`.

`shorts.read` and `shorts.history` expose current state and attributed revisions. History is bounded; use `beforeRevision` to read older evidence when needed. Project discovery uses `nextCursor`. Preserve human edits rather than treating the previous agent draft as authoritative. Revision conflict means reconcile the requested delta with the new state. Exact retries after transport failure keep both the original input and key; a new intended edit gets a new key.

`shorts.renderRequest` takes projectId, current expectedRevision, and idempotencyKey. `renderStatus`, `renderRead`, and `inspect` take projectId and the accepted attemptId. Keep the returned durable review URL with revision/attempt/inputHash; the project review URL alone opens current state and is not historical approval. Capability byte URLs expire in five minutes and should not be persisted or logged. Human render approval and final effective script/voice review happen interactively in Shorts, outside agent authority.

A useful handoff says: “Draft revision N, render A: [returned review link]. Changed X; preserved your Y. Sampled K frames around M cuts; audio statistics only, not listening. One automatic repair used/unused. Remaining limitations Z. Send feedback here or edit in Shorts and return.” Fill this from actual evidence, never from the example wording.
