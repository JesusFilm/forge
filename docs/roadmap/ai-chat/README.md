# AI Chat Lane

The **Jesus Film AI Chat** roadmap lane — a headless, multi-agent AI chat
system (Mastra backend agents + an `apps/chat` web surface), tracked separately
from the main DS Year 1 roadmap.

> **This lane is intentionally NOT rendered by the roadmap viewer app**
> (`apps/roadmap`). It is deliberately excluded from that app's hardcoded
> `LANE_DIRS` and from the generated root `docs/roadmap/README.md`
> (`README_LANE_ORDER`). This file is maintained **by hand** — it is the lane's
> index, and nothing regenerates or overwrites it. See `CLAUDE.md` in this
> folder for the maintenance rules and why the lane is unregistered.

## Status (July 14, 2026)

- **Total tickets:** 24
- ✅ **Complete:** 19
- 🟡 **In progress:** 0
- 🔵 **Not started:** 5
- 🔴 **Blocked:** 0

## Feature Index

| ID                                                           | Feature                                                                   | Owner    | Priority | Start      | Days | Status         | Code PR |
| ------------------------------------------------------------ | ------------------------------------------------------------------------- | -------- | -------- | ---------- | ---- | -------------- | ------- |
| [feat-198](feat-198-seeker-agent-skeleton.md)                | Seeker Agent Skeleton                                                     | jian wei | P2       | 2026-06-09 | 3    | ✅ complete    | #1279   |
| [feat-199](feat-199-seeker-rag-retrieval-connection.md)      | Seeker Agent RAG Retrieval Connection                                     | jian wei | P2       | 2026-06-10 | 3    | ✅ complete    | #1279   |
| [feat-200](feat-200-chat-app-scaffold.md)                    | Chat app scaffold with stubbed agent                                      | jian wei | P1       | 2026-06-10 | 3    | ✅ complete    | #1276   |
| [feat-201](feat-201-chat-app-vigil-reskin.md)                | Chat app Vigil re-skin + conversation shell                               | jian wei | P1       | 2026-06-15 | 1    | ✅ complete    | #1276   |
| [feat-202](feat-202-seeker-rag-runtime-hardening.md)         | Seeker RAG runtime hardening                                              | jian wei | P2       | 2026-06-18 | 1    | ✅ complete    | #1420   |
| [feat-203](feat-203-chat-sidebar-component-extraction.md)    | Chat sidebar component + behavior extraction                              | jian wei | P2       | 2026-07-01 | 2    | ✅ complete    | #1368   |
| [feat-204](feat-204-expose-seeker-mastra-service-route.md)   | Expose Seeker agent via internal Mastra SSE service route                 | jian wei | P2       | 2026-06-24 | 3    | ✅ complete    | #1371   |
| [feat-205](feat-205-chat-wire-seeker-route.md)               | Wire chat app to the Seeker Mastra route                                  | jian wei | P1       | 2026-06-27 | 3    | ✅ complete    | #1384   |
| [feat-206](feat-206-chat-introduce-react-testing-library.md) | Introduce React Testing Library to the chat app                           | jian wei | P2       | 2026-07-03 | 2    | ✅ complete    | #1372   |
| [feat-207](feat-207-chat-auth.md)                            | Chat app authentication                                                   | jian wei | P1       | 2026-07-07 | 5    | ✅ complete    | #1438   |
| [feat-208](feat-208-seeker-postgres-memory.md)               | Postgres-persisted Seeker memory + conversation persistence               | jian wei | P2       | 2026-07-10 | 5    | ✅ complete    | #1462   |
| [feat-209](feat-209-chat-per-conversation-urls.md)           | Per-conversation URLs                                                     | jian wei | P2       | 2026-07-23 | 2    | 🔵 not-started | —       |
| [feat-229](feat-229-chat-auth-register-oauth-client.md)      | Register chat OAuth client in apps/auth (chat auth enablement)            | jian wei | P1       | 2026-07-09 | 2    | ✅ complete    | #1453   |
| [feat-231](feat-231-chat-auth-prod-oauth-client.md)          | Register chat deployed-environment OAuth clients (prod enablement)        | jian wei | P2       | 2026-07-20 | 1    | ✅ complete    | #1465   |
| [feat-233](feat-233-chat-seeker-ld-dogfood-gate.md)          | Chat seeker LaunchDarkly dogfood gate (per-user allowlist)                | jian wei | P1       | 2026-07-06 | 3    | ✅ complete    | #1488   |
| [feat-235](feat-235-chat-cloudflare-dns-cutover.md)          | Chat app Cloudflare DNS cutover (retire Railway domain)                   | jian wei | P2       | 2026-08-01 | 2    | ✅ complete    | #1475   |
| [feat-236](feat-236-chat-remove-seeker-dogfood-gate.md)      | Remove the chat seeker dogfood gate (public seeker release)               | jian wei | P2       | 2026-09-01 | 2    | 🔵 not-started | —       |
| [feat-237](feat-237-seeker-gateway-model.md)                 | Seeker agent JesusFilm gateway model (opt-in primary)                     | jian wei | P2       | 2026-07-07 | 2    | ✅ complete    | #1491   |
| [feat-239](feat-239-chat-seeker-env-allowlist-gate.md)       | Replace the chat seeker LaunchDarkly gate with an env-var email allowlist | jian wei | P1       | 2026-07-08 | 1    | ✅ complete    | #1498   |
| [feat-240](feat-240-chat-sign-out-force-login.md)            | Chat sign-out force-login marker (no silent re-auth)                      | jian wei | P2       | 2026-07-15 | 1    | ✅ complete    | #1539   |
| [feat-241](feat-241-chat-server-history-sidebar.md)          | Chat server-side conversation history + sidebar hydration                 | jian wei | P2       | 2026-07-20 | 3    | ✅ complete    | #1552   |
| [feat-247](feat-247-chat-history-management.md)              | Chat conversation history management (delete/rename) — stub               | jian wei | P2       | 2026-09-08 | 2    | 🔵 not-started | —       |
| [feat-248](feat-248-chat-anon-thread-migration.md)           | Anonymous-to-account conversation migration — stub, future consideration  | jian wei | P2       | 2026-09-15 | 3    | 🔵 not-started | —       |
| [feat-250](feat-250-seeker-route-lane-key-migration.md)      | Migrate /forge-seeker onto the ai-chat lane service key — stub            | jian wei | P2       | 2026-08-03 | 1    | 🔵 not-started | —       |
