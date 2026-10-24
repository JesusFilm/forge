# Watch TV beta feedback

- `src/app/tv/`: mobile-first form, English and Thai.
- `src/app/api/feedback/`: server-side sessions, uploads, and report submission.
- `src/server/`: validated contracts, Redis state, and the Linear client.

Never expose Redis or Linear credentials to the browser. Show a successful receipt only after Linear confirms the issue and its selected evidence. Keep the TV's platform separate from the submitting phone's browser details. Run `pnpm --filter @forge/tv-feedback test`, `typecheck`, and `build` before delivery.
