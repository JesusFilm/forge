# Reuse admitted remux files

Scope: feat-724, the trusted worker and its pinned SDK patch. The full project
currently creates 247.2MB of admitted remuxes, then the SDK downloads those local
HTTP sources into another tmpfs directory. Seven observed copies already total
93.5MB and match original bytes exactly. Avoid that complete second allocation
rather than increasing memory or deleting files still needed for audio.

The existing composition `mediaUrls` override can carry exact generated remux
file URLs. The pinned SDK currently rejects file URLs before native extraction;
add a paired codec/streaming opt-in branch to its shared asset resolver. Match
only `/tmp/studio-source-N.mp4`, require a regular existing non-symlink file,
preserve cancellation and native audio analysis, and return its pathname.
Browser image assets keep their existing HTTP URLs. No arbitrary authored local
URL becomes valid, and SDK consumers outside the paired worker policy retain
their current behavior.

Avoid a pre-seeded download-map workaround: SDK stage transitions clear entries
and public renderMedia discards a supplied server option. Exercise the actual
installed CJS/ESM download branches, native proxy/frame extraction and audio
analysis, child URL mapping, denied paths, cleanup and cancellation. Keep physical
limits, source ranges, complete frames/audio and independent verification.

Merge normally after focused checks and review, publish exact main immutable
artifacts, and select through the trusted inactive host rollout. Preserve the
current attempt's canonical outcome. Full acceptance requires a fresh complete
render with independent codec proof and verified retained bytes.
