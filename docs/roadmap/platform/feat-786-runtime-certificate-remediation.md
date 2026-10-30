---
id: "feat-786"
title: "Patch Node runtimes and compromised certificate trust paths"
owner: "tataihono"
priority: "P0"
status: "in-progress"
start_date: "2026-10-23"
duration: 1
depends_on: []
blocks: []
tags:
  - "infrastructure"
  - "security"
---

## Problem

Running Railway services retain Node 24.10.0, 24.15.0, and 24.21.0 despite newer build plans. Shorts Worker runs 22.22.3. The October 21 security release requires 22.23.4 or 24.22.1 and removal of the affected eMudhra/AAA certificate trust paths.

## Entry Points — Read These First

1. `.nvmrc` and `package.json`: shared Railpack and CI runtime selectors.
2. `nixpacks.toml`: Auth and Crop Worker retain Nixpacks; keep FFmpeg and development build dependencies.
3. `apps/shorts-worker/Dockerfile`: all build and serving stages share a digest-pinned Node base.
4. `apps/analytics-watcher/Dockerfile`: Playwright contains an independently packaged Node executable.

## Grep These

`NODE_IMAGE`, `NIXPACKS`, `RAILPACK`, `sslcertificates`, `NODE_EXTRA_CA_CERTS`, `SSL_CERT_FILE`.

## What To Build

Pin patched Node, refresh the Shorts image digest, explicitly install the patched Node distribution in Nixpacks, and remove affected OS roots in Docker/Nixpacks build and serving stores. Preserve Playwright, FFmpeg, production start commands and worker concurrency.

## Constraints

Production changes ship only through PR to main. Auth production dashboard start commands include migrations; staging has no Auth database and must retain its existing start behavior. Never disable TLS verification. A source pin or successful build is not runtime proof.

## Verification

Check formatting, shell syntax, checksum validation and image manifest pins before merging. After rollout, measure every active service replica and its executable, both affected certificate endpoints and a known-good control using each effective client/store. Verify auth sign-in and safe worker paths. Keep this ticket in progress until all application rows and custom trust-store overrides are reconciled in the external remediation tracker.

## Railpack follow-up

Live patched Railpack containers still carried ca-certificates 20250419 and the older OS bundle; Nixpacks hooks do not apply to Railpack. Root `railpack.json` refreshes the build dependency-install and runtime stores using `scripts/update-security-ca.sh`. A dedicated hashed directory prevents inherited PEM links from restoring removed roots. Service-local package engines pin 24.22.1 and make the release visible to existing app-specific watch patterns. Preserve dashboard build/start commands.

## Analytics Watcher OpenSSL directory follow-up

A natural production cron run on October 23 uses Node 24.22.1 and rejects both affected chains. Python still accepts G3 through the default hashed CA directory, although a bundle-only context rejects it. The Playwright image retains a named G3 PEM link after bundle regeneration. Remove the distrusted named links and rehash the default directory, then supply the existing managed-directory pattern to OpenSSL clients. Verify all three stores in the actual Docker image during the analytics-watcher test matrix leg. Preserve the cron, volume, lock, deadline, secrets, analytics probes and notification behavior; never start a real watcher cycle for this test. Keep this ticket in progress for the remaining fleet audit.

The installed Chromium 149 also accepts the G3 chain independently of OpenSSL. A newer Chromium reproduces it; a browser version update alone does not fix this trust path. Chromium's Linux NSS database supports prohibited certificates. Pin the two presented, signed EM DV TLS CA - G3B certificates by DER SHA-256 and import them with `p,p,p` distrust for the image's root and pwuser profiles. Isolated Chromium 149 and 156 reject both affected chains and accept a valid control with that intermediate distrust; the previous root-only experiment did not reject G3. Keep Playwright 1.61.1 and its matching image, pin that image digest, and test the actual image's default Chromium in CI. Public certificate data grants no authority and is never imported as trusted.

## Crop Worker controlled image and native FFmpeg TLS

The configured service already reads `apps/crop-worker/railway.toml`; switch that source configuration to its dedicated Dockerfile through the normal PR/main deployment flow. Pin Node24.22.1 before package downloads, filter OS CAs before pnpm, preserve frozen dependencies and FFmpeg/ffprobe, and keep one replica, health and restart contracts. The absolute compiled start path works with the Docker working directory.

A read-only public probe of the installed FFmpeg7.1.1 accepts both affected endpoints by default. The same binary with `-tls_verify 1` rejects both with explicit peer-certificate verification errors and fetches a valid Google control. Add the shared HTTPS input option to actual probe, both fingerprint passes and render segment reads; preserve local generated-file processing and the existing protocol whitelist. Required actual-image CI exercises Node and the compiled FFmpeg adapter, synthetic local media encode/probe, actual production entrypoint readiness, bearer denials and invalid-job rejection without admission or S3 access. Keep the audit ticket in progress until exact replacement image and all other rows are verified.

FFmpeg 7.1 copies only selected HTTP options into nested HLS reads; `tls_verify` is absent from `ffio_copy_url_options` in the official source. A CLI-only fix would leave playlists, keys and segments exposed. Build the official signed 7.1.5 maintenance source (SHA256 `de668509caf9e35e3cd162473441fdb29538c6d96ed080292b3cf9e6fc5d558f`; verified release signing key `FCF986EA15E6E293A5644F10B4322F04D67658D8`) and change only the native `tls_verify` default from 0 to 1. Retain the 7.1 media contract, GnuTLS with hostname verification, libx264, native codecs and filters. Test both explicit and default TLS, actual nested HLS bad-certificate rejection and local synthetic HLS decoding in the required production image. No live media jobs are authorized by this fixture.

## Retained devotional browser trust follow-up

The actual compiled `apps/shorts-worker` default Remotion engine launches Chromium 149.0.7790.0 and accepts G3, while its Node and OS clients reject it. The installed renderer defaults certificate-error bypass to false; no render job was submitted. Install the same SHA-pinned public intermediate prohibitions in the image's root/node NSS profiles. Preserve renderer/composition versions, fonts, FFmpeg, the baked bundle, transfers, queue and single-replica contract. The existing test matrix now builds and HTTP-drives the actual production image with synthetic configuration: verify default-engine browser TLS, Node TLS, readiness, bearer denial, absent jobs, retired-kind rejection before admission and clean shutdown. Never submit a devotional job or use production storage credentials in this acceptance test. Keep the fleet ticket in progress until remaining audit rows are resolved.

## Watcher default directory regeneration follow-up

After PR2880, the natural source883d97 production cron rejects both chains in Node, Chromium, bundle-only OpenSSL and managed-default OpenSSL. The inherited `/etc/ssl/certs` directory still accepts G3, and its named PEM link points to the packaged `/usr/share/ca-certificates/mozilla/emSign_ECC_Root_CA_-_G3.crt`. The operation that restored the link is not established. Remove the two excluded packaged root files as well as generated named links, rehash the directory, and make actual-image CI regenerate the default directory before repeating all TLS assertions. This extends the existing root exclusion; it does not add trust. Keep the cron, volume, lock, deadline and notification behavior unchanged, and verify a natural run after normal release.

## Roadmap viewer controlled build

Production and stage both select `apps/roadmap/railway.toml` and currently deploy main. Replace the managed package bootstrap with a digest-pinned Node24.22.1 Docker build that filters OS CAs before frozen pnpm9.12.3 dependency downloads. Retain the existing Next production server, port, configured roadmap directory, runtime filesystem data and hidden-lane policy. The image contains the repository roadmap and the unchanged watch-url-policy workspace. Exclude environment files and local build artifacts. Actual-image CI must exercise Node/OpenSSL trust, production home/dashboard/ticket and Markdown routes, unknown-ticket denial and the real static asset. No database, identity, provider or mutation fixture is needed by this read-only viewer. Keep the fleet ticket in progress until exact normal-release verification.

## Watcher inherited-file replacement follow-up

Exact normal source7df038d image5860768a has the correct updated helper SHA256 `f843935b4dd0845762ed88de7df564c5f87706d29133faf4d379147f2fee8e8b`, but the old G3 packaged certificate and aliases remain. `/proc/1/root` and matching mount namespace prove the serving process sees the same files. Node, Chromium, bundle/managed OpenSSL, Google JWT transport, npm and pnpm controls pass; the inherited default directory accepts G3. The restoring operation is not established. Overwrite both excluded packaged certificates with explicit non-X.509 markers, so inherited aliases cannot recover trust even if deletion does not hold. Preserve root exclusion, filtered bundle, managed directory and prohibited browser intermediates. Actual-image CI asserts marker content is not an X.509 certificate before/after CA regeneration and repeats all TLS controls. No runtime package install, real watcher cycle, cron, volume, notification or analytics behavior changes. Exact naturally scheduled source release remains required.

## Roadmap browser verification follow-up

The controlled UTC image exposes a pre-existing planned-calendar hydration mismatch for browsers east of UTC. Local midnight dates converted with `toISOString()` move the first planned week from April 28 to April 27 in Auckland; adding days across a DST transition also changes phase end labels. Treat these fixed calendar dates as UTC for construction, arithmetic and formatting. Keep the client-only Today indicator local and unchanged. A regression renders the actual timeline in UTC, Auckland and Los Angeles and compares both the first ISO date and full server markup; run it in the controlled image before the normal Next build. Verify the public dashboard hydrates without errors and record load timings after the normal release.

## RAG controlled build

Replace the bound RAG Railpack build with `apps/rag/Dockerfile`: pinned Node24.22.1, filtered OS bundle and directory before pnpm/Prisma downloads, frozen filtered workspace dependencies, generated Prisma client and the existing serving/pre-deploy commands. No corpus acquisition, indexing or provider requests are part of image acceptance. CI uses an isolated internal Docker network and disposable PostgreSQL to exercise migrations, portal role grants, the actual production command and anonymous access denials. Keep the audit open until the exact normally released image and its application transports are measured.

## Auth controlled image and stage prerequisite

Build Auth and watch-url-policy from frozen filtered dependencies on pinned Node24.22.1, filtering OS trust before package and Prisma downloads. Preserve the Next standalone output and source-bound stage's no-migration command; Docker uses a direct Node command and HOSTNAME environment. Production's dashboard remains canonical until a separate reviewed binding decision. Actual image acceptance must cover native/OS/Firebase transport trust, disposable PostgreSQL migrations/seed and cold startup with an unavailable public issuer, readiness, discovery, anonymous sessions and frame denial headers.

Stage currently has no DATABASE_URL and still serves an older image whose health route unconditionally returns ok. Current main readiness initializes Auth and requires a database; its stage release is failing health checks. Do not weaken readiness, copy production data/secrets or add stage startup migrations. Isolated stage database/identity provisioning or a supported retirement/restore remains an owner decision before stage can be accepted.

## Chat controlled image

A10 replaces source-bound Railpack with a pinned Node Docker image and filters OS trust before pnpm installation. It preserves non-standalone Next startup, existing auth/history/Seeker gates, healthcheck and default-off behavior. Actual-image CI checks public transport controls and network-disabled startup/HTML/assets/access denials, including HTTP500 readiness under invalid production egress configuration. Closure still requires green CI, normal source release and current-replica verification.

### Mastra Gateway controlled image

D13's pinned Docker proposal filters trust before any package download and
preserves Prisma migration, standalone startup, static assets, health and identity
boundaries. Actual-image CI uses disposable PostgreSQL, runtime-only synthetic
keys, anonymous/invalid-cookie gates and a read-only admin API lookup. Production
is dashboard canonical: source merge alone does not establish a deployment;
separate owner approval and exact live verification remain required. No role,
identity, proxy, schema or provider behavior changes.

## Admin web and worker controlled images

Replace the two source-bound managed builds with pinned Node Docker and pre-install CA filtering. Retain existing Next/Workflow builds, worker authority unsets, tracing/version settings, Redis/GraphQL readiness and migrations. Preserve PostgreSQL18 native backup tools using checksum-pinned18.6 client-only build; no database server version changes. Existing Datadog sourcemap upload moves before migrations in pre-deploy so the upload key stays outside Docker build layers. Preserve browser-visible RUM build configuration. Actual-image CI uses isolated disposable PostgreSQL/Redis for migrations, native schema dump/list and actual web/worker startup/access denials; no real provider, publication or push action. Stage dashboard binding remains separate.

### Manager controlled image

B05's image proposal filters trust before package downloads, retains standalone
assets/workflow startup and all six workspace dependencies, and supplies native
FFmpeg 7.1.5 TLS verification with MP3 audio cleanup support. Acceptance includes
public direct/nested HLS trust and local generated media plus network-disabled
production startup and access gates. Dashboard canonical production still needs
separate binding approval and exact live verification; explicit Studio proof
artifacts, identity, content and provider actions remain outside this change.

### Mastra controlled image

B06's proposed Docker image filters package trust first and preserves Studio,
PostgreSQL/DuckDB, all five workspace dependencies and the existing private-only
network boundary. Actual-image CI uses isolated PostgreSQL for production boot,
metadata/static reads, deterministic smoke and service/lane/default-off denials;
no model or workflow execution. Dashboard binding and exact current-image
verification remain separate owner decisions. Native framework routes retain
existing gateway/network containment; the proposal adds no public exposure.

## Brotli decoder follow-up (CVE-2026-111497)

Node22.23.4/24.22.1 already include the bundled decoder fix, but the current Crop and retained devotional worker images carry separate system `libbrotli1=1.0.9-2+b6`. Explicitly install and require Debian bookworm security revision `1.0.9-2+deb12u1` or newer in both runtime bases. Preserve media/browser versions, queue, authentication, storage and process contracts. Required actual-image acceptance checks the distro security revision as well as existing TLS/media/browser/HTTP tests; exact replacement replicas need fresh package/runtime and serving proof. Static/browser Brotli copies require their own vendor provenance and are not established by the Debian check. Keep this fleet ticket in progress for remaining owner-blocked targets.

## Database and search CA-only maintenance

`infra/security-ca/images.json` maps seven digest-pinned vendor images to dedicated
Docker contexts. Each context refreshes only certificate trust, retains the vendor
server and entrypoint, and installs non-PEM distrust markers plus a managed CA
directory. `.github/workflows/infrastructure-ca-images.yml` compares original
runtime configuration and binary hashes, exercises bundle/default-directory/managed-directory
TLS controls, and starts the unchanged server against empty isolated storage.

The approved maintenance covers 25 PostgreSQL services and one Typesense service.
Release through reviewed main source, retain each service's matching vendor base,
volume, variables, startup and networking, and verify recovery snapshots before
restarting one service at a time. Exact live binary, trust and health readback
remains required; image CI alone does not close these rows. No database upgrade,
restore, indexing, import or model invocation is part of this work.

## Managed Node image legacy-directory hardening

The final Railway JFOF source release proves the managed-builder correction: install libatomic1 before the last CA cleanup, suppress duplicate step outputs and later deploy apt layers, and replace the two excluded root payloads with non-PEM distrust markers. Apply the same two-file config/helper to the root Node Railpack path so surviving lower-layer aliases cannot restore trust. Keep real Web content builds and dashboard commands; no private build credential moves. Independently verify every Web replica after the normal PR-to-main release. Keep this ticket in progress for remaining audit rows.

## Mastra startup attestation without SSH

Railway SSH/SFTP closes before inspection. Add a final-image NODE_OPTIONS preload
that runs in the serving process before application imports and emits a sanitized
`mastra_runtime_security` record with deployment/replica/source identity, executable
SHA256, patched release/decoder marker, benign roundtrip and twelve independent
Node/OpenSSL trust controls. Timeout or connectivity failure is not certificate
rejection. Fail startup on any unsuccessful check; preserve the existing command,
PostgreSQL/DuckDB, single replica, private networking and flags. Actual-image CI
must prove the serving PID and block application startup under disabled TLS.
Normal PR-to-main release and exact live log/health evidence remain required.
See `docs/plans/2026-10-27-mastra-startup-security-attestation.md`. Keep this fleet
ticket in progress for the remaining external audit rows.
