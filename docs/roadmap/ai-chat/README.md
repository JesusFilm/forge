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

## Status (June 25, 2026)

- **Total tickets:** 9
- ✅ **Complete:** 5
- 🟡 **In progress:** 0
- 🔵 **Not started:** 4
- 🔴 **Blocked:** 0

## Feature Index

| ID                                                           | Feature                                                   | Owner    | Priority | Start      | Days | Status         | Code PR |
| ------------------------------------------------------------ | --------------------------------------------------------- | -------- | -------- | ---------- | ---- | -------------- | ------- |
| [feat-198](feat-198-seeker-agent-skeleton.md)                | Seeker Agent Skeleton                                     | jian wei | P2       | 2026-06-09 | 3    | ✅ complete    | #1279   |
| [feat-199](feat-199-seeker-rag-retrieval-connection.md)      | Seeker Agent RAG Retrieval Connection                     | jian wei | P2       | 2026-06-10 | 3    | ✅ complete    | #1279   |
| [feat-200](feat-200-chat-app-scaffold.md)                    | Chat app scaffold with stubbed agent                      | jian wei | P1       | 2026-06-10 | 3    | ✅ complete    | #1276   |
| [feat-201](feat-201-chat-app-vigil-reskin.md)                | Chat app Vigil re-skin + conversation shell               | jian wei | P1       | 2026-06-15 | 1    | ✅ complete    | #1276   |
| [feat-202](feat-202-seeker-rag-runtime-hardening.md)         | Seeker RAG runtime hardening                              | jian wei | P2       | 2026-06-18 | 2    | 🔵 not-started | —       |
| [feat-203](feat-203-chat-sidebar-component-extraction.md)    | Chat sidebar component + behavior extraction              | jian wei | P2       | 2026-07-01 | 2    | ✅ complete    | #1368   |
| [feat-204](feat-204-expose-seeker-mastra-service-route.md)   | Expose Seeker agent via internal Mastra SSE service route | jian wei | P2       | 2026-06-24 | 3    | 🔵 not-started | —       |
| [feat-205](feat-205-chat-wire-seeker-route.md)               | Wire chat app to the Seeker Mastra route                  | jian wei | P1       | 2026-06-27 | 3    | 🔵 not-started | —       |
| [feat-206](feat-206-chat-introduce-react-testing-library.md) | Introduce React Testing Library to the chat app           | jian wei | P2       | 2026-07-03 | 2    | 🔵 not-started | —       |
