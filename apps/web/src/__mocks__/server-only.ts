// No-op stub for vitest. The real `server-only` package throws at import time
// to prevent client bundles from importing server helpers; that guard is
// enforced by the Next.js build, not the test runner.
export {}
