---
id: "feat-576"
title: "Disposable roadmap ID collision CI probe"
owner: "jaco"
priority: "P2"
status: "not-started"
start_date: "2026-09-30"
duration: 1
depends_on: []
blocks: []
tags: ["ci", "probe"]
---

## Purpose

This disposable ticket deliberately duplicates `feat-576` to verify that the
advisory pull request check reports the collision. Close the probe PR without
merging it after capturing the failed check.
