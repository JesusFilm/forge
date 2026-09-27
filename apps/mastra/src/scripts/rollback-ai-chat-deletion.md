# One-time AI-chat rollback in Railway Console

After review, merge the revert PR through the normal PR-to-main path and wait
for the reverted `@forge/mastra` release to deploy. During a quiet dogfooding
period, open **that Mastra service's Railway Console**. Verify the intended
service/environment and release revision. The command uses its `DATABASE_URL`
without dotenv loading or a localhost fallback.

From `/app/apps/mastra` (adjust for the actual checkout location), preview:

```sh
node .mastra/output/operations/rollback-ai-chat-deletion.mjs
```

Check the credential-free host/database, thread/message/marker counts,
`objects=11`, `history_matches=true`, and exit 0. Preview uses a read-only
transaction. Copy its `confirm_database` token, then execute:

```sh
node .mastra/output/operations/rollback-ai-chat-deletion.mjs \
  --execute --confirm-database=<token-from-preview>
```

The token binds the destination, connected database/role, and exact SQL; it is
printed only by a successful preview. SQL validates the exact migration history
under locks and removes only the deletion guards/bookkeeping in `ai_chat`.
Native thread/message counts are checked inside the transaction before COMMIT.
Other Mastra schemas and Langfuse are untouched. No automatic execution exists.

Require `event=postcheck objects=0`, `native_counts_preserved_in_transaction=true`,
and exit 0. Run preview again to confirm `state=absent`, inspect the remaining
native counts, and check chat creation, reload/history and rename. Live traffic
or retention can change counts between commands. The rollback does not restore
deleted conversations and removes their marker-based recreation protection.

The running service is not paused: the SQL briefly locks chat tables, so
concurrent chat/maintenance requests may wait or fail. Lock acquisition is capped
at 5 seconds, statements at 30 seconds. If busy, a lock timeout rolls back the
SQL transaction; use a quieter window rather than bypassing the checks.

Exit **0** means a successful preview, verified rollback, or already-absent state;
inspect the event. Exit **1** means refusal or failure without a committed rollback.
Exit **2** means execution may have committed or its post-check failed: use a fresh
preview to establish the state before considering another execution. Errors do
not print credentials, connection strings, row contents, or raw driver messages.

Only the MJS command and SQL are packaged in `.mastra/output/operations`. If the
Console opens in `.mastra/output`, use `node operations/rollback-ai-chat-deletion.mjs`.
The source-checkout alias is `pnpm --filter @forge/mastra rollback:ai-chat-deletion`.
After successful production verification, remove the command, SQL, tests,
packager, and package-script changes in a second PR. Record production results
in the PR description.
