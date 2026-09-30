# Exact rendered-output inspection validation

The inspection path returns actual JPEG samples from the same digest-verified MP4
that exact-render human review receives. It never substitutes source subtitles,
composition metadata, or successful rendering for visual inspection. No paid
providers, deployment or publication were used.

## Actual contained output

`contained-fixtures.mjs` rendered these fixtures through the existing native
Studio child under enforced systemd-user limits: 2 GiB memory, zero swap, two CPU
quota, 128 tasks. Namespace admission separately passed private PID1/network,
loopback only and zero child capabilities. The worker composition renderer was
Remotion 4.0.475; codec identities and exact output SHA-256 are in `results.json`.
Each fixture used a fresh output directory/process but warm local binaries and
bundle cache, local retained media, no network/CPU throttling and 320×180 at 30 fps.
These small synthetic fixtures are not production-resolution performance proof.

| Fixture               | Duration | Cuts |    Render | Evidence preparation | Samples | Result                                                      |
| --------------------- | -------: | ---: | --------: | -------------------: | ------: | ----------------------------------------------------------- |
| Clean                 |      4 s |    1 |  9,162 ms |               582 ms |       6 | No measured/heuristic warning                               |
| Authored gap          |      4 s |    2 |  8,320 ms |               560 ms |       8 | Authored uncovered interval, not an output defect assertion |
| Overflowing text      |      4 s |    1 |  8,493 ms |               515 ms |       6 | Potential overflow; actual JPEG visibly clips glyphs        |
| Black cut             |      4 s |    1 |  8,369 ms |               430 ms |       6 | Dark sampled pixels despite active authored image           |
| Silent expected audio |      4 s |    1 |  8,187 ms |               514 ms |       6 | Decoded near-silence despite audible timeline media         |
| Representative short  |     30 s |    1 | 48,637 ms |               459 ms |       6 | No measured/heuristic warning                               |

The representative output became ready after its 48.637-second render. Server
sample/measurement preparation then took 459 ms. Client reasoning time and repair
render time are **not measured** (`null` in results); no complete sub-minute
real-client inspection claim follows from these server-only figures. Root
qualification must record actual MCP request timing and client reasoning
separately. Runtime responses expose original output-ready, preparation-start and
evidence-ready timestamps, preparation duration and current server-request duration.

Private raw MP4s/JPEGs/evidence are under
`/home/tataihono/.local/share/forge/shorts-agent-workflow/inspection-545-fixtures`
and `inspection-545-representative`. They contain deterministic synthetic media.
Reproduce from the repository root after installing dependencies/building native
helpers:

```bash
STUDIO_INSPECTION_FIXTURE_DIR=/absolute/private/output \
STUDIO_CODEC_DIR=/absolute/provisioned/codec \
STUDIO_INSPECTION_BROWSER=/absolute/provisioned/browser \
systemd-run --user --scope \
  -p MemoryMax=2G -p MemorySwapMax=0 -p CPUQuota=200% -p TasksMax=128 \
  node --import tsx docs/validation/studio-545/contained-fixtures.mjs
```

Optional `STUDIO_INSPECTION_FIXTURE_NAMES=representative-30s` runs only that fixture.
This deliberately uses configured local immutable assets; it does not contact a
production renderer or provider.

## Boundaries and limitations

The existing root `nixpacks.toml` already provisions FFmpeg (including FFprobe)
for Manager. Defaults use those PATH binaries; optional `STUDIO_FFMPEG_PATH` and
`STUDIO_FFPROBE_PATH` select explicit local/provisioned binaries. Their observed
versions are recorded with each report. Missing executables return unsupported
inspection rather than claiming media was inspected. No new deployment action
was required or performed.

- Maximum 12 images, 24 KiB JPEG each, 320-pixel maximum dimension, and 450,000-byte
  whole report. Representative timestamps plus up to four spread cut pairs are
  sampled; unselected cuts and transient glitches can be missed. Lower-priority
  findings are explicitly omitted if the report reaches its byte cap.
- The composition has no explicit intentional-gap marker. Reports distinguish
  authored uncovered intervals from black pixels under active authored coverage,
  and require author confirmation of intent. Dark scenes, fades and sparse text
  can produce false positives. Text size/overflow warnings are rough timeline
  estimates; no OCR or exact glyph layout claim is made.
- Audio decodes at most the first 60 seconds to mono 8 kHz. Silence and repeated
  near-full-scale samples are measurements, not listening, pronunciation,
  intelligibility or true-peak/loudness compliance. Downmixing can miss defects.
- Context reads are bounded at five seconds each; capability issuance, byte
  acquisition and extraction share a 45-second preparation deadline. Final
  persistence has five seconds separately. Missing binaries or interrupted
  extraction return unsupported/incomplete coverage; failed evidence is not
  cached so explicit recovery does not require rerendering.
- Successful evidence is immutable, keyed by exact attempt and evidence version,
  with output identity checked against the canonical completed manifest. One
  extraction per Manager process; concurrent same-key requests share it. Separate
  replicas may prepare concurrently; database first-writer selection preserves
  one immutable report. No new queue or wakeup exists.
- FFmpeg receives only a private local, hash-checked completed MP4 with network
  protocols disabled, one thread, bounded stdout/stderr and a kill deadline.
  Its environment excludes server credentials. This is media decoding, never
  generated composition execution.
- Context authorization is repeated after extraction. A later human edit marks
  the old evidence stale without deleting it. Only the server render capability
  can save evidence; neither MCP nor an interactive human payload can forge it.
  Reports cannot approve, publish, or alter a revision.

## Repository checks

Manager tests cover actual MP4 decode, clean versus black-cut/silent output,
missing binary/digest rejection, cache recovery, immutable-image MCP delivery,
hung context/capability deadlines and total-report bounds. Admin DB tests cover
trusted write authority, wrong-output rejection, immutable cache, stale human
revision history, transfer renewal and existing render-lease regressions. The DB
fixture's fake MP4/JPEG tests transport authority only, not codecs.

No editor initialization or UI code changed in this slice. Inspection only runs
on explicit MCP/interactive action; feat-546 owns lazy UI integration and measured
page-loading evidence. No Pothos field changed, so SDL/introspection regeneration
was not required. Prisma generation/formatting accompany migration 0102.

Final focused checks: 16 Manager tests passed; 10 Admin database tests passed;
43 portable-contract tests passed. Admin and Manager typechecks, Prisma generation,
Prisma formatting, touched-scope ESLint and Markdown/TypeScript Prettier checks
passed. Independent review identified deadline propagation and whole-report byte
budget edge cases; both were corrected with focused regressions before delivery.
