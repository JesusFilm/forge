# Watch TV beta feedback

- `src/app/tv/`: mobile-first form, English and Thai.
- `src/app/api/feedback/`: server-side sessions, uploads, and report submission.
- `src/server/`: validated contracts, Redis state, and the Linear client.

Never expose Redis or Linear credentials to the browser. Show a successful receipt only after Linear confirms the issue and its selected evidence. Keep the TV's platform separate from the submitting phone's browser details. Run `pnpm --filter @forge/tv-feedback test`, `typecheck`, and `build` before delivery.

`/tv/local` and `/api/feedback/local/*` are a separate opt-in development-only
simulator receiver. They save bounded evidence on the Mac and display an
explicit local receipt; optional Linear forwarding is a separate user action.
Keep this boundary closed in production, preserve normal verified-grant routes,
and never automatically repeat uncertain Linear writes. See `LOCAL-FEEDBACK.md`.

`/tv/simulator` is the explicitly enabled hosted signed-link entry. Keep its
public-key verification separate from native device verification. Only persisted
server-issued `signed-simulator` grants bypass daily report counts; every other
grant keeps the normal limits. Rotating the public key or disabling the feature
must invalidate simulator sessions without affecting ordinary device sessions.
