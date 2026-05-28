// Cross-cutting header contract between apps/web/src/proxy.ts (producer)
// and apps/web/src/app/layout.tsx (consumer). The watch URL pathname is
// forwarded via this header so the root layout can derive UI chrome
// locale BEFORE pages render. Centralized here to prevent silent drift
// where one side renames the header and the other doesn't.

export const WATCH_PATHNAME_HEADER = "x-watch-pathname"
