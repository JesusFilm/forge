---
id: "feat-550"
title: "Apply Next.js September security update"
owner: "tataihono"
priority: "P0"
status: "complete"
start_date: "2026-09-23"
duration: 1
depends_on: []
blocks: []
tags: ["infrastructure", "security"]
---

## Problem

Next.js 16.2.0 through 16.3.5 can expose Node.js ImageResponse to remote code execution when rendering attacker-controlled SVG values (GHSA-vcvr-r3jv-pc5j).

## Scope

Update Next.js dependencies in apps/\*/package.json to 16.3.6, migrate the Forge preload patch, and regenerate pnpm-lock.yaml. Preserve unrelated work and existing major versions.

## Verification

Use the package manager to resolve and validate the lockfile, check the resolved Next.js version, and run available focused checks. Record environment blockers in the machine-wide audit report. Production delivery follows the existing PR workflow.
