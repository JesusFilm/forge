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

## Watcher default directory regeneration follow-up

After PR2880, the natural source883d97 production cron rejects both chains in Node, Chromium, bundle-only OpenSSL and managed-default OpenSSL. The inherited `/etc/ssl/certs` directory still accepts G3, and its named PEM link points to the packaged `/usr/share/ca-certificates/mozilla/emSign_ECC_Root_CA_-_G3.crt`. The operation that restored the link is not established. Remove the two excluded packaged root files as well as generated named links, rehash the directory, and make actual-image CI regenerate the default directory before repeating all TLS assertions. This extends the existing root exclusion; it does not add trust. Keep the cron, volume, lock, deadline and notification behavior unchanged, and verify a natural run after normal release.
