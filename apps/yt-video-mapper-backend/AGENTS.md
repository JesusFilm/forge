# YouTube Video Mapper Backend Agent Guide

Scope: `apps/yt-video-mapper-backend`.

Follow the root `AGENTS.md` and `apps/AGENTS.md` guidance. This app is the
backend workspace package for mapping externally uploaded videos back to Forge
catalog `Video` and `VideoDub` records. The public API should return Core
terminology: `coreId` plus `videoVariantId`.

Keep matching decisions content-first. Treat external metadata as weak context,
not proof.

Prototype follow-up tickets live in
`/docs/prototypes/yt-video-mapper/tickets/`. They intentionally sit outside
`docs/roadmap/` so mapper implementation slices do not appear on the roadmap
website.
