/** Receiver-first aliases. Present canonical values win, including blanks.
 * A canonical database/host selects the Forge target family as a whole: never
 * combine its reader with a legacy writer, host, identity, model or opt-in.
 */
export function migrationEnvironmentValue(
  input: Record<string, string | undefined>,
  legacyName: string,
): string | undefined {
  const canonicalName =
    legacyName === "JFRAG_OPENROUTER_API_KEY"
      ? "OPENROUTER_API_KEY"
      : legacyName === "JFRAG_OPENROUTER_EMBED_MODEL_ID"
        ? "FORGE_RAG_EMBED_MODEL_ID"
        : legacyName === "JFRAG_SOURCE_DATABASE_URL"
          ? "CORPUS_SOURCE_DATABASE_URL"
          : legacyName.replace(/^JFRAG_/, "FORGE_RAG_")
  const canonicalTargetSelected = [
    "FORGE_RAG_POSTGRESQL_DB_URL",
    "FORGE_RAG_POSTGRESQL_READONLY_DB_URL",
    "FORGE_RAG_EXPECTED_POSTGRES_HOST",
  ].some((name) => input[name] !== undefined)
  const targetBound =
    canonicalName.startsWith("FORGE_RAG_") &&
    canonicalName !== "FORGE_RAG_EVAL_CORPUS_REVISION"
  return input[canonicalName] !== undefined ||
    (canonicalTargetSelected && targetBound)
    ? input[canonicalName]
    : input[legacyName]
}
