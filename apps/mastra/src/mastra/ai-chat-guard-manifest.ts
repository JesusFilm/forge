// Immutable migration and function bodies. Tests verify these against SQL bytes.
export const CHAT_MIGRATION = {
  version: 1,
  name: "001-conversation-deletion.sql",
  sha256: "02a66a7903c6cff5b20b208c1d46f08eee42e963613cf348e558634a0432ed1f",
} as const
export const CHAT_GUARD_BODY_MD5 = {
  forge_guard_thread_insert: "a56d7dbf71c094c5f0a62fa7400fd630",
  forge_guard_message_insert: "d19588e12f81a5fb186d2bfb725a6478",
  forge_guard_thread_identity: "c190144335ff5c9f399bfae7f0fba81b",
  forge_guard_message_identity: "6ec32bf703de330b3065c73dea80acac",
} as const
