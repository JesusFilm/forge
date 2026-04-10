---
date: 2026-04-10
topic: seed-studio-real-video-data
---

# Seed Studio: Real Video Data in Preview

## Problem Frame

When Seed Studio's AI generates an experience, it produces placeholder streaming URLs and no thumbnails because it has no access to the actual Strapi video catalog. The preview panel shows empty gray boxes instead of real video thumbnails. This makes the preview useless for evaluating the experience before publishing.

## Requirements

- R1. AI must select videos from the real Strapi video catalog (title, streamingUrl, thumbnailUrl) when building an experience
- R2. Preview panel must display actual video thumbnails from the selected videos
- R3. AI-generated text content (headings, paragraphs, bible quotes, Q&A) remains AI-generated — only video/image references come from Strapi
- R4. Bible quote `imageUrl` fields should use real image URLs that will render in preview (Unsplash or similar publicly accessible URLs are acceptable)

## Success Criteria

- Preview shows real video thumbnails for all video sections (video, video-hero, video-carousel)
- Published experience contains valid video references that match actual Strapi records

## Scope Boundaries

- No changes to Strapi endpoints (video search already exists)
- No changes to the preview component rendering logic beyond using the data that's now available
- No new video upload or management features

## Key Decisions

- **Inject catalog data into prompt**: Fetch video catalog from Strapi before calling Claude CLI, include real video data in the system prompt so Claude can reference actual videos with real URLs and thumbnails

## Next Steps

→ Proceed directly to work — scope is small and well-bounded
