# Install and connect

This folder is a portable skill. It needs a reachable Forge Manager Shorts MCP server and your own authorized account, not a Forge checkout or service credentials. Download `shorts-creator.zip` from the Shorts projects page. Keep the complete `shorts-creator/` folder together; all references and examples are relative to it.

Use the Manager URL supplied by your operator. The streamable HTTP endpoint is `https://YOUR-MANAGER-HOST/mcp`. The hostname is a placeholder, not a working deployment. Do not select an unrelated environment. Authentication requires user OAuth consent and operator-granted access; never paste client secrets or service bearer tokens into a conversation or skill.

## Codex CLI or local Codex skills

Extract the folder into `~/.agents/skills/shorts-creator/`, so `SKILL.md` is directly inside that directory. Refresh skill discovery or restart the client and resume the existing brief's conversation, then invoke `$shorts-creator`. If your client cannot load newly installed skills into an existing conversation, report that limitation; move to a new conversation only if the user chooses it.

For the CLI, replace the URL before running:

```sh
codex mcp add forge-shorts --url https://YOUR-MANAGER-HOST/mcp
codex mcp login forge-shorts --scopes shorts:read,shorts:edit,shorts:render,shorts:narration
```

Approve the requested scopes in your browser. Narration is separately consented and may incur provider charges. Omit `shorts:narration` if you want a workflow using existing audio only. The shown flags were checked against Codex CLI 0.150.0-alpha.12.2; use `codex mcp add --help` and `codex mcp login --help` if your version differs. Registration defaults to automatic; ask your operator if the server/client cannot negotiate registration rather than supplying service secrets. A connected tool listing is required before creation; a registered entry alone is not qualification.

Official references: [Codex skills](https://learn.chatgpt.com/docs/build-skills), [Codex MCP](https://learn.chatgpt.com/docs/extend/mcp?surface=cli).

## Claude Code

Extract the folder into `~/.claude/skills/shorts-creator/`. Add the remote server for your user, replacing the URL:

```sh
claude mcp add --transport http --scope user forge-shorts https://YOUR-MANAGER-HOST/mcp
```

Run `/mcp` in Claude Code to authenticate the server through OAuth and inspect connection status. Invoke `/shorts-creator` in your conversation. Check your version's help if command flags differ. Request read/edit/render consent and separate narration consent only when needed. This is documented setup guidance, not a claim that your client exposes rendered images or audio.

Official references: [Claude Code MCP](https://code.claude.com/docs/en/mcp), [Claude Code skills](https://code.claude.com/docs/en/skills).

## Claude web or desktop

Where your account supports custom skills, use **Customize → Skills → + → Create skill → Upload a skill** and upload the ZIP containing this folder. A local Claude Code skill directory is not automatically installed into the web app. Where custom connectors are available, use **Customize → Connectors → Add custom connector**, enter the Manager MCP URL, and authenticate with your own account. Organization settings may require an owner to enable the connector.

Cloud clients must reach the server: a localhost-only qualification server is not reachable from Claude web. Confirm tool discovery and actual image support in your client. If custom skills/connectors are unavailable, report that access limitation; do not describe the workflow as verified.

Official references: [Custom skills](https://support.claude.com/en/articles/12512180-use-skills-in-claude), [Remote MCP connectors](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp).

## Before calling anything

Ask the agent to discover its actual tool schemas, then read the skill and authoring reference. Server tool names may be prefixed or normalized by the client. The logical names here are `shorts.*`. `shorts:chat` and hosted-agent instructions are not required for this direct external-conversation workflow. If permission is missing, reconnect through OAuth for the specific missing scope. Do not bypass authority using an unrelated endpoint.

Tool media links expire. Refresh bytes through `shorts.renderRead` or `shorts.assetRead` when needed; do not persist/log capability URLs or substitute them for durable review links. No client is qualified solely by installing this package: creation, render, inspection, and revision must actually run, and unsupported modalities must be reported.
