/** One-time manual Console command; never imported by application startup. */
import { createHash } from "node:crypto"
import { readFile } from "node:fs/promises"
import { pathToFileURL, URL } from "node:url"
import pg from "pg"

const MIGRATION_SHA =
  "02a66a7903c6cff5b20b208c1d46f08eee42e963613cf348e558634a0432ed1f"
const hash = (text) => createHash("sha256").update(text).digest("hex")
class RollbackRefusal extends Error {}
function requireCondition(condition, reason) {
  if (!condition) throw new RollbackRefusal(reason)
}

async function preview(client) {
  await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY")
  const {
    rows: [state],
  } = await client.query(`SELECT
    (SELECT count(*) FROM ai_chat.mastra_threads)::text AS threads,
    (SELECT count(*) FROM ai_chat.mastra_messages)::text AS messages,
    to_regclass('ai_chat.forge_schema_migrations') IS NOT NULL AS history_present,
    to_regclass('ai_chat.forge_conversation_lifecycle') IS NOT NULL AS lifecycle_present,
    ((SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='ai_chat' AND relname IN ('forge_schema_migrations','forge_conversation_lifecycle')) +
     (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='ai_chat' AND proname IN ('forge_guard_thread_insert','forge_guard_message_insert','forge_guard_thread_identity','forge_guard_message_identity')) +
     (SELECT count(*) FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='ai_chat' AND tgname IN ('forge_thread_insert','forge_message_insert','forge_thread_identity','forge_message_identity')) +
     (SELECT count(*) FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace
      WHERE n.nspname='ai_chat' AND conname='forge_message_parent'))::int AS objects`)
  state.historyMatches = false
  if (state.history_present) {
    const { rows } = await client.query(
      "SELECT version,name,sha256 FROM ai_chat.forge_schema_migrations",
    )
    state.historyMatches =
      rows.length === 1 &&
      rows[0].version === 1 &&
      rows[0].name === "001-conversation-deletion.sql" &&
      rows[0].sha256 === MIGRATION_SHA
  }
  if (state.lifecycle_present) {
    const {
      rows: [counts],
    } = await client.query(
      "SELECT count(*)::text AS records, count(*) FILTER (WHERE deleted)::text AS deleted_markers FROM ai_chat.forge_conversation_lifecycle",
    )
    Object.assign(state, counts)
  }
  await client.query("ROLLBACK")
  return state
}

export async function runRollbackAiChatDeletion(argv, options = {}) {
  const emit = (line) =>
    (options.stdout ?? console.log)(`[rollback-ai-chat-deletion] ${line}`)
  let client,
    attempted = false,
    committed = false
  try {
    const flags = argv.filter((arg) => arg !== "--")
    requireCondition(
      flags.every(
        (arg) =>
          arg === "--execute" || /^--confirm-database=[a-f0-9]{64}$/.test(arg),
      ) && new Set(flags.map((arg) => arg.split("=")[0])).size === flags.length,
      "invalid_flags",
    )
    const execute = flags.includes("--execute")
    const confirm = flags
      .find((arg) => arg.startsWith("--confirm-database="))
      ?.split("=")[1]
    requireCondition(execute || !confirm, "invalid_flags")
    requireCondition(!execute || confirm, "execution_confirmation_required")
    const databaseUrl =
      "databaseUrl" in options ? options.databaseUrl : process.env.DATABASE_URL
    requireCondition(
      typeof databaseUrl === "string" && databaseUrl.trim(),
      "database_url_required",
    )
    let url
    try {
      url = new URL(databaseUrl)
    } catch {
      throw new RollbackRefusal("database_url_invalid")
    }
    requireCondition(
      ["postgres:", "postgresql:"].includes(url.protocol) &&
        url.hostname &&
        url.pathname.length > 1,
      "database_url_invalid",
    )
    const sql = await readFile(
      new URL("./rollback-ai-chat-deletion.sql", import.meta.url),
      "utf8",
    )
    client = new pg.Client({
      connectionString: databaseUrl,
      application_name: "forge-ai-chat-rollback",
      connectionTimeoutMillis: 2000,
      statement_timeout: 30000,
      query_timeout: 40000,
    })
    client.on("error", () => {}) // Never print raw driver errors or connection strings.
    await client.connect()
    const {
      rows: [server],
    } = await client.query(
      "SELECT current_database() AS database, current_user AS role, (SELECT oid::text FROM pg_database WHERE datname=current_database()) AS oid",
    )
    const { host, port, database, user } = client.connectionParameters
    const token = hash(
      JSON.stringify({
        host,
        port,
        database,
        user,
        server,
        schema: "ai_chat",
        sql: hash(sql),
      }),
    )
    emit(
      `event=target host=${encodeURIComponent(host)} port=${port} database=${encodeURIComponent(database)} schema=ai_chat`,
    )
    if (execute)
      requireCondition(confirm === token, "confirm_database_mismatch")
    const before = await preview(client)
    emit(
      `event=${execute ? "precheck" : "preview"} objects=${before.objects} threads=${before.threads} messages=${before.messages} records=${before.records ?? 0} deleted_markers=${before.deleted_markers ?? 0} history_matches=${before.historyMatches}`,
    )
    if (before.objects === 0) {
      emit("event=exit code=0 state=absent changed=false")
      return 0
    }
    requireCondition(before.historyMatches, "migration_mismatch")
    requireCondition(before.objects === 11, "partial_schema")
    if (!execute) {
      emit(`event=confirmation confirm_database=${token}`)
      emit("event=exit code=0 mode=preview")
      return 0
    }
    // Execute the complete SQL transaction unchanged. SQL owns locks,
    // migration preconditions, DDL and native-count checks before COMMIT.
    attempted = true
    await client.query(sql)
    committed = true
    const after = await preview(client)
    requireCondition(after.objects === 0, "postcheck_failed")
    emit(
      `event=postcheck objects=0 threads=${after.threads} messages=${after.messages} native_counts_preserved_in_transaction=true`,
    )
    emit("event=exit code=0 state=rolled_back")
    return 0
  } catch (error) {
    await client?.query("ROLLBACK").catch(() => {})
    // A server SQL error aborts the transaction. A transport failure during
    // execution can lose COMMIT's acknowledgement; do not claim it rolled back.
    const code =
      attempted && (committed || !/^[0-9A-Z]{5}$/.test(error.code ?? ""))
        ? 2
        : 1
    emit(
      `event=failed reason=${error instanceof RollbackRefusal ? error.message : "database_or_artifact_error"} outcome=${committed ? "committed" : code === 2 ? "unknown" : "not_committed"}`,
    )
    emit(`event=exit code=${code}`)
    return code
  } finally {
    await client?.end().catch(() => {})
  }
}
if (
  process.argv[1] &&
  pathToFileURL(process.argv[1]).href === import.meta.url
) {
  process.exitCode = await runRollbackAiChatDeletion(process.argv.slice(2))
}
