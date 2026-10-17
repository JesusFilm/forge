# Studio colleague feedback (feat-607)

Scope: Admin canonical sources, portable Studio contracts, the shared video
renderer, Manager authoring and MCP diagnostics, and Mastra instruction reads.

Use explicit `null` for absent subtitle identity and metadata. Keep old populated
snapshots valid and their catalog digests unchanged. Add a nullable database FK;
never create fake tracks, transcripts, or replacement URLs. Subtitle previews of
subtitle-free snapshots return explicit absence with zero cues.

Focus belongs inside the video's cover-fitted source through `object-position`;
item transforms and existing canvas crop retain their meaning. Default focus is
50%/50%, with bounded controls available to both UI and MCP authoring.

Hosted instruction reads retain signed caller/scope checks and native storage.
Hosted generation, instruction mutation and calendar dispatch keep their current
enablement gates. Expected service failures get bounded public errors; unknown
failures retain generic messages.

Reproduce with focused tests before changes. Validate migration/retention, existing
captioned flows, UI controls and preview/export parity. Production reproduction
requires the colleague's URL, skill and exact call arguments; local evidence cannot
claim that the two LUMO entries are available in the production catalog.
