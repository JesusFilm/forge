---
id: "feat-087"
title: "Manager Enrichment UX"
owner: "vlad"
priority: "P1"
status: "complete"
start_date: "2026-04-08"
duration: 11
depends_on:
  - "feat-031"
blocks: []
tags:
  - "manager"
  - "mux"
  - "video-player"
  - "ai-pipeline"
  - "audio"
---

## Problem

Manager operators needed a tighter enrichment review experience after the AI Video Enrichment Pipeline began producing Mux-linked playback, cleaned audio, and review artifacts. The work landed as several short follow-up tickets and is now reported as one completed UX block.

## What Was Built

1. Added Mux environment labels to Manager job detail so operators can distinguish playback context.
2. Added cleaned audio review links on Manager job detail.
3. Added the job detail enrichment review player for reviewing enrichment playback and artifacts in context.
4. Added Enrich Now feedback so manual enrichment triggers report progress and failure states clearly.
5. Added Video.js chapter navigation to the job detail review player.

## Related PRs and Branches

- PR #720: [[codex] add mux environment labels to job detail](https://github.com/JesusFilm/forge/pull/720) - branch `fix/mux-environment-labels`, merge commit `d5d5d9ce5c7a032797deaf4c043824a2e9414abc`.
- PR #724: [feat(manager): add cleaned audio review links](https://github.com/JesusFilm/forge/pull/724) - branch `feat/manager-cleaned-audio-review-links`, merge commit `cb59d586d753529561d2b4eb8cdedf7435bf73a0`.
- PR #726: [feat(manager): add job detail enrichment review player](https://github.com/JesusFilm/forge/pull/726) - branch `feat/job-detail-enrichment-review-player`, merge commit `92425b8ab7107c4a41b953558568d6547835cf66`.
- PR #740: [fix(manager): add Enrich Now feedback](https://github.com/JesusFilm/forge/pull/740) - branch `fix/enrich-now-feedback`, merge commit `a3d7be60129d0e99f2c3173a0b3496e486441852`.
- PR #730: [Add Video.js chapter navigation to review player](https://github.com/JesusFilm/forge/pull/730) - branch `feat/job-detail-review-player-videojs-chapters`, merge commit `0ceb71bccd79301a29e1bef675c99ba860d5cb36`.

## Consolidated Standalone Items

- `docs/roadmap/media-generation/feat-047-mux-environment-indicator-on-job-detail.md`
- `docs/roadmap/media-generation/feat-081-cleaned-audio-review-links.md`
- `docs/roadmap/media-generation/feat-082-job-detail-enrichment-review-player.md`
- `docs/roadmap/media-generation/feat-084-enrich-now-feedback.md`
- `docs/roadmap/media-generation/feat-085-job-detail-review-player-videojs-chapters.md`

## Dependency Notes

This block depends on `feat-031` AI Video Enrichment Pipeline. The chapter navigation work remains conceptually a follow-up to the enrichment review player work within this consolidated block.
