# Full local qualification infrastructure

This harness exercises the actual Next MCP lifecycle, canonical Admin services and
Postgres, actual local asset byte transfer, and the contained rendering service.
It is not proof of a real client's behavior, production OAuth consent, genuine
speech quality, authenticated browser approval, or an OCI deployment.

## Boundaries

- Only `postgresql://tataihono@127.0.0.1:55460/forge_studio_548_qualification`
  is accepted. Apply the repository's unchanged migrations through 0102 first.
  This separate database is necessary because the real render dispatcher scans
  all pending work. Never point this harness at a regression/shared database.
- Ports 55480, 55482, 55483, 55484 serve the synthetic JWKS issuer, real Admin route
  handlers, actual Next Manager, and actual execution service, respectively.
- Every launch requires a **new** absolute output directory outside the checkout
  whose parent already exists. Directories are0700; tokens/configuration/audits
  are private. Existing directories and checkout-resolving symlinks are rejected.
- No cookie creation, synthetic browser sign-in, or authentication bypass route
  exists. The browser qualification restriction remains in force.
- Next and Admin inherit `guard.mjs` through `NODE_OPTIONS` before application
  imports and worker creation. It blocks unregistered external fetches and
  non-loopback TCP/Unix socket connections. Exact source/HLS URLs and the single
  fixture voice POST return local bytes. Voice creation and music-generation
  requests have no fixture and fail closed. No real provider key is loaded.
- A 15-second 1080×1920 synthetic test pattern supplies canonical catalog footage,
  matching HLS preview/export renditions and subtitles. Existing voice and music
  assets are explicitly fixture registrations. Fake narration is a 3-second sine
  tone, not generated speech. Its zero character-cost header is **fixture data**,
  not a price estimate or evidence that narration is free.
- The actual `createExecutionService` handles signed render admissions, leases,
  cgroup checks, native isolation, MP4 rendering, and independent codec proofs.
  The launcher enforces 2 GiB RAM, zero swap, 2 CPUs and 128 tasks. It uses cached
  runtime paths; it does not exercise image PID1/sealed-startup/tmpfs admission.

## Run

Build native binaries with `pnpm --filter @forge/studio-render build:native`.
Set `STUDIO_TEST_DATABASE_URL` to the exact isolated URL above,
`STUDIO_QUALIFICATION_CODEC` to the cached directory containing FFmpeg/FFprobe,
and `STUDIO_QUALIFICATION_BROWSER` to the cached contained Chrome directory.
Then run:

```sh
node scripts/studio-agent-local/full.mjs /absolute/private/new-run-directory
```

The renderer's `/health` must report the configured budget and `healthy:true`.
Wait for Admin 55482 and Next 55483 readiness before running:

```sh
node scripts/studio-agent-local/smoke.mjs /absolute/private/new-run-directory
node --test scripts/studio-agent-local/guard.test.mjs
```

The smoke uses actual HTTP MCP calls for discovery/capture/create/narration,
waits for Next `after()` to attach a revision, then renders canonical HLS footage
and inspects the exact output. This programmed tool trace is infrastructure
verification only. Stop the launcher with SIGINT; it stops its child groups.

## Real-client handoff

After feat-547 packaging checks pass, extract its shipped zip outside the checkout.
Use `run-codex.mjs` with this private directory: it selects the full local MCP
surface for this exact configuration and otherwise retains the earlier feat-542 tool
allowlist. The client runs from `client-workspace` outside the repository. Point
the prompt at the extracted portable skill and provide a realistic broad brief;
do not replace the skill with a prescribed tool trace or patch up domain commands
in the prompt. Resume the returned client session for feedback/disconnect checks.

Keep transcripts and transfer URLs private; publish only redacted observations.
Record real-client/version/modality evidence separately from this smoke. Timing
must separate render completion, inspection preparation, client interpretation,
handoff, and any single repair. Claude and authenticated human approval remain
unqualified until their respective access is available.
