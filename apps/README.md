# apps

Runtime services.

- `web`: Next.js frontend.
- `cms`: Strapi canonical content system.
- `manager`: internal operator app for video operations, agents, and
  automations.
- `admin`: internal admin tooling.
- `mobile`: React Native + Expo mobile app.
- `roadmap`: roadmap viewer.
- `tv`: TV app surface.
- `agentic`: agentic runtime and Mastra Studio app for shared agents/workflows.
  Manager is the first consumer; future apps should integrate through
  explicit API contracts rather than app-to-app imports.

Each subfolder has strict boundary docs in local `README.md` and `AGENTS.md`.
