# Opaque preview and Playwright service workers

Initial `browser-smoke-2.log` reached narration controls but recorded a
`SecurityError` reading `navigator.serviceWorker` in a sandboxed frame. This was
not accepted as a clean browser run.

A static HTTP page containing only `<iframe sandbox="allow-scripts" src="/frame">`
and a static child document reproduces the identical error with Playwright 1.61.1
`serviceWorkers: "block"`. With the same frame and only that context option changed
to `"allow"`, it produces zero errors. `minimal.mjs.txt` is the executable loop;
red and green logs preserve its outputs.

The installed Playwright `playwright-core/lib/coreBundle.js:50354` injects:

```js
if (navigator.serviceWorker)
  navigator.serviceWorker.register = async () => {
    console.warn("Service Worker registration blocked by Playwright")
  }
```

The getter itself throws in an opaque frame. No Forge code is needed to reproduce
it. The test harness uses `serviceWorkers: "allow"` in fresh profiles for both
baseline and final performance samples. Page errors remain observed normally.
Application sandbox flags, CSP and origin isolation were not relaxed.

The original Manager/preview loop then reached
`.nle-preview[data-preview-ready="true"]` with zero page errors and a distinct
preview frame. The fixture initially used the abbreviated `studio-proof-1`
runtime identifier; the preview correctly rejected it. The task-owned fixture was
corrected through a canonical revision to the existing full
`STUDIO_RUNTIME_VERSION`. This was a fixture correction, not an application
compatibility bypass. Workflow evidence is separate from the eventual complete
production workflow and paid quality acceptance.
