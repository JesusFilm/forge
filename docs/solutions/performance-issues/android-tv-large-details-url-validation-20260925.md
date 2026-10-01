---
title: "Android TV large details require bounded caching and cheap stream validation"
date: "2026-09-25"
category: performance-issues
module: apps/tv
problem_type: performance_issue
component: frontend
symptoms:
  - "JESUS details can wait on thousands of language variants before actions appear"
root_cause: logic_error
resolution_type: code_fix
severity: high
tags:
  - android-tv
  - details
  - graphql
  - mux
---

Android TV JESUS details have a very large variant list. Skipping Apollo normalization with a bounded, in-memory `no-cache` details query helps first load and warm revisits, but the speedup also depends on avoiding Hermes `URL` construction for every canonical `https://stream.mux.com/<id>.m3u8` variant. Keep the fast path anchored to the exact HTTPS host, safe path characters, and `.m3u8` suffix; let the existing parser handle signed or noncanonical URLs. Test crafted authorities so optimization cannot turn into a host-validation bypass.

The September 21 report's timings came from an older source worktree. The September 25 integrated QA build passed functional Chromecast checks, but has no new latency measurement; do not repeat those numbers as current performance evidence.
