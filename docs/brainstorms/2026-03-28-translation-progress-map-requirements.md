---
date: 2026-03-28T00:00:00.000Z
topic: translation-progress-map
---

# Translation Progress Map Dashboard

## Problem Frame

JesusFilm's manager app has a coverage report (`/dashboard/coverage`) that shows translation progress as bars and lists. While functional, it lacks a geographic bird's-eye view that lets team members quickly see _where_ translation gaps exist across the world. A map-based visualization would make progress immediately intuitive - green countries mean "done," red means "gaps," purple means "AI-generated but unverified."

## Requirements

- R1. **Interactive world map at `/dashboard/map`** - A new top-level route in the manager app showing an interactive map of all countries where JesusFilm has content or language data.
- R2. **Administrative region boundaries** - Each country is divided into its real administrative regions (states, provinces, oblasts, etc.) using GeoJSON boundary data. The goal is recognizability, not cartographic precision.
- R3. **Region coloring by translation status** - Regions within a country are colored based on the aggregate translation status of that country's major languages (languages with >50% speaker population per `countryLanguages.speakers` data):
  - **Green** - Verified (human-reviewed subtitles/audio/metadata exist)
  - **Red** - Missing (no translation)
  - **Purple** - AI-generated (exists but not human-verified)
- R4. **Aggregate blend across major languages** - When a country has multiple major languages, the country's regions are divided proportionally. For example, if a country has 10 regions and 2 major languages where one is verified and one is missing, ~5 regions show green and ~5 show red. The allocation reflects the combined status distribution across all major languages.
- R5. **Report type selector** - A dropdown or toggle to switch the map view between Subtitles, Audio, and Metadata coverage (matching the existing coverage report's three report types).
- R6. **Country interaction** - Clicking or hovering on a country shows a tooltip or panel with:
  - Country name
  - Major languages and their individual translation status
  - Overall coverage percentage
- R7. **Zoom and pan** - The map supports zoom (scroll/pinch) and pan (drag) for navigating between regions. Reasonable default zoom to show the full world.
- R8. **Visual style** - The map should use a clean, minimal aesthetic consistent with the manager app's existing design (dark/light theme support via CSS custom properties). Country labels visible at appropriate zoom levels.

## Success Criteria

- A team member can open `/dashboard/map` and within seconds identify which parts of the world have translation gaps
- The color coding (green/red/purple) is immediately understandable without a tutorial
- The map loads within a reasonable time despite rendering ~200 countries with sub-regions
- Report type switching updates the map without a full reload

## Scope Boundaries

- **Not a replacement** for the existing coverage report - this is an additional view
- **No editing or translation actions** from the map - view-only (translation workflows stay in the coverage report)
- **No video-level granularity** on the map - the map shows country/language-level aggregation only
- **Region boundaries are best-effort** - some small countries may not have sub-region data and can be shown as a single colored block
- **No offline/downloadable map** - requires network connection

## Key Decisions

- **Aggregate blend model**: When a country has multiple major languages, regions are proportionally divided by the combined status distribution across those languages, rather than showing worst-case or per-language toggles
- **Administrative regions over abstract grids**: Real province/state boundaries for recognizability, even though this requires GeoJSON data
- **New route, not a tab**: The map is a standalone view at `/dashboard/map`, not embedded in the existing coverage page
- **Report type selector**: Reuses the same Subtitles/Audio/Metadata distinction as the existing coverage report

## Dependencies / Assumptions

- The existing `/api/languages` endpoint provides continent -> country -> language -> speaker data needed for determining major languages
- The existing `/api/videos` endpoint provides coverage status (human/ai/none) per language
- GeoJSON data for administrative regions will need to be sourced (e.g., Natural Earth, GADM, or similar open dataset)
- The Country content type in Strapi already has latitude/longitude fields for positioning

## Outstanding Questions

### Resolve Before Planning

(none)

### Deferred to Planning

- [Affects R2][Needs research] Which GeoJSON dataset provides the best balance of detail vs. file size for administrative regions? Natural Earth admin-1 (~25MB) vs. GADM vs. simplified/topojson alternatives?
- [Affects R1][Technical] Which map rendering library fits best? Options include react-simple-maps (lightweight, SVG), Leaflet/react-leaflet (tile-based), or D3-geo (low-level, flexible). Must work with Next.js SSR.
- [Affects R4][Technical] How to efficiently compute the aggregate blend - precompute on the API side vs. client-side calculation from existing endpoints?
- [Affects R2][Technical] How to handle countries with no sub-region GeoJSON data - fallback to country outline as a single region?
- [Affects R8][Technical] Performance strategy for rendering ~200 countries with sub-regions - lazy loading by viewport, simplified geometries at low zoom, or precomputed TopoJSON?

## Next Steps

-> `/ce:plan` for structured implementation planning
