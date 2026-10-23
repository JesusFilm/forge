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
3. `railpack.json` and `scripts/update-security-ca.sh`: dependency-install and serving trust stores.
4. `apps/agentic/package.json`, `apps/manager/package.json`, and `apps/web/package.json`: staging service runtime selectors and watch triggers.

## Grep These

`NODE_IMAGE`, `NIXPACKS`, `RAILPACK`, `sslcertificates`, `NODE_EXTRA_CA_CERTS`, `SSL_CERT_FILE`.

## What To Build

Backport the patched Node selectors and Railpack/Nixpacks trust-store setup to the existing stage branch. Preserve staging application code, FFmpeg, start commands and worker concurrency. Production Docker changes are tracked separately on main.

## Constraints

Production changes ship only through PR to main. This backport targets stage for services configured to follow that branch; services following main remain on the production release path. Auth production dashboard start commands include migrations; staging has no Auth database and must retain its existing start behavior. Never disable TLS verification. A source pin or successful build is not runtime proof.

## Verification

Check formatting, shell syntax, checksum validation and image manifest pins before merging. After rollout, measure every active service replica and its executable, both affected certificate endpoints and a known-good control using each effective client/store. Verify auth sign-in and safe worker paths. Keep this ticket in progress until all application rows and custom trust-store overrides are reconciled in the external remediation tracker.

## Railpack follow-up

Live patched Railpack containers still carried ca-certificates 20250419 and the older OS bundle; Nixpacks hooks do not apply to Railpack. Root `railpack.json` refreshes the build dependency-install and runtime stores using `scripts/update-security-ca.sh`. A dedicated hashed directory prevents inherited PEM links from restoring removed roots. Service-local package engines pin 24.22.1 and make the release visible to existing app-specific watch patterns. Preserve dashboard build/start commands.
