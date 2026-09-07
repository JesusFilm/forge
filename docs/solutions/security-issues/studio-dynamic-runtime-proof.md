---
module: Studio runtime
problem_type: security_issue
tags: [studio, remotion, sandbox, media, performance]
date: 2026-09-07
---

# Dynamic Studio runtime: local proof and deployment decision

## Decision and scope

Use a **separate credential-free execution service**, with a trusted asset broker
outside its execution boundary. Keep the existing authenticated Shorts worker out
of generated-code evaluation. Build the host once; supply bounded TSX, editable
properties and versioned source identity as data. This is a feasibility contract,
not Admin's future canonical Studio project model or a full NLE.

The local Linux proof uses Bubblewrap namespaces plus a transient systemd user
service with aggregate cgroup limits. It has no production route, database writes,
provider calls, paid generation, publication or deployment. No licensed Editor
Starter source was supplied; the text/color form and persistence interactions are
independently authored, using the public Remotion Player.

## Portable contract and ownership

- `@forge/shorts-compositions/studio-proof/manifest` exports `StudioManifest`,
  `manifestSchema`, `parseManifest`, `RUNTIME_VERSION`, `StudioProofError`,
  `sourceTimeMs`, and `subtitlesAt`. This entry is React-free and has only Zod as a
  runtime dependency. Its exact file is
  `packages/shorts-compositions/src/studio-proof/manifest.ts`.
- `@forge/shorts-compositions/studio-proof/example` exports the explicitly
  synthetic fixture. `@forge/shorts-compositions/studio-proof/entry` is the
  **browser-only** fixed bundle entry, never an Admin/server import.
- `apps/shorts-worker/src/studio-proof/broker.ts` supplies `verifyBrokerInput`,
  `contentIdentity`, and `sha256`. It verifies selected catalog identity, subtitle
  bytes/cues, the playlist and ordered segment inventory, byte limits and digests.
- feat-454 should normalize these shapes into `packages/studio-contracts`; avoid
  coupling Admin to the composition package root or worker implementation.

The runtime identity pins Remotion/Player **4.0.475**, React **19.2.4**, Sucrase
**3.35.1**, and hls.js **1.6.16**. Content identity includes TSX, component version,
controls, property values, dimensions, duration, exact video/dub/edition/language,
subtitle track and byte digest, trim, preview playlist and segment digests, and
export-media digest. A new visual can use the same host bundle without a deployment.

Proof bounds: one source, 30 fps, at most 300 frames, 1920 pixels per dimension,
32 Ki TSX characters, 16 text/color controls, 32 HLS segments, 64 MiB media budgets,
and 1 MiB subtitle track. These are feasibility bounds, not product duration limits.
Imports resolve through a closed injected React/Remotion surface. This limits
compatibility; it is **not** a security sandbox. Generated code still has browser
globals, so execution containment is mandatory.

## What is contained locally

The execution child receives only the job directory, read-only dependency tree,
Chromium and system runtime/fonts. It has private PID, network, IPC, UTS and mount
namespaces, an empty environment apart from HOME/PATH/PWD, and no application home,
repository source, object-store/provider credentials or outbound network. Trusted
code serves exactly the staged export MP4 on its own namespace's loopback socket.
Remotion's internal local services are inside the same namespace.

Cgroup limits cover the process tree: 2 GiB memory, no swap, 128 tasks, two CPU
cores of quota, and a 60-second service lifetime. Per-process CPU, descriptor and
output-file limits are additional controls. The parent retains at most 65,536
output bytes and starts at most one termination request. Timeouts kill the service
cgroup, including Chromium descendants; `RuntimeMaxSec` remains the independent
backstop. A real 1080p attempt at **1 GiB** hit the kernel OOM limit, killed the
execution group, and left the coordinator healthy. Raising the bounded budget to
2 GiB allowed the same source to render (observed peak approximately 1.1 GiB).

The preview is served in an iframe with `sandbox="allow-scripts"`, no same-origin,
forms, popups or top-navigation grants, and `referrerpolicy="no-referrer"`. Its
CSP denies external network, frames, base URLs and forms; it permits only its
fixed scripts, inline styles, evaluation for compiled code, and the trusted media
path. Responses use `nosniff` and `Origin-Agent-Cluster: ?1`.

**Cross-site process isolation matters independently of the opaque origin.**
Headless Shell without forced site isolation let infinite component work starve
the parent's watchdog. `--site-per-process` was diagnostic only. The acceptance
run uses installed **Google Chrome 152.0.7977.64**, no special site-isolation flag,
with parent `localhost` and iframe `127.0.0.1`. The parent removes the infinite-work
iframe after its own 1.5-second deadline. Storage, parent DOM and forbidden network
access are separately exercised in the actual iframe.

For deployment, host preview on a distinct **registrable site**, such as the
execution service's assigned Railway hostname, rather than another
`jesusfilm.org` subdomain or `srcdoc`. Keep that site free of authentication
cookies and credentials. This proof establishes desktop Chrome behavior; Safari,
Firefox, mobile browsers and browsers with disabled site isolation are not verified.
A browser iframe is not an aggregate memory quota for an operator's desktop.

## Real Forge source and timing

Public read-only Admin GraphQL at `https://admin.jesusfilm.org/api/graphql` resolved:

- Video `cmp76xcw602imny01vnsbwwy9` (JESUS).
- English dub `3d6bf563-ef8a-4b73-ba1b-41adeff07a81`.
- Edition `cmp71zmk2076lo001oo2174vh`.
- Primary, non-AI English subtitle `1a1c8171-c89e-4f91-9e26-86fc1fe7125e`.

Returned language, parent video, published locale/dub and Watch restrictions are
checked. The canonical VTT comes from that edition's catalog track, never Mux's
independently generated subtitle entry and never Whisper. Wrong language/edition,
missing track, changed bytes or unsupported selected-range markup fail closed.

The broker explicitly selects the **480x270** rendition of the dub's library HLS
master, stages the first 35 seconds of its original MPEG-TS segments and rewrites
only the local playlist paths. This is fixed low-resolution preview, not a claim
of automatic adaptive playback. Export uses the same dub's **1920x1080** HLS
rendition, with a local 32-second MP4 prefix remuxed to source time zero. The full
5.5 GB MP4 download alternative did not complete within a bounded attempt; no
whole-film download or alternate dub was substituted.

The composition selects **[28,600 ms, 30,600 ms)**. Frame 0 maps to 28.600 seconds,
frame 24 to 29.400, frame 25 to 29.433, and frame 45 to 30.100. The first canonical
cue ends at 29.430 seconds, followed by a silent subtitle gap until 29.500. Preview
and export share `subtitlesAt`; the real rendered frame 24 includes the first cue,
frame 25 has no subtitle, and frame 45 has the next cue. Exported MP4 frames were
also extracted and visually inspected, not merely the separate PNG renders.

An unobscured 70x30 pixel crop of decoded export frame 0 compared with the exact
source MP4 at 28.6 seconds measured **36.56 dB PSNR** after 320x180 scaling. The low
preview is intentionally a different rendition and has Player controls over it;
it is not asserted pixel-identical. Source time is additionally checked against
the video's decoded-frame callback after seeking.

## Reproduce

Requirements: Linux, working user systemd/cgroup v2 CPU/memory/pids delegation,
Bubblewrap/user namespaces, ffmpeg, ordinary Google Chrome, and internet for the
public Forge fixture. The example host used Node 24.20.0 and ffmpeg 7.0.2. The
renderer installs its pinned Headless Shell through `ensureBrowser` before entering
the isolated job. No environment file is loaded by either proof command.

```bash
pnpm install --frozen-lockfile --filter @forge/shorts-worker...
pnpm --filter @forge/shorts-worker studio:proof /tmp/forge-studio-proof /path/to/ffmpeg /usr/bin/google-chrome
pnpm --filter @forge/shorts-worker exec tsx scripts/studio-proof/forge.ts /tmp/forge-studio-real /tmp/forge-studio-proof/bundle /path/to/ffmpeg /usr/bin/google-chrome
```

Run those sequentially: the first builds the fixed host; the second reuses it.
Both write `report.json`, input manifests, MP4s and PNGs into their explicit output
directory. The synthetic command also renders the saved/reloaded text/color edit
under `edited/`. Outputs are local verification artifacts, not committed media.
The real script admits a small exact set of observed CDN hosts; if Mux changes its
CDN routing it fails closed and requires reviewing that allowlist.

## Release prerequisites and limits

These remain implementation and release responsibilities, not a requirement to
publish this proof to production. **feat-456** owns distinct-site browser preview
integration and its media broker. **feat-460** owns the production render
execution-service launcher and trusted attempt/asset/result broker needed for
export/publication. **feat-462** verifies deployed containment and cutover:

1. Demonstrate equivalent execution-service mounts, private network, process-tree
   limits/kill behavior, non-secret environment, read-only inputs and bounded
   output storage under the actual container platform. Bubblewrap/systemd are the
   local proof mechanism; feat-460 must implement the production launcher.
2. Provide an authenticated trusted broker that authorizes canonical asset
   identities, stages bounded/digest-checked media and accepts only attempt-bound
   results. feat-460 must implement this render broker, while feat-456 implements
   the preview broker. The public catalog script is not either production adapter. Recheck
   source eligibility at publication through the product command layer.
3. Provision the distinct preview site, apply response headers and restrictive
   media paths, and repeat the browser probes from the deployed authenticated
   Manager page. Do not broaden browser support on the basis of this Chrome run.
4. Establish production workload/load budgets. This proof renders a two-second,
   320x180 output from 1080p source; it does not benchmark 1080x1920, long projects,
   concurrent authors, mobile UI or public-internet preview latency. Measured
   preview serves already-staged real HLS segments from loopback, with no network
   throttling. Broker download time is separate from preview startup.

No existing Manager route imports this proof, and no app rendering/hydration path
changed. Its compiler and media do not enter the Manager list/calendar bundle.
The existing Shorts/Whisper production flow and the other task's baseline recovery
remain untouched.

## Primary API sources

Checked 2026-09-07 against the exact installed versions:

- [Remotion dynamic compilation](https://www.remotion.dev/docs/ai/dynamic-compilation)
  describes injected dependencies and explicitly leaves sandbox/CSP to callers.
- [renderMedia](https://www.remotion.dev/docs/renderer/render-media) and
  [openBrowser](https://www.remotion.dev/docs/renderer/open-browser) document fixed
  bundles/input props and Chromium execution. Installed 4.0.475 requires a minimum
  7,000 ms per-frame timeout; the independent outer deadline bounds infinite code.
- [Html5Video](https://www.remotion.dev/docs/html5-video) provides frame-based trims;
  the fixed host uses hls.js for preview and `OffthreadVideo` for export.

## Review

The code-review skill ran separate Standards and Spec agents. Standards identified
stream-reader cancellation on overflow and script configuration reads; both were
fixed (reader cancellation/finally and CLI tool paths). Spec identified missing
HLS segment identity and missing export of reloaded edits; both were fixed and
verified. The coordinating review found the output-flood termination race; the
collector now has a hard buffer cap and one termination request, with a real
flooding-process rejection probe.

## Final measured run

Single local runs on 2026-09-07, with already-staged media and no throttling.
`previewMs` includes waiting for usable decoded media and capturing its screenshot;
byte totals cover the whole preview test including seek and reload, not only the
first request. These are measurements, not production latency promises.

| Measurement                                 |    Synthetic source |      Exact Forge source |
| ------------------------------------------- | ------------------: | ----------------------: |
| Fixed host build                            |            1,950 ms | Reused unchanged bundle |
| Chrome iframe ready                         |              745 ms |                  908 ms |
| Cold preview + capture                      |            1,594 ms |                1,848 ms |
| Reloaded edit ready                         |              591 ms |                  535 ms |
| Seek to frame 45, decoded presentation      |               67 ms |                   44 ms |
| Requested / presented source time           |     2.500 / 2.488 s |       30.100 / 30.073 s |
| Chromium export                             |            6,207 ms |               13,598 ms |
| Actual decoded MP4                          | 60 frames / 2.000 s |     60 frames / 2.000 s |
| MP4 bytes                                   |             318,998 |                 345,519 |
| Preview test bytes served, including reload |           8,081,328 |               9,368,700 |
| Parent removes infinite iframe              |            1,509 ms |                1,510 ms |

The reloaded synthetic edit separately exported in **6,249 ms**, decoded to 60
frames / 2.000 s, and produced **296,102 bytes**. Its rendered PNG was visually
checked for the changed red text. The same host bundle handled all designs.

Failure probes: compile **3,502 ms**, forbidden `node:fs` import **3,644 ms**,
explicit throw **3,647 ms**, infinite render **5,152 ms**, and output flood
**100 ms**. The OS probe denied host-home access, metadata-service/public-network
requests and inheritance of an explicitly set non-secret parent sentinel. Only
HOME/PATH/PWD were present in successful execution children. Browser probes denied
parent DOM, storage and external fetch. The real source broker transferred
**26,209,305 bytes** total across catalog, VTT, playlists and source segments.

Final identities:

- Synthetic manifest: `cc90339deeef996abe04975e5f4c4825cbf63f9671293e49101d53cf4f35f695`.
- Forge manifest: `5ec265b31c72c83a2872b3e51a233280969e6d3cbd916271f935e32f7e729779`.
- Forge MP4 SHA-256: `1964f9ffbfafb522bf3bb402c9293d3fdaf3c5c9a4b2067362d051d1f66c4518`.

Static validation is separate: all **177 worker tests (19 files)** and **69
composition tests (9 files)** passed, along with both package typechecks/lints,
the worker TypeScript build, and the actual fixed-host Webpack build exercised by
the runtime command. No real production worker HTTP/container smoke was run:
this proof intentionally adds no authenticated worker endpoint, and production
launcher/broker/container integration remains a release prerequisite.

Review follow-up: the Standards agent reported zero remaining findings; the Spec
agent confirmed both prior findings resolved and reported no new material findings.
Neither reviewer independently reran the runtime measurements.
