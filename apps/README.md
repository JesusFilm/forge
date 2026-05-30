# apps

Runtime services.

- `web`: Next.js frontend.
- `manager`: internal operator app for video operations, agents, and
  automations.
- `admin`: canonical content and management system.
- `mobile`: React Native + Expo mobile app.
- `roadmap`: roadmap viewer.
- `tv`: TV app surface.
- `mastra`: Mastra runtime for shared agents and workflows.
  Manager is the first consumer; future apps should integrate through
  explicit API contracts rather than app-to-app imports.

Each subfolder has strict boundary docs in local `README.md` and `AGENTS.md`.
